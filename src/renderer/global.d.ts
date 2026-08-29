import type { PlexusApi } from '../shared/ipc'

declare global {
  interface Window {
    plexus: PlexusApi
  }
}

export {}
