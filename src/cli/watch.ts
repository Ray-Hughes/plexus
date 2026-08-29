#!/usr/bin/env node
import { Harness } from '../main/bridge'

/**
 * Tier 2 — the mailbox watcher. Claims queued jobs and runs them. Safe to run
 * more than one: claiming is atomic.
 */

const harness = new Harness()
const IDLE_MS = 500

harness.log('WATCHER ONLINE')
process.stdout.write(`plexus watcher · ${harness.paths.root}\n`)

let running = true
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    running = false
    harness.log('WATCHER OFFLINE')
    process.exit(0)
  })
}

harness.on('job', (job) => {
  process.stdout.write(`  ${job.id} ${job.status} → ${job.target}\n`)
})

while (running) {
  const worked = await harness.drainOne()
  if (!worked) await new Promise((r) => setTimeout(r, IDLE_MS))
}
