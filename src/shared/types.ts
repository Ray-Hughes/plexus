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

/** §8: beyond this many revision rounds, the disagreement itself is the signal. */
export const MAX_REVISION_ROUNDS = 2

/** §8: cap headless calls so nothing hangs a turn indefinitely. */
export const DEFAULT_TIMEOUT_SECONDS = 300

export function isAgentId(value: unknown): value is AgentId {
  return value === 'claude' || value === 'copilot'
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
