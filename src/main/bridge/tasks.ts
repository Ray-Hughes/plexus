import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Attachment,
  AttachmentKind,
  Assignee,
  Priority,
  Requirement,
  Task,
  TaskStatus
} from '../../shared/types'
import { normalizeTask } from '../../shared/types'
import type { HarnessPaths } from './paths'
import { readJson, withLock, writeJson } from './store'

/** Tier 4 — working memory. One JSON file per task, git-diffable by design. */

function taskPath(paths: HarnessPaths, id: string): string {
  // Guard against `../` escaping the tasks directory via a hostile task_id.
  if (!/^task-[a-z0-9]{8}$/.test(id)) throw new Error(`invalid task id: ${id}`)
  return join(paths.tasksDir, `${id}.json`)
}

export function getTask(paths: HarnessPaths, id: string): Task {
  const path = taskPath(paths, id)
  if (!existsSync(path)) throw new Error(`no such task: ${id}`)
  return normalizeTask(readJson<Task>(path))
}

export function saveTask(paths: HarnessPaths, task: Task): Task {
  task.updated_at = new Date().toISOString()
  writeJson(taskPath(paths, task.id), task)
  return task
}

/**
 * Read-modify-write under lock. Every status transition goes through here so
 * two agents touching the same task can't clobber each other's notes.
 */
export function mutateTask(paths: HarnessPaths, id: string, fn: (task: Task) => void): Task {
  return withLock(paths.locksDir, `task-${id}`, () => {
    const task = getTask(paths, id)
    fn(task)
    return saveTask(paths, task)
  })
}

export interface CreateTaskInput {
  title: string
  description: string
  created_by: string
  assignee?: Assignee
  priority?: Priority
  instructions?: string
  requirements?: string[]
}

export function createTask(paths: HarnessPaths, input: CreateTaskInput): Task {
  const id = `task-${randomUUID().replace(/-/g, '').slice(0, 8)}`
  const now = new Date().toISOString()
  const assignee = input.assignee ?? 'unassigned'
  const task: Task = {
    id,
    title: input.title,
    description: input.description,
    created_by: input.created_by,
    assignee,
    status: assignee === 'unassigned' ? 'open' : 'in_progress',
    priority: input.priority ?? 'normal',
    created_at: now,
    updated_at: now,
    notes: [],
    instructions: input.instructions ?? '',
    requirements: (input.requirements ?? []).map((text) => newRequirement(text, input.created_by)),
    attachments: [],
    result: null,
    reviews: {},
    revision_rounds: 0
  }
  writeJson(taskPath(paths, id), task)
  return task
}

const shortId = (prefix: string): string =>
  `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8)}`

export function newRequirement(text: string, by: string): Requirement {
  return { id: shortId('req'), text, done: false, added_by: by, added_at: new Date().toISOString() }
}

export function newAttachment(
  kind: AttachmentKind,
  name: string,
  value: string,
  by: string
): Attachment {
  return { id: shortId('att'), kind, name, value, added_by: by, added_at: new Date().toISOString() }
}

/**
 * What the assignee and the reviewer both need to see. Kept in one place so a
 * dispatch prompt and a review prompt can never drift out of sync about what
 * the task actually asks for.
 */
export function renderBrief(task: Task): string {
  const parts = [`# ${task.title}`, '', task.description]

  if (task.instructions.trim()) {
    parts.push('', '## Instructions', '', task.instructions.trim())
  }

  if (task.requirements.length) {
    parts.push('', '## Requirements — the work must satisfy every one of these', '')
    for (const r of task.requirements) parts.push(`- [${r.done ? 'x' : ' '}] ${r.text}`)
  }

  if (task.attachments.length) {
    parts.push('', '## Attachments', '')
    for (const a of task.attachments) {
      if (a.kind === 'note') parts.push(`- **${a.name}** (note):`, '', `  ${a.value.replace(/\n/g, '\n  ')}`, '')
      else parts.push(`- **${a.name}** (${a.kind}): \`${a.value}\`${a.kind === 'file' ? ' — read this file' : ''}`)
    }
  }

  return parts.join('\n')
}

export function addNote(task: Task, by: string, text: string): void {
  task.notes.push({ by, at: new Date().toISOString(), text })
}

export function listTasks(
  paths: HarnessPaths,
  filter: { assignee?: string; status?: string } = {}
): Task[] {
  if (!existsSync(paths.tasksDir)) return []
  return readdirSync(paths.tasksDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => normalizeTask(readJson<Task>(join(paths.tasksDir, f))))
    .filter((t) => !filter.assignee || t.assignee === filter.assignee)
    .filter((t) => !filter.status || t.status === filter.status)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/** Statuses that mean "nobody is going to touch this again". */
export const TERMINAL_STATUSES: TaskStatus[] = ['done', 'cancelled']

export function isTerminal(task: Task): boolean {
  return TERMINAL_STATUSES.includes(task.status)
}
