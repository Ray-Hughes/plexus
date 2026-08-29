import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * A GUI app launched from Finder or the Dock inherits a bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) — not the one from your shell profile. Since
 * `claude` and `copilot` are usually installed by a version manager (asdf, nvm,
 * volta, homebrew), they are invisible to the app unless we go and ask the
 * login shell what PATH actually is.
 */

let cached: string | null = null

const FALLBACKS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(process.env.HOME ?? '', '.local/bin'),
  join(process.env.HOME ?? '', '.bun/bin'),
  join(process.env.HOME ?? '', '.volta/bin')
]

export async function resolveUserPath(): Promise<string> {
  if (cached) return cached

  const current = process.env.PATH ?? ''
  if (process.platform === 'win32') {
    cached = current
    return cached
  }

  const shell = process.env.SHELL ?? '/bin/zsh'
  let discovered = ''
  try {
    // -i so interactive-only rc files (where version managers usually live) run.
    const { stdout } = await run(shell, ['-ilc', 'printf "%s" "$PATH"'], {
      timeout: 5000,
      env: { ...process.env, TERM: 'dumb' }
    })
    discovered = stdout.trim()
  } catch {
    // A shell that fails or hangs must not stop the app from opening.
  }

  const parts = [...discovered.split(delimiter), ...current.split(delimiter), ...FALLBACKS]
  cached = [...new Set(parts.filter(Boolean))].join(delimiter)
  return cached
}

/** Whether an executable is reachable on the given PATH. */
export function findOnPath(command: string, path: string): string | null {
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(command) ? command : null
  }
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, command + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
