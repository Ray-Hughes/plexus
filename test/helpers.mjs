import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Harness } from '../dist/lib/plexus.mjs'

/** A throwaway project directory with its own `.harness/` tree. */
export function tempHarness() {
  const root = mkdtempSync(join(tmpdir(), 'plexus-test-'))
  const harness = new Harness(root)
  return {
    harness,
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

/** A consensus dep that records the review prompt instead of spawning a CLI. */
export function recordingReviewer() {
  const calls = []
  return {
    calls,
    stub(harness, respond) {
      harness.dispatch = async (from, target, task, opts = {}) => {
        calls.push({ from, target, task, opts })
        return respond ? respond(target, task, opts) : 'ok'
      }
      return harness
    }
  }
}
