import { nativeImage, Tray, type Menu, type NativeImage } from 'electron'
import { formatClock, formatSpoken } from '../shared/format'
import { indicatorFor, STATUS_TITLE, type Indicator, type Settings, type Snapshot } from '../shared/types'
import { stopwatchPng } from './trayIcon'

/** The menu bar item: a stopwatch coloured by state and today's total in monospaced digits. */
export class TrayView {
  private readonly tray: Tray
  private readonly icons = new Map<Indicator | 'template', NativeImage>()
  private shown = { title: '', icon: '', tooltip: '' }

  constructor(handlers: { onClick: () => void; contextMenu: () => Menu }) {
    this.tray = new Tray(this.icon('grey'))
    this.tray.setIgnoreDoubleClickEvents(true)
    this.tray.on('click', handlers.onClick)
    this.tray.on('right-click', () => this.tray.popUpContextMenu(handlers.contextMenu()))
  }

  get bounds(): Electron.Rectangle {
    return this.tray.getBounds()
  }

  render(snapshot: Snapshot, settings: Settings): void {
    const iconKey = settings.showStateColor ? indicatorFor(snapshot.status) : 'template'
    if (iconKey !== this.shown.icon) {
      this.tray.setImage(this.icon(iconKey))
      this.shown.icon = iconKey
    }

    const title = settings.showTimerInMenuBar ? ` ${formatClock(snapshot.todayTotalMs, settings.showSecondsInMenuBar)}` : ''
    if (title !== this.shown.title) {
      this.tray.setTitle(title, { fontType: 'monospacedDigit' })
      this.shown.title = title
    }

    const tooltip = `Tracking Working Time: ${STATUS_TITLE[snapshot.status]}, today ${formatSpoken(snapshot.todayTotalMs)}`
    if (tooltip !== this.shown.tooltip) {
      this.tray.setToolTip(tooltip)
      this.shown.tooltip = tooltip
    }
  }

  destroy(): void {
    this.tray.destroy()
  }

  private icon(key: Indicator | 'template'): NativeImage {
    let image = this.icons.get(key)
    if (!image) {
      image = nativeImage.createFromBuffer(stopwatchPng(key), { scaleFactor: 2 })
      image.setTemplateImage(key === 'template')
      this.icons.set(key, image)
    }
    return image
  }
}
