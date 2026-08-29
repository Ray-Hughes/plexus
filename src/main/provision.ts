import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readJsonOr, writeAtomic, writeJson } from './bridge/store'

/**
 * A project only gets the bridge once its MCP configs point at it. In a
 * packaged app that path lives inside the bundle, so it has to be written per
 * project rather than committed.
 *
 * Everything here merges into whatever is already in those files — a project
 * with its own MCP servers keeps them.
 */

const SERVER_KEY = 'harness-bridge'
const MARKER = '<!-- plexus:harness -->'

export interface WiringStatus {
  claude: boolean
  copilot: boolean
  instructions: boolean
}

interface McpServerEntry {
  type?: string
  command: string
  args: string[]
  env?: Record<string, string>
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>
}

/** The bundled MCP server, wherever this build keeps it. */
export function bridgeEntryPoint(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'cli', 'harness-bridge.mjs')
    : join(app.getAppPath(), 'dist', 'cli', 'harness-bridge.mjs')
}

const claudeConfigPath = (root: string): string => join(root, '.mcp.json')
const copilotConfigPath = (root: string): string => join(root, '.copilot', 'mcp-config.json')

function pointsAtBridge(configPath: string, root: string, entry: string): boolean {
  const args = readJsonOr<McpConfig>(configPath, {}).mcpServers?.[SERVER_KEY]?.args
  if (!args) return false
  // A checked-in config may use a path relative to the repo (that is what this
  // repo's own .mcp.json does), so compare resolved paths rather than strings.
  return args.some((arg) => (isAbsolute(arg) ? arg : resolve(root, arg)) === resolve(entry))
}

export function wiringStatus(root: string): WiringStatus {
  const entry = bridgeEntryPoint()
  const claudeMd = join(root, 'CLAUDE.md')
  return {
    claude: pointsAtBridge(claudeConfigPath(root), root, entry),
    copilot: pointsAtBridge(copilotConfigPath(root), root, entry),
    instructions: existsSync(claudeMd) && readFileSync(claudeMd, 'utf8').includes('submit_proposal')
  }
}

export function wireProject(root: string): WiringStatus {
  const entry = bridgeEntryPoint()

  const targets = [
    { path: claudeConfigPath(root), agent: 'claude', type: undefined },
    { path: copilotConfigPath(root), agent: 'copilot', type: 'local' }
  ] as const

  for (const target of targets) {
    const config = readJsonOr<McpConfig>(target.path, {})
    config.mcpServers = {
      ...config.mcpServers,
      [SERVER_KEY]: {
        ...(target.type ? { type: target.type } : {}),
        // Electron's own binary runs as plain node under this env var, so a
        // packaged Plexus wires up a project without needing node installed.
        command: process.execPath,
        args: [entry, `--agent=${target.agent}`],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    }
    writeJson(target.path, config)
  }

  writeInstructions(root)
  return wiringStatus(root)
}

/** Tier 1: the instructions each tool needs, appended without stomping the file. */
function writeInstructions(root: string): void {
  const block = [
    MARKER,
    '',
    '## Working alongside the other agent',
    '',
    'You share this repo with a second agent running in its own terminal. Before starting',
    'significant work, call `get_activity` to see what it has been doing, and open a task with',
    '`create_task` so your work is visible.',
    '',
    '**You do not mark your own work done.** When you think a task is finished, call',
    '`submit_proposal`. The other agent reviews it: approve closes the task, `revise` sends it',
    'back with notes, and `reject` escalates to the human because the approach itself is wrong.',
    '',
    'When you are the reviewer, actually check the work. Approving something you have not',
    'verified is the one failure mode this harness exists to prevent.',
    ''
  ].join('\n')

  for (const file of ['CLAUDE.md', join('.github', 'copilot-instructions.md')]) {
    const path = join(root, file)
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (existing.includes(MARKER)) continue
    writeAtomic(path, existing.trim() ? `${existing.trimEnd()}\n\n${block}` : block)
  }
}
