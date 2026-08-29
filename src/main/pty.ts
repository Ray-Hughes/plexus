import { spawn, type IPty } from 'node-pty'
import { platform } from 'node:process'
import type { AgentId } from '../shared/types'
import { findOnPath } from './env'

/**
 * Real PTY processes, not a reimplementation of either CLI's UI. Same approach
 * VS Code's integrated terminal uses, so `claude` and `copilot` behave in a
 * pane exactly as they do in a terminal.
 */

export interface PtySession {
  id: AgentId
  pty: IPty
  /** Everything written so far, so a pane can repaint after a UI remount. */
  buffer: string
}

const SCROLLBACK_LIMIT = 512 * 1024

export interface SpawnOptions {
  cwd: string
  cols?: number
  rows?: number
  /** Overrides the command, for when a CLI is installed under another name. */
  command?: string
  args?: string[]
  /** PATH to launch under — see env.ts for why the app's own PATH won't do. */
  path?: string
}

export class CommandNotFoundError extends Error {
  constructor(readonly command: string) {
    super(
      `"${command}" was not found on PATH.\n\n` +
        `Plexus looks it up using your login shell's PATH, so if it works in a terminal\n` +
        `it should work here. If you installed it just now, restart Plexus.`
    )
    this.name = 'CommandNotFoundError'
  }
}

export class PtyManager {
  private sessions = new Map<AgentId, PtySession>()

  constructor(
    private readonly onData: (id: AgentId, chunk: string) => void,
    private readonly onExit: (id: AgentId, code: number) => void
  ) {}

  /** Resolves the binary without spawning, so a missing CLI is a clear error. */
  locate(id: AgentId, command: string | undefined, path: string): string {
    const wanted = command ?? id
    const found = findOnPath(wanted, path)
    if (!found) throw new CommandNotFoundError(wanted)
    return found
  }

  start(id: AgentId, options: SpawnOptions): PtySession {
    this.kill(id)

    const path = options.path ?? process.env.PATH ?? ''
    const binary = this.locate(id, options.command, path)

    const shellEnv = { ...process.env } as Record<string, string>
    // The bridge instances these CLIs launch must target the opened project,
    // not wherever the packaged app happens to be running from.
    shellEnv.PLEXUS_PROJECT_DIR = options.cwd
    shellEnv.PLEXUS_AGENT = id
    shellEnv.TERM = 'xterm-256color'
    shellEnv.PATH = path

    const pty = spawn(binary, options.args ?? [], {
      name: 'xterm-256color',
      cols: options.cols ?? 100,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env: shellEnv,
      useConpty: platform === 'win32'
    })

    const session: PtySession = { id, pty, buffer: '' }
    this.sessions.set(id, session)

    pty.onData((chunk) => {
      session.buffer = (session.buffer + chunk).slice(-SCROLLBACK_LIMIT)
      this.onData(id, chunk)
    })
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.onExit(id, exitCode)
    })

    return session
  }

  write(id: AgentId, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: AgentId, cols: number, rows: number): void {
    // A resize to zero happens while a pane is hidden and throws on some platforms.
    if (cols < 1 || rows < 1) return
    try {
      this.sessions.get(id)?.pty.resize(cols, rows)
    } catch {
      // The process exited between the check and the call. Nothing to resize.
    }
  }

  buffer(id: AgentId): string {
    return this.sessions.get(id)?.buffer ?? ''
  }

  isRunning(id: AgentId): boolean {
    return this.sessions.has(id)
  }

  kill(id: AgentId): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
