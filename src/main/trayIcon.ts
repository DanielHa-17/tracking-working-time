import { deflateSync } from 'node:zlib'
import type { Indicator } from '../shared/types'

/** Menu bar icons are 18 pt; drawn at 2x for Retina. */
export const ICON_POINTS = 18
const SCALE = 2
const SIZE = ICON_POINTS * SCALE

const COLORS: Record<Indicator | 'template', [number, number, number]> = {
  green: [52, 199, 89], // systemGreen
  amber: [255, 159, 10], // systemOrange
  grey: [142, 142, 147], // systemGray
  template: [0, 0, 0] // macOS recolours template images to match the menu bar
}

/** Signed distance from point p to a line segment of the given half-width. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number, halfWidth: number): number {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) - halfWidth
}

/** Coverage (0–1) of a stopwatch glyph at pixel centre (x, y), in 18-pt units. */
function stopwatchCoverage(x: number, y: number): number {
  const cx = 9
  const cy = 10.25
  const ring = Math.abs(Math.hypot(x - cx, y - cy) - 6.25) - 0.85
  const hand = segment(x, y, cx, cy, cx, 6.6, 0.85)
  const crown = segment(x, y, 7.6, 1.9, 10.4, 1.9, 0.8)
  const stem = segment(x, y, cx, 1.9, cx, 3.6, 0.7)
  const button = segment(x, y, 13.6, 4.6, 14.6, 5.6, 0.75)
  const distance = Math.min(ring, hand, crown, stem, button) * SCALE
  return Math.max(0, Math.min(1, 0.5 - distance))
}

/** RGBA pixels of the stopwatch in one colour. */
export function renderStopwatch(indicator: Indicator | 'template'): Buffer {
  const [r, g, b] = COLORS[indicator]
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      // 4x4 supersampling for smooth edges.
      let coverage = 0
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          coverage += stopwatchCoverage((column + (sx + 0.5) / 4) / SCALE, (row + (sy + 0.5) / 4) / SCALE)
        }
      }
      const offset = (row * SIZE + column) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = Math.round((coverage / 16) * 255)
    }
  }
  return pixels
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Minimal PNG encoder for 8-bit RGBA pixels. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 4 + 1)] = 0 // no filter
    rgba.copy(rows, row * (width * 4 + 1) + 1, row * width * 4, (row + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PNG of the menu bar icon at 2x. */
export function stopwatchPng(indicator: Indicator | 'template'): Buffer {
  return encodePng(SIZE, SIZE, renderStopwatch(indicator))
}
