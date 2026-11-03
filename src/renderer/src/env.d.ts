import type { TrackerApi } from '../../shared/types'

declare global {
  interface Window {
    /** Provided by the preload script. */
    tracker: TrackerApi
  }
}

export {}
