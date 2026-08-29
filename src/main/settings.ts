import { app } from 'electron'
import { join } from 'node:path'
import { readJsonOr, writeJson } from './bridge/store'

export interface Settings {
  lastProject?: string
  /** Bring both agent panes up automatically when a project opens. */
  autoStart?: boolean
}

export const DEFAULT_SETTINGS: Required<Pick<Settings, 'autoStart'>> = { autoStart: true }

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  return readJsonOr<Settings>(settingsPath(), {})
}

export function saveSettings(patch: Settings): Settings {
  const next = { ...loadSettings(), ...patch }
  writeJson(settingsPath(), next)
  return next
}
