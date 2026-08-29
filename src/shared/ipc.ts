import type {
  ActivityEntry,
  AgentId,
  Assignee,
  ChatMessage,
  Job,
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
  }) => Promise<Task>
  assignTask: (taskId: string, assignee: Assignee) => Promise<Task>
  updateTask: (taskId: string, patch: { status?: TaskStatus; note?: string }) => Promise<Task>
  resolveTask: (taskId: string, outcome: HumanOutcome, notes: string) => Promise<Task>

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
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  snapshot: 'state:changed'
} as const
