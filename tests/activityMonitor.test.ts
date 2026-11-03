import { describe, expect, it } from 'vitest'
import { ActivityMonitor } from '../src/main/activityMonitor'
import { ManualClock, random, SimulatedInput } from './support'

function setup() {
  const clock = new ManualClock()
  const input = new SimulatedInput(clock)
  const monitor = new ActivityMonitor(input)
  monitor.poll(clock.now()) // launch: learns about the last input before launch
  return { clock, input, monitor }
}

describe('activity monitor', () => {
  it('reports each input once, at the latest time it can have happened', () => {
    const { clock, input, monitor } = setup()
    clock.advance(5)
    input.touch()
    clock.advance(0.3)
    const result = monitor.poll(clock.now())
    expect(result.kind).toBe('input')
    if (result.kind !== 'input') return
    expect(result.input.mono).toBe(clock.mono) // idle reads 0 s, so "up to now"
    expect(result.bounds.earliestMono).toBe(clock.mono - 1000)

    for (let index = 0; index < 20; index += 1) {
      clock.advance(0.5)
      expect(monitor.poll(clock.now()).kind, 'the same input is not reported again').toBe('same')
    }
  })

  it('gives a bound on the last input with every reading', () => {
    const { clock, input, monitor } = setup()
    input.touch()
    const truth = clock.mono
    clock.advance(0.9)
    monitor.poll(clock.now())
    for (let index = 0; index < 12; index += 1) {
      clock.advance(0.5)
      const result = monitor.poll(clock.now())
      expect(result.kind).toBe('same')
      if (result.kind !== 'same') return
      expect(result.latestMono).toBeGreaterThanOrEqual(truth)
      expect(result.latestMono - truth).toBeLessThan(1000)
    }
  })

  it('never places an input earlier than it happened and never invents one', () => {
    const next = random(42)
    const { clock, input, monitor } = setup()
    let lastTouch = input.lastInputMono
    let reportedFor = lastTouch
    for (let step = 0; step < 20_000; step += 1) {
      if (next() < 0.15) {
        input.touch()
        lastTouch = clock.mono
      }
      clock.advance(0.05 + next() * 1.2)
      const result = monitor.poll(clock.now())
      if (result.kind === 'input') {
        expect(result.input.mono).toBeGreaterThanOrEqual(lastTouch)
        expect(result.input.mono - lastTouch).toBeLessThan(1000)
        expect(lastTouch, 'a report needs a touch since the previous report').toBeGreaterThan(reportedFor)
        expect(result.bounds.earliestMono).toBeLessThanOrEqual(lastTouch)
        reportedFor = lastTouch
      } else {
        expect(result.latestMono).toBeGreaterThanOrEqual(lastTouch)
      }
    }
  })

  it('ignores an idle reading that jumps backwards, such as after sleep', () => {
    const { clock, input, monitor } = setup()
    input.touch()
    clock.advance(0.2)
    monitor.poll(clock.now())
    input.lastInputMono -= 3_600_000 // the idle clock suddenly claims an hour more
    clock.advance(0.5)
    const result = monitor.poll(clock.now())
    expect(result).toEqual({ kind: 'same', latestMono: Number.POSITIVE_INFINITY })
  })
})
