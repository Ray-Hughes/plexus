import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readJsonOr } from './store'

/**
 * Whether a project's MCP configs actually point at a bridge that exists.
 *
 * Deliberately free of any Electron import: only *where the bundled bridge
 * lives* needs the app module, and that is the caller's problem. Everything
 * here is a pure function of the project directory.
 */

export const SERVER_KEY = 'harness-bridge'
const BRIDGE_FILE = 'harness-bridge.mjs'

export interface McpServerEntry {
  type?: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>
}

export interface BridgeHealth {
  /** There is a harness-bridge entry at all. */
  present: boolean
  /** The entry names a bridge script, and that script is on disk. */
  wired: boolean
  /** The resolved script path, if the entry named one. */
  script: string | null
  reason: 'ok' | 'no-entry' | 'no-script' | 'script-missing' | 'command-missing'
}

export const claudeConfigPath = (root: string): string => join(root, '.mcp.json')
export const copilotConfigPath = (root: string): string => join(root, '.copilot', 'mcp-config.json')

/**
 * Matching our own path is not enough. An entry can point into an app bundle
 * that has since been replaced, moved or deleted — the agent then fails with a
 * bare "No such file or directory", which reads as a Plexus bug rather than a
 * stale path. So health means: the thing it names is really there.
 */
export function bridgeHealth(configPath: string, root: string): BridgeHealth {
  const entry = readJsonOr<McpConfig>(configPath, {}).mcpServers?.[SERVER_KEY]
  if (!entry) return { present: false, wired: false, script: null, reason: 'no-entry' }

  const named = entry.args?.find((a) => a.endsWith(BRIDGE_FILE))
  if (!named) return { present: true, wired: false, script: null, reason: 'no-script' }

  const script = isAbsolute(named) ? named : resolve(root, named)
  if (!existsSync(script)) {
    return { present: true, wired: false, script, reason: 'script-missing' }
  }

  // `node` is resolved from PATH at spawn time; an absolute launcher must exist.
  const command = entry.command
  if (command && command !== 'node' && isAbsolute(command) && !existsSync(command)) {
    return { present: true, wired: false, script, reason: 'command-missing' }
  }

  return { present: true, wired: true, script, reason: 'ok' }
}

export function instructionsWritten(root: string): boolean {
  const path = join(root, 'CLAUDE.md')
  return existsSync(path) && readFileSync(path, 'utf8').includes('submit_proposal')
}
