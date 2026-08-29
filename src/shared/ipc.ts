import type {
  ActivityEntry,
  AgentId,
  Assignee,
  ChatMessage,
  Job,
  AttachmentKind,
  ChatDefault,
  Priority,
  Scoreboard,
  Task,
  TaskStatus
} from './types'

/** The contract between the renderer and the main process. */

export interface StartResult {
  ok: boolean
  error?: string
}

export type HumanOutcome = 'accept' | 'send_back' | 'cancel'

export interface AppSettings {
  autoStart: boolean
  /** Who an unaddressed chat message goes to. Stored per project. */
  chatDefault: ChatDefault
}

export interface WiringStatus {
  claude: boolean
  copilot: boolean
  instructions: boolean
}

export interface ProjectState {
  root: string | null
  claudeRunning: boolean
  copilotRunning: boolean
  wiring: WiringStatus | null
  chatDefault: ChatDefault
}

export interface Snapshot {
  project: ProjectState
  tasks: Task[]
  chat: ChatMessage[]
  activity: ActivityEntry[]
  scoreboard: Scoreboard
  jobs: Job[]
}

export interface PlexusApi {
  // project
  openProject: () => Promise<ProjectState>
  chooseProject: () => Promise<ProjectState>
  wireProject: () => Promise<ProjectState>
  getSnapshot: () => Promise<Snapshot | null>

  // terminals
  startAgent: (id: AgentId, cols: number, rows: number) => Promise<StartResult>
  stopAgent: (id: AgentId) => Promise<void>
  writeAgent: (id: AgentId, data: string) => void
  resizeAgent: (id: AgentId, cols: number, rows: number) => void
  agentBuffer: (id: AgentId) => Promise<string>

  // bridge
  sendChat: (message: string) => Promise<void>
  createTask: (input: {
    title: string
    description: string
    assignee?: Assignee
    priority?: Priority
    instructions?: string
    requirements?: string[]
  }) => Promise<Task>
  assignTask: (taskId: string, assignee: Assignee) => Promise<Task>
  updateTask: (taskId: string, patch: { status?: TaskStatus; note?: string }) => Promise<Task>
  resolveTask: (taskId: string, outcome: HumanOutcome, notes: string) => Promise<Task>

  // task detail
  setInstructions: (taskId: string, instructions: string) => Promise<Task>
  addRequirement: (taskId: string, text: string) => Promise<Task>
  setRequirementDone: (taskId: string, requirementId: string, done: boolean) => Promise<Task>
  removeRequirement: (taskId: string, requirementId: string) => Promise<Task>
  addAttachment: (
    taskId: string,
    kind: AttachmentKind,
    name: string,
    value: string
  ) => Promise<Task>
  removeAttachment: (taskId: string, attachmentId: string) => Promise<Task>
  /** Opens a file dialog scoped to the project; resolves to a repo-relative path. */
  pickAttachmentFiles: () => Promise<{ name: string; value: string }[]>

  // settings
  getSettings: () => Promise<AppSettings>
  setSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>

  // events
  onPtyData: (cb: (id: AgentId, chunk: string) => void) => () => void
  onPtyExit: (cb: (id: AgentId, code: number) => void) => () => void
  onSnapshot: (cb: (snapshot: Snapshot) => void) => () => void
}

export const CHANNELS = {
  openProject: 'project:open',
  chooseProject: 'project:choose',
  wireProject: 'project:wire',
  getSnapshot: 'state:snapshot',
  startAgent: 'pty:start',
  stopAgent: 'pty:stop',
  writeAgent: 'pty:write',
  resizeAgent: 'pty:resize',
  agentBuffer: 'pty:buffer',
  sendChat: 'chat:send',
  createTask: 'task:create',
  assignTask: 'task:assign',
  updateTask: 'task:update',
  resolveTask: 'task:resolve',
  setInstructions: 'task:instructions',
  addRequirement: 'task:requirement:add',
  setRequirementDone: 'task:requirement:done',
  removeRequirement: 'task:requirement:remove',
  addAttachment: 'task:attachment:add',
  removeAttachment: 'task:attachment:remove',
  pickAttachmentFiles: 'task:attachment:pick',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  snapshot: 'state:changed'
} as const
