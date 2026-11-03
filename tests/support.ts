import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect } from 'vitest'
import { dayKey } from '../src/shared/days'
import { DEFAULT_SETTINGS, type Settings, type Snapshot } from '../src/shared/types'
import type { IdleReader } from '../src/main/activityMonitor'
import { TrackingController, type Scheduler } from '../src/main/controller'
import { TimerEngine } from '../src/main/engine'
import { IdlePolicy } from '../src/main/idlePolicy'
import { Ledger } from '../src/main/ledger'
import { FileLedgerStore } from '../src/main/persistence'
import type { Instant, TimeSource } from '../src/main/time'

/** Local time in the test zone (Europe/Berlin). */
export const at = (year: number, month: number, day: number, hour = 9, minute = 0, second = 0): number =>
  new Date(year, month - 1, day, hour, minute, second).getTime()

export const day = (year: number, month: number, date: number): string => dayKey(at(year, month, date, 12))

export function expectSeconds(actualMs: number, expectedSeconds: number, toleranceSeconds = 0.0005): void {
  expect(Math.abs(actualMs / 1000 - expectedSeconds), `${actualMs / 1000} s, expected ${expectedSeconds} s`).toBeLessThanOrEqual(toleranceSeconds)
}

/**
 * Simulated clocks. `mono` behaves like mach_absolute_time: it stops during sleep and ignores
 * clock changes. `wall` keeps running during sleep and can be changed by the user.
 */
export class ManualClock implements TimeSource {
  mono = 5_000_000
  wall: number

  constructor(start = at(2026, 3, 10, 9, 0, 0)) {
    this.wall = start
  }

  now(): Instant {
    return { mono: this.mono, wall: this.wall }
  }

  advance(seconds: number): void {
    this.mono += seconds * 1000
    this.wall += seconds * 1000
  }

  sleep(seconds: number): void {
    this.wall += seconds * 1000
  }

  shiftWall(seconds: number): void {
    this.wall += seconds * 1000
  }
}

/** The HID idle clock as Electron reports it: whole seconds since the last physical input. */
export class SimulatedInput implements IdleReader {
  lastInputMono: number
  locked = false
  readings = 0

  constructor(private readonly clock: ManualClock) {
    this.lastInputMono = clock.mono - 3_600_000
  }

  /** A key press, click, scroll or pointer move: only its time is visible to the app. */
  touch(): void {
    this.lastInputMono = this.clock.mono
  }

  idleSeconds(): number {
    this.readings += 1
    return Math.floor((this.clock.mono - this.lastInputMono) / 1000)
  }

  isScreenLocked(): boolean {
    return this.locked
  }
}

export class ManualScheduler implements Scheduler {
  pending: { callback: () => void; delayMs: number } | null = null

  schedule(callback: () => void, delayMs: number): () => void {
    const entry = { callback, delayMs }
    this.pending = entry
    return () => {
      if (this.pending === entry) this.pending = null
    }
  }
}

/** The full controller with simulated clock, input, system events and a temporary data folder. */
export class Harness {
  readonly clock: ManualClock
  readonly input: SimulatedInput
  readonly power = new EventEmitter()
  readonly scheduler = new ManualScheduler()
  readonly directory = fs.mkdtempSync(path.join(os.tmpdir(), 'twt-test-'))
  store: FileLedgerStore
  controller!: TrackingController
  settings: Settings
  logs: string[] = []

  constructor(options: { start?: number; settings?: Partial<Settings> } = {}) {
    this.clock = new ManualClock(options.start)
    this.input = new SimulatedInput(this.clock)
    this.settings = { ...DEFAULT_SETTINGS, ...options.settings }
    this.store = new FileLedgerStore(this.directory)
    this.launch()
    this.clock.advance(1)
    this.controller.tick()
  }

  launch(): void {
    this.store = new FileLedgerStore(this.directory)
    this.controller = new TrackingController({
      time: this.clock,
      idle: this.input,
      power: this.power,
      scheduler: this.scheduler,
      store: this.store,
      log: (message) => this.logs.push(message)
    })
    this.controller.start(this.settings)
  }

  /** Physical input now; the app notices it at its next poll 0.1 s later. */
  press(): void {
    this.input.touch()
    this.clock.advance(0.1)
    this.controller.tick()
  }

  /** Lets time pass, running every tick the app schedules on the way. */
  wait(seconds: number): void {
    const target = this.clock.mono + seconds * 1000
    while (this.scheduler.pending && this.clock.mono + this.scheduler.pending.delayMs <= target) {
      const { callback, delayMs } = this.scheduler.pending
      this.scheduler.pending = null
      this.clock.mono += delayMs
      this.clock.wall += delayMs
      callback()
    }
    const rest = target - this.clock.mono
    this.clock.mono += rest
    this.clock.wall += rest
    this.controller.tick()
  }

  relaunch(afterSeconds: number): void {
    this.controller.shutdown()
    this.clock.advance(afterSeconds)
    this.launch()
  }

  emit(event: string): void {
    this.power.emit(event)
  }

  get snapshot(): Snapshot {
    return this.controller.snapshot
  }

  get status(): Snapshot['status'] {
    return this.snapshot.status
  }

  /** Seconds shown in the menu bar. */
  get displayed(): number {
    return this.snapshot.todayTotalMs / 1000
  }

  confirmedMs(key = this.snapshot.day): number {
    return this.controller.ledger.activeMs(key)
  }

  tearDown(): void {
    this.controller.shutdown()
    fs.rmSync(this.directory, { recursive: true, force: true })
  }
}

/** The engine alone, with exact input times. */
export class EngineHarness {
  readonly clock: ManualClock
  readonly engine: TimerEngine

  constructor(options: { start?: number; policy?: IdlePolicy } = {}) {
    this.clock = new ManualClock(options.start)
    this.engine = new TimerEngine(new Ledger(), options.policy ?? new IdlePolicy(), this.clock.now())
  }

  /** Input `afterSeconds` from now. */
  input(afterSeconds = 0): void {
    this.clock.advance(afterSeconds)
    this.engine.recordInput(this.clock.now())
  }

  wait(seconds: number): Snapshot {
    this.clock.advance(seconds)
    return this.engine.snapshot(this.clock.now())
  }

  get snapshot(): Snapshot {
    return this.engine.snapshot(this.clock.now())
  }

  confirmedMs(key: string): number {
    return this.engine.ledger.activeMs(key)
  }

  get totalConfirmedMs(): number {
    return this.engine.ledger.totalActiveMs()
  }
}

/** Small deterministic random generator for fuzz tests. */
export function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
