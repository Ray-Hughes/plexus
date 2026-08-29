import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import {
  CHANNELS,
  type AppSettings,
  type HumanOutcome,
  type ProjectState,
  type Snapshot,
  type StartResult
} from '../shared/ipc'
import type { Assignee, AttachmentKind, Priority, TaskStatus } from '../shared/types'
import { DEFAULT_CHAT_TARGET, isAgentId } from '../shared/types'
import { Harness } from './bridge'
import { resolveUserPath } from './env'
import { handleHumanMessage } from './coordinator'
import { CommandNotFoundError, PtyManager } from './pty'
import { wireProject, wiringStatus } from './provision'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings'

/**
 * The app is a shell around the same Harness the CLIs talk to. Nothing here
 * reimplements the bridge — it opens a project, hosts two PTYs, and exposes the
 * bridge over IPC so the Task Board and Scoreboard have something to render.
 */

let window: BrowserWindow | null = null
let harness: Harness | null = null
let ptys: PtyManager | null = null
/**
 * The login shell's PATH — see env.ts. Resolving it means spawning a shell, so
 * handlers that spawn a CLI await this rather than the app deferring its IPC
 * registration (which would race the renderer's very first call).
 */
let userPath = process.env.PATH ?? ''
const pathReady: Promise<void> = resolveUserPath().then((resolved) => {
  userPath = resolved
  if (harness) harness.spawnEnv = { PATH: resolved }
})

const isDev = !app.isPackaged

function send(channel: string, ...args: unknown[]): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
}

function projectState(): ProjectState {
  const root = harness?.paths.root ?? null
  return {
    root,
    claudeRunning: ptys?.isRunning('claude') ?? false,
    copilotRunning: ptys?.isRunning('copilot') ?? false,
    wiring: root ? wiringStatus(root) : null,
    chatDefault: harness?.chatDefault ?? DEFAULT_CHAT_TARGET
  }
}

function snapshot(): Snapshot | null {
  if (!harness) return null
  return {
    project: projectState(),
    tasks: harness.listTasks(),
    chat: harness.getChat(200),
    activity: harness.getActivity(100),
    scoreboard: harness.getScoreboard(),
    jobs: harness.listJobs()
  }
}

/**
 * The bridge fires many small events; the renderer only needs the resulting
 * state. Coalescing on a frame keeps a burst of task writes from thrashing it.
 */
let pending: NodeJS.Timeout | null = null
function pushSnapshot(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    const next = snapshot()
    if (next) send(CHANNELS.snapshot, next)
  }, 60)
}

function openProject(root: string): ProjectState {
  ptys?.killAll()
  harness = new Harness(root)
  // Headless dispatch spawns the CLIs too, and needs the same PATH the panes get.
  harness.spawnEnv = { PATH: userPath }
  for (const event of ['activity', 'chat', 'task', 'job', 'scoreboard'] as const) {
    harness.on(event, pushSnapshot)
  }
  harness.log('APP OPENED PROJECT')

  ptys = new PtyManager(
    (id, chunk) => send(CHANNELS.ptyData, id, chunk),
    (id, code) => {
      send(CHANNELS.ptyExit, id, code)
      pushSnapshot()
    }
  )

  saveSettings({ lastProject: root })
  pushSnapshot()

  if (loadSettings().autoStart ?? DEFAULT_SETTINGS.autoStart) {
    // The renderer refits each pane on mount, so these are just a starting size.
    for (const id of ['claude', 'copilot'] as const) {
      try {
        ptys.start(id, { cwd: root, cols: 100, rows: 28, path: userPath })
      } catch (err) {
        // A missing CLI is reported in its own pane, not as a startup failure.
        harness.log(`AUTOSTART SKIPPED ${id}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
    }
    pushSnapshot()
  }

  return projectState()
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d1017',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  window.on('ready-to-show', () => {
    window?.show()
    // Regenerating the README screenshots: capture the renderer itself, so no
    // system window or dialog can land on top of the shot.
    //   PLEXUS_CAPTURE=/path/shot.png npm run dev
    if (process.env.PLEXUS_CAPTURE) void captureTo(process.env.PLEXUS_CAPTURE)
  })
  window.on('closed', () => {
    window = null
  })

  // External links open in the real browser, never inside the app shell.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function captureTo(path: string): Promise<void> {
  await new Promise((r) => setTimeout(r, Number(process.env.PLEXUS_CAPTURE_DELAY ?? 4000)))
  const image = await window!.webContents.capturePage()
  writeFileSync(path, image.toPNG())
  app.exit(0)
}

// --- IPC ---

function registerIpc(): void {
  ipcMain.handle(CHANNELS.openProject, async () => {
    await pathReady
    const last = loadSettings().lastProject
    if (last && existsSync(last)) return openProject(last)
    return projectState()
  })

  ipcMain.handle(CHANNELS.chooseProject, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open a repo for Claude and Copilot to share',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return projectState()
    await pathReady
    return openProject(result.filePaths[0])
  })

  ipcMain.handle(CHANNELS.getSnapshot, () => snapshot())

  ipcMain.handle(CHANNELS.wireProject, () => {
    if (!harness) return projectState()
    wireProject(harness.paths.root)
    harness.log('APP WIRED BRIDGE INTO PROJECT')
    // Both CLIs read their MCP config at startup, so an already-running pane
    // won't see the bridge until it restarts.
    for (const id of ['claude', 'copilot'] as const) {
      if (ptys?.isRunning(id)) {
        ptys.start(id, { cwd: harness.paths.root, cols: 100, rows: 28, path: userPath })
      }
    }
    pushSnapshot()
    return projectState()
  })

  ipcMain.handle(
    CHANNELS.startAgent,
    async (_e, id: unknown, cols: number, rows: number): Promise<StartResult> => {
      await pathReady
      if (!harness || !ptys || !isAgentId(id)) return { ok: false, error: 'no project open' }
      try {
        ptys.start(id, { cwd: harness.paths.root, cols, rows, path: userPath })
      } catch (err) {
        const error = err instanceof CommandNotFoundError ? err.message : String(err)
        harness.log(`APP FAILED TO START ${id}: ${error.split('\n')[0]}`)
        return { ok: false, error }
      }
      harness.log(`APP STARTED ${id} pane`)
      pushSnapshot()
      return { ok: true }
    }
  )

  ipcMain.handle(CHANNELS.stopAgent, (_e, id: unknown) => {
    if (isAgentId(id)) ptys?.kill(id)
    pushSnapshot()
  })

  ipcMain.on(CHANNELS.writeAgent, (_e, id: unknown, data: string) => {
    if (isAgentId(id)) ptys?.write(id, data)
  })

  ipcMain.on(CHANNELS.resizeAgent, (_e, id: unknown, cols: number, rows: number) => {
    if (isAgentId(id)) ptys?.resize(id, cols, rows)
  })

  ipcMain.handle(CHANNELS.agentBuffer, (_e, id: unknown) =>
    isAgentId(id) ? (ptys?.buffer(id) ?? '') : ''
  )

  ipcMain.handle(CHANNELS.sendChat, async (_e, message: string) => {
    if (!harness) return
    // Identical routing to the CLI coordinator — one implementation (§5).
    await handleHumanMessage(harness, message)
  })

  ipcMain.handle(
    CHANNELS.createTask,
    (
      _e,
      input: { title: string; description: string; assignee?: Assignee; priority?: Priority }
    ) => {
      if (!harness) throw new Error('no project open')
      return harness.createTask({ ...input, created_by: 'human' })
    }
  )

  ipcMain.handle(CHANNELS.assignTask, (_e, taskId: string, assignee: Assignee) => {
    if (!harness) throw new Error('no project open')
    return harness.assignTask(taskId, assignee, 'human')
  })

  ipcMain.handle(
    CHANNELS.updateTask,
    (_e, taskId: string, patch: { status?: TaskStatus; note?: string }) => {
      if (!harness) throw new Error('no project open')
      return harness.updateTask(taskId, { ...patch, by: 'human' })
    }
  )

  const requireHarness = (): Harness => {
    if (!harness) throw new Error('no project open')
    return harness
  }

  ipcMain.handle(CHANNELS.setInstructions, (_e, id: string, instructions: string) =>
    requireHarness().setInstructions(id, instructions, 'human')
  )
  ipcMain.handle(CHANNELS.addRequirement, (_e, id: string, text: string) =>
    requireHarness().addRequirement(id, text, 'human')
  )
  ipcMain.handle(CHANNELS.setRequirementDone, (_e, id: string, reqId: string, done: boolean) =>
    requireHarness().setRequirementDone(id, reqId, done, 'human')
  )
  ipcMain.handle(CHANNELS.removeRequirement, (_e, id: string, reqId: string) =>
    requireHarness().removeRequirement(id, reqId)
  )
  ipcMain.handle(
    CHANNELS.addAttachment,
    (_e, id: string, kind: AttachmentKind, name: string, value: string) =>
      requireHarness().addAttachment(id, kind, name, value, 'human')
  )
  ipcMain.handle(CHANNELS.removeAttachment, (_e, id: string, attId: string) =>
    requireHarness().removeAttachment(id, attId)
  )

  ipcMain.handle(CHANNELS.pickAttachmentFiles, async () => {
    const root = requireHarness().paths.root
    const result = await dialog.showOpenDialog({
      title: 'Attach files from the project',
      defaultPath: root,
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map((absolute) => {
      // Agents read these paths relative to the repo they're pointed at, so a
      // file from outside it has to stay absolute or it would not resolve.
      const rel = relative(root, absolute)
      const inside = rel && !rel.startsWith('..') && !isAbsolute(rel)
      return { name: (inside ? rel : absolute).split(/[\\/]/).pop() ?? 'file', value: inside ? rel : absolute }
    })
  })

  const readSettings = (): AppSettings => ({
    autoStart: loadSettings().autoStart ?? DEFAULT_SETTINGS.autoStart,
    // The routing default belongs to the project, not the machine, so the
    // terminal coordinator sees the same answer the app does.
    chatDefault: harness?.chatDefault ?? DEFAULT_CHAT_TARGET
  })

  ipcMain.handle(CHANNELS.getSettings, readSettings)

  ipcMain.handle(CHANNELS.setSettings, (_e, patch: Partial<AppSettings>): AppSettings => {
    if (patch.chatDefault && harness) harness.setChatDefault(patch.chatDefault)
    if (patch.autoStart !== undefined) saveSettings({ autoStart: patch.autoStart })
    return readSettings()
  })

  ipcMain.handle(
    CHANNELS.resolveTask,
    (_e, taskId: string, outcome: HumanOutcome, notes: string) => {
      if (!harness) throw new Error('no project open')
      return harness.resolveByHuman(taskId, outcome, notes)
    }
  )
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  ptys?.killAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => ptys?.killAll())
