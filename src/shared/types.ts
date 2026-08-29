/** Core domain types shared by the bridge, the MCP server, and the renderer. */

export type AgentId = 'claude' | 'copilot'
export const AGENT_IDS: AgentId[] = ['claude', 'copilot']

/** Who a task can belong to. `self` is resolved to the calling agent at the tool boundary. */
export type Assignee = AgentId | 'human' | 'coordinator' | 'unassigned'

export type TaskStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'revise'
  | 'needs_human'
  | 'done'
  | 'cancelled'

export type Priority = 'low' | 'normal' | 'high'
export type Verdict = 'approve' | 'revise' | 'reject'

export interface TaskNote {
  by: string
  at: string
  text: string
}

/** A checklist item the work has to satisfy. The reviewer is shown these explicitly. */
export interface Requirement {
  id: string
  text: string
  done: boolean
  added_by: string
  added_at: string
}

export type AttachmentKind = 'file' | 'link' | 'note'

/**
 * Context attached to a task. `file` is a repo-relative path the agent can read
 * itself; `link` is a URL; `note` carries its content inline.
 */
export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  /** Path, URL, or inline text depending on `kind`. */
  value: string
  added_by: string
  added_at: string
}

export interface Review {
  verdict: Verdict
  notes: string
  at: string
}

export interface Task {
  id: string
  title: string
  description: string
  created_by: string
  assignee: Assignee
  status: TaskStatus
  priority: Priority
  created_at: string
  updated_at: string
  notes: TaskNote[]
  /** Long-form detail beyond the one-line description: constraints, background, how to verify. */
  instructions: string
  /** What the work must satisfy. Included verbatim in the reviewer's prompt. */
  requirements: Requirement[]
  /** Files, links, and notes the assignee should read first. */
  attachments: Attachment[]
  /** The proposed result, set by `submit_proposal`. */
  result: string | null
  /** Keyed by reviewing agent. Cleared on each new proposal. */
  reviews: Partial<Record<AgentId, Review>>
  revision_rounds: number
}

export interface AgentScore {
  proposals: number
  approved_first_try: number
  needed_revision: number
  reviews_done: number
  issues_caught: number
}

export type Scoreboard = Record<AgentId, AgentScore>

export interface ChatMessage {
  at: string
  speaker: string
  text: string
}

export interface ActivityEntry {
  at: string
  text: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

/** Tier 2 — a unit of work in the file-based mailbox. */
export interface Job {
  id: string
  target: AgentId
  task: string
  requested_by: string
  status: JobStatus
  /** When set, the job is a review dispatch and gets the bridge's own tools. */
  review: boolean
  created_at: string
  started_at: string | null
  finished_at: string | null
  result: string | null
  error: string | null
  /** Optional task this job is doing work for. */
  task_id: string | null
}

export const OTHER: Record<AgentId, AgentId> = { claude: 'copilot', copilot: 'claude' }

/**
 * Who an unaddressed chat message goes to. `ask` is the original behaviour —
 * bounce it back rather than guess — kept because it is the auditable one, but
 * having to @mention every single message gets old fast.
 */
export type ChatDefault = 'ask' | 'claude' | 'copilot' | 'both'

export const DEFAULT_CHAT_TARGET: ChatDefault = 'both'

/** §8: beyond this many revision rounds, the disagreement itself is the signal. */
export const MAX_REVISION_ROUNDS = 2

/** §8: cap headless calls so nothing hangs a turn indefinitely. */
export const DEFAULT_TIMEOUT_SECONDS = 300

export function isAgentId(value: unknown): value is AgentId {
  return value === 'claude' || value === 'copilot'
}

/**
 * Tasks written before instructions/requirements/attachments existed are missing
 * those fields, and `.harness/` is deliberately long-lived state rather than a
 * database with migrations — so every read fills them in.
 */
export function normalizeTask(task: Partial<Task> & { id: string }): Task {
  return {
    instructions: '',
    requirements: [],
    attachments: [],
    notes: [],
    reviews: {},
    revision_rounds: 0,
    result: null,
    ...task
  } as Task
}

export function emptyScore(): AgentScore {
  return {
    proposals: 0,
    approved_first_try: 0,
    needed_revision: 0,
    reviews_done: 0,
    issues_caught: 0
  }
}

export function emptyScoreboard(): Scoreboard {
  return { claude: emptyScore(), copilot: emptyScore() }
}
