import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Three writers touch `.harness/` concurrently: the Claude-side bridge, the
 * Copilot-side bridge, and the app/coordinator. Everything below assumes that.
 */

/** Write via a temp file + rename, so a reader never observes a half-written file. */
export function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, contents)
  renameSync(tmp, path)
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function readJsonOr<T>(path: string, fallback: T): T {
  try {
    return readJson<T>(path)
  } catch {
    return fallback
  }
}

/**
 * Appending a single short line with O_APPEND is atomic on both macOS and
 * Windows, so the logs need no lock — only the read-modify-write paths do.
 */
export function appendLine(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${line.replace(/\r?\n/g, ' ')}\n`)
}

const LOCK_STALE_MS = 30_000
const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 10_000

/**
 * Advisory lock built on `mkdir`, which is atomic on every filesystem we care
 * about — no dependency, and it works across processes rather than just across
 * async tasks in one process.
 */
export function withLock<T>(locksDir: string, name: string, fn: () => T): T {
  const lock = join(locksDir, `${name}.lock`)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  mkdirSync(locksDir, { recursive: true })

  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      // A process that died holding the lock would otherwise wedge the harness.
      if (isStale(lock)) {
        rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock "${name}" (${lock})`)
      }
      sleep(LOCK_RETRY_MS)
    }
  }

  try {
    return fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

function isStale(lock: string): boolean {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS
  } catch {
    return false
  }
}

/** Deliberately synchronous: the lock must be held across the whole read-modify-write. */
function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function ensureFile(path: string, initial = ''): void {
  if (!existsSync(path)) writeAtomic(path, initial)
}
