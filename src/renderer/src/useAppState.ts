import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/types'

/** The single shared state from the main process, kept live while the window is visible. */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void window.tracker.getState().then((next) => active && setState(next))
    }
    refresh()
    const unsubscribe = window.tracker.onState(setState)
    // Windows only receive updates while visible; catch up when shown again.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return state
}
