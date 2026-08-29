import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type PlexusApi, type Snapshot } from '../shared/ipc'
import type { AgentId } from '../shared/types'

/**
 * The renderer never touches Node or the filesystem directly — everything it
 * can do is enumerated here.
 */

function subscribe<Args extends unknown[]>(
  channel: string,
  cb: (...args: Args) => void
): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => cb(...(args as Args))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PlexusApi = {
  openProject: () => ipcRenderer.invoke(CHANNELS.openProject),
  chooseProject: () => ipcRenderer.invoke(CHANNELS.chooseProject),
  wireProject: () => ipcRenderer.invoke(CHANNELS.wireProject),
  getSnapshot: () => ipcRenderer.invoke(CHANNELS.getSnapshot),

  startAgent: (id, cols, rows) => ipcRenderer.invoke(CHANNELS.startAgent, id, cols, rows),
  stopAgent: (id) => ipcRenderer.invoke(CHANNELS.stopAgent, id),
  writeAgent: (id, data) => ipcRenderer.send(CHANNELS.writeAgent, id, data),
  resizeAgent: (id, cols, rows) => ipcRenderer.send(CHANNELS.resizeAgent, id, cols, rows),
  agentBuffer: (id) => ipcRenderer.invoke(CHANNELS.agentBuffer, id),

  sendChat: (message) => ipcRenderer.invoke(CHANNELS.sendChat, message),
  createTask: (input) => ipcRenderer.invoke(CHANNELS.createTask, input),
  assignTask: (taskId, assignee) => ipcRenderer.invoke(CHANNELS.assignTask, taskId, assignee),
  updateTask: (taskId, patch) => ipcRenderer.invoke(CHANNELS.updateTask, taskId, patch),
  resolveTask: (taskId, verdict, notes, as) =>
    ipcRenderer.invoke(CHANNELS.resolveTask, taskId, verdict, notes, as),

  onPtyData: (cb) => subscribe<[AgentId, string]>(CHANNELS.ptyData, cb),
  onPtyExit: (cb) => subscribe<[AgentId, number]>(CHANNELS.ptyExit, cb),
  onSnapshot: (cb) => subscribe<[Snapshot]>(CHANNELS.snapshot, cb)
}

contextBridge.exposeInMainWorld('plexus', api)
