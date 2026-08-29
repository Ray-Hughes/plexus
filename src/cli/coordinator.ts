#!/usr/bin/env node
import { watchFile } from 'node:fs'
import { createInterface } from 'node:readline'
import { Harness } from '../main/bridge'
import { handleHumanMessage } from '../main/coordinator'

/**
 * Pane 3 — the shared room, in a terminal. The Electron app replaces this with
 * a real chat view, but drives the identical routing logic in coordinator.ts.
 */

const harness = new Harness()

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  claude: (s: string) => `\x1b[38;5;209m${s}\x1b[0m`,
  copilot: (s: string) => `\x1b[38;5;75m${s}\x1b[0m`,
  human: (s: string) => `\x1b[38;5;114m${s}\x1b[0m`,
  coordinator: (s: string) => `\x1b[38;5;245m${s}\x1b[0m`
}

function paint(speaker: string): string {
  const tint =
    speaker === 'claude'
      ? c.claude
      : speaker === 'copilot'
        ? c.copilot
        : speaker === 'human'
          ? c.human
          : c.coordinator
  return tint(c.bold(speaker))
}

function routingHint(target: string): string {
  if (target === 'ask') return 'Address a message with @claude, @copilot, or @both. Ctrl-C to exit.'
  const who = target === 'both' ? 'both agents' : target
  return `Messages go to ${who}. @claude or @copilot to pick one. Ctrl-C to exit.`
}

function render(at: string, speaker: string, text: string): void {
  const time = at ? at.slice(11, 19) : '--:--:--'
  process.stdout.write(`${c.dim(time)} ${paint(speaker)} ${text}\n`)
}

process.stdout.write(
  `${c.bold('plexus coordinator')} ${c.dim(`· ${harness.paths.root}`)}\n` +
    `${c.dim(routingHint(harness.chatDefault))}\n\n`
)
for (const message of harness.getChat(50)) render(message.at, message.speaker, message.text)

// Tail the chat log so messages posted by either agent's bridge appear here too.
let cursor = harness.getChat().length
watchFile(harness.paths.chatLog, { interval: 400 }, () => {
  const all = harness.getChat()
  for (const message of all.slice(cursor)) render(message.at, message.speaker, message.text)
  cursor = all.length
})

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
rl.prompt()

let busy = false
const queue: string[] = []

async function pump(): Promise<void> {
  if (busy) return
  busy = true
  while (queue.length) {
    const line = queue.shift() as string
    cursor = harness.getChat().length // our own echo is rendered by the watcher
    await handleHumanMessage(harness, line)
  }
  busy = false
  rl.prompt()
}

rl.on('line', (line) => {
  if (!line.trim()) return rl.prompt()
  queue.push(line)
  void pump()
})

rl.on('close', () => process.exit(0))
