import { existsSync, readFileSync } from 'node:fs'
import type { ChatMessage } from '../../shared/types'
import type { HarnessPaths } from './paths'
import { appendLine } from './store'

/**
 * Tier 5 — the shared room. One line per message so the file stays tailable
 * from a terminal, which is what the CLI coordinator relies on.
 */
export function postChat(paths: HarnessPaths, speaker: string, message: string): ChatMessage {
  const at = new Date().toISOString()
  appendLine(paths.chatLog, `[${at}] ${speaker}: ${message}`)
  return { at, speaker, text: message }
}

const LINE = /^\[([^\]]+)\]\s([^:]+):\s?([\s\S]*)$/

export function readChat(paths: HarnessPaths, lastN?: number): ChatMessage[] {
  if (!existsSync(paths.chatLog)) return []
  const lines = readFileSync(paths.chatLog, 'utf8').split('\n').filter(Boolean)
  const slice = lastN === undefined ? lines : lines.slice(-lastN)
  return slice.map((line) => {
    const match = LINE.exec(line)
    return match
      ? { at: match[1], speaker: match[2], text: match[3] }
      : { at: '', speaker: 'unknown', text: line }
  })
}
