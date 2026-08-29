import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * The project the harness is operating on.
 *
 * The MCP server is launched by `claude` / `copilot` with cwd set to the repo
 * root, so cwd is the right default. The Electron app sets PLEXUS_PROJECT_DIR
 * explicitly, because its own cwd is wherever the bundle happens to live.
 */
export function projectDir(): string {
  return resolve(process.env.PLEXUS_PROJECT_DIR ?? process.cwd())
}

export interface HarnessPaths {
  root: string
  harness: string
  activityLog: string
  chatLog: string
  jobsDir: string
  tasksDir: string
  scoreboard: string
  locksDir: string
}

export function harnessPaths(root = projectDir()): HarnessPaths {
  const harness = join(root, '.harness')
  return {
    root,
    harness,
    activityLog: join(harness, 'activity.log'),
    chatLog: join(harness, 'chat.log'),
    jobsDir: join(harness, 'jobs'),
    tasksDir: join(harness, 'tasks'),
    scoreboard: join(harness, 'scoreboard.json'),
    locksDir: join(harness, '.locks')
  }
}

/** Creates the `.harness/` tree. Safe to call repeatedly. */
export function ensureHarness(paths: HarnessPaths = harnessPaths()): HarnessPaths {
  for (const dir of [paths.harness, paths.jobsDir, paths.tasksDir, paths.locksDir]) {
    mkdirSync(dir, { recursive: true })
  }
  return paths
}
