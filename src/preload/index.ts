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
  resolveTask: (taskId, outcome, notes) =>
    ipcRenderer.invoke(CHANNELS.resolveTask, taskId, outcome, notes),

  setInstructions: (taskId, instructions) =>
    ipcRenderer.invoke(CHANNELS.setInstructions, taskId, instructions),
  addRequirement: (taskId, text) => ipcRenderer.invoke(CHANNELS.addRequirement, taskId, text),
  setRequirementDone: (taskId, requirementId, done) =>
    ipcRenderer.invoke(CHANNELS.setRequirementDone, taskId, requirementId, done),
  removeRequirement: (taskId, requirementId) =>
    ipcRenderer.invoke(CHANNELS.removeRequirement, taskId, requirementId),
  addAttachment: (taskId, kind, name, value) =>
    ipcRenderer.invoke(CHANNELS.addAttachment, taskId, kind, name, value),
  removeAttachment: (taskId, attachmentId) =>
    ipcRenderer.invoke(CHANNELS.removeAttachment, taskId, attachmentId),
  pickAttachmentFiles: () => ipcRenderer.invoke(CHANNELS.pickAttachmentFiles),

  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(CHANNELS.setSettings, patch),

  onPtyData: (cb) => subscribe<[AgentId, string]>(CHANNELS.ptyData, cb),
  onPtyExit: (cb) => subscribe<[AgentId, number]>(CHANNELS.ptyExit, cb),
  onSnapshot: (cb) => subscribe<[Snapshot]>(CHANNELS.snapshot, cb)
}

contextBridge.exposeInMainWorld('plexus', api)
