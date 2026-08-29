import { execFile } from 'node:child_process'
import type { AgentId, ChatDefault } from '../../shared/types'
import { DEFAULT_CHAT_TARGET, DEFAULT_TIMEOUT_SECONDS } from '../../shared/types'

/**
 * Tier 3 — the live channel. A headless invocation of the *other* CLI.
 *
 * Both CLIs iterate their flag names, so the argument vectors live in one place
 * and can be overridden per-project via `.harness/config.json` without touching
 * code (see `loadDispatchConfig`).
 */

export interface AgentCommand {
  command: string
  /** `{{PROMPT}}` is replaced with the task text. */
  args: string[]
}

export interface DispatchConfig {
  /** Who an unaddressed chat message goes to. */
  defaultTarget: ChatDefault
  /** Plain dispatch: read-only (§8). */
  dispatch: Record<AgentId, AgentCommand>
  /** Review dispatch: read-only *plus* the bridge's own task/review tools. */
  review: Record<AgentId, AgentCommand>
}

export const PROMPT_TOKEN = '{{PROMPT}}'

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  defaultTarget: DEFAULT_CHAT_TARGET,
  dispatch: {
    claude: {
      command: 'claude',
      args: ['-p', PROMPT_TOKEN, '--output-format', 'json', '--allowedTools', 'Read,Grep,Glob']
    },
    copilot: {
      command: 'copilot',
      args: [
        '-p',
        PROMPT_TOKEN,
        '-s',
        '--no-color',
        '--log-level',
        'none',
        '--no-ask-user',
        '--deny-tool=write',
        '--deny-tool=shell'
      ]
    }
  },
  review: {
    claude: {
      command: 'claude',
      args: [
        '-p',
        PROMPT_TOKEN,
        '--output-format',
        'json',
        '--allowedTools',
        'Read,Grep,Glob,mcp__harness-bridge__get_task,mcp__harness-bridge__submit_review'
      ]
    },
    copilot: {
      command: 'copilot',
      args: [
        '-p',
        PROMPT_TOKEN,
        '-s',
        '--no-color',
        '--log-level',
        'none',
        '--no-ask-user',
        '--deny-tool=write',
        '--deny-tool=shell',
        // Copilot only reads MCP config from ~/.copilot/mcp-config.json, so the
        // project-local one has to be handed to it explicitly. The allow syntax
        // is `server` or `server(tool)` — there is no `mcp(...)` wrapper.
        '--additional-mcp-config',
        '@.copilot/mcp-config.json',
        '--allow-tool=harness-bridge'
      ]
    }
  }
}

export interface RunHeadlessOptions {
  review?: boolean
  timeoutSeconds?: number
  cwd?: string
  config?: DispatchConfig
  /** Identity of the reviewing/dispatched agent, passed to its bridge instance. */
  env?: NodeJS.ProcessEnv
}

export class DispatchError extends Error {
  constructor(
    message: string,
    readonly target: AgentId,
    readonly timedOut: boolean
  ) {
    super(message)
    this.name = 'DispatchError'
  }
}

export async function runHeadless(
  target: AgentId,
  task: string,
  options: RunHeadlessOptions = {}
): Promise<string> {
  const config = options.config ?? DEFAULT_DISPATCH_CONFIG
  const spec = (options.review ? config.review : config.dispatch)[target]
  if (!spec) throw new DispatchError(`no command configured for ${target}`, target, false)

  const args = spec.args.map((a) => (a.includes(PROMPT_TOKEN) ? a.replace(PROMPT_TOKEN, task) : a))
  const timeout = (options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000

  return new Promise((resolve, reject) => {
    execFile(
      spec.command,
      args,
      {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        maxBuffer: 20 * 1024 * 1024,
        timeout,
        killSignal: 'SIGTERM'
      },
      (err, stdout, stderr) => {
        if (err) {
          const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed === true
          const detail = timedOut
            ? `${target} timed out after ${timeout / 1000}s`
            : stderr.trim() || err.message
          return reject(new DispatchError(detail, target, timedOut))
        }
        resolve(extractText(target, stdout))
      }
    )
  })
}

/**
 * `claude --output-format json` wraps the answer in an envelope; `copilot -s`
 * prints it bare. Callers want the prose either way.
 */
export function extractText(target: AgentId, stdout: string): string {
  const trimmed = stdout.trim()
  if (target !== 'claude' || !trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { result?: unknown; is_error?: boolean }
    if (typeof parsed.result === 'string') return parsed.result
  } catch {
    // Not the envelope we expected — hand back what we got rather than nothing.
  }
  return trimmed
}
