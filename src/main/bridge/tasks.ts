import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Assignee, Priority, Task, TaskStatus } from '../../shared/types'
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
  return readJson<Task>(path)
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
    result: null,
    reviews: {},
    revision_rounds: 0
  }
  writeJson(taskPath(paths, id), task)
  return task
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
    .map((f) => readJson<Task>(join(paths.tasksDir, f)))
    .filter((t) => !filter.assignee || t.assignee === filter.assignee)
    .filter((t) => !filter.status || t.status === filter.status)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/** Statuses that mean "nobody is going to touch this again". */
export const TERMINAL_STATUSES: TaskStatus[] = ['done', 'cancelled']

export function isTerminal(task: Task): boolean {
  return TERMINAL_STATUSES.includes(task.status)
}
