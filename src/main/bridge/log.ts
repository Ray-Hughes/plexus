import { existsSync, readFileSync } from 'node:fs'
import type { ActivityEntry } from '../../shared/types'
import type { HarnessPaths } from './paths'
import { appendLine } from './store'

/** Tier 1 — the shared memory trace. Append-only, readable by both agents. */
export function log(paths: HarnessPaths, line: string): void {
  appendLine(paths.activityLog, `[${new Date().toISOString()}] ${line}`)
}

const ENTRY = /^\[([^\]]+)\]\s?([\s\S]*)$/

export function readActivity(paths: HarnessPaths, lastN = 20): ActivityEntry[] {
  if (!existsSync(paths.activityLog)) return []
  const lines = readFileSync(paths.activityLog, 'utf8').split('\n').filter(Boolean)
  return lines.slice(-lastN).map((line) => {
    const match = ENTRY.exec(line)
    return match ? { at: match[1], text: match[2] } : { at: '', text: line }
  })
}
