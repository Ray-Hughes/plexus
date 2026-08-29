import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentId, Job } from '../../shared/types'
import type { HarnessPaths } from './paths'
import { readJson, withLock, writeJson } from './store'

/**
 * Tier 2 — the file-based mailbox. `dispatch(mode: "async")` writes a job here
 * and returns immediately; a watcher (in the app, or `plexus-watch` on the CLI)
 * claims it, runs the target headlessly, and writes the result back.
 */

function jobPath(paths: HarnessPaths, id: string): string {
  if (!/^job-[a-z0-9]{8}$/.test(id)) throw new Error(`invalid job id: ${id}`)
  return join(paths.jobsDir, `${id}.json`)
}

export interface EnqueueInput {
  target: AgentId
  task: string
  requested_by: string
  review?: boolean
  task_id?: string | null
}

export function enqueueJob(paths: HarnessPaths, input: EnqueueInput): Job {
  const id = `job-${randomUUID().replace(/-/g, '').slice(0, 8)}`
  const job: Job = {
    id,
    target: input.target,
    task: input.task,
    requested_by: input.requested_by,
    status: 'queued',
    review: input.review ?? false,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    result: null,
    error: null,
    task_id: input.task_id ?? null
  }
  writeJson(jobPath(paths, id), job)
  return job
}

export function getJob(paths: HarnessPaths, id: string): Job {
  const path = jobPath(paths, id)
  if (!existsSync(path)) throw new Error(`no such job: ${id}`)
  return readJson<Job>(path)
}

export function listJobs(paths: HarnessPaths, status?: Job['status']): Job[] {
  if (!existsSync(paths.jobsDir)) return []
  return readdirSync(paths.jobsDir)
    .filter((f) => f.startsWith('job-') && f.endsWith('.json'))
    .map((f) => readJson<Job>(join(paths.jobsDir, f)))
    .filter((j) => !status || j.status === status)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/**
 * Atomically move one queued job to `running`. Returns null if another watcher
 * got there first — that check is what makes it safe to run more than one.
 */
export function claimNextJob(paths: HarnessPaths): Job | null {
  return withLock(paths.locksDir, 'jobs', () => {
    const next = listJobs(paths, 'queued')[0]
    if (!next) return null
    next.status = 'running'
    next.started_at = new Date().toISOString()
    writeJson(jobPath(paths, next.id), next)
    return next
  })
}

export function finishJob(
  paths: HarnessPaths,
  id: string,
  outcome: { result?: string; error?: string }
): Job {
  return withLock(paths.locksDir, 'jobs', () => {
    const job = getJob(paths, id)
    job.status = outcome.error ? 'failed' : 'done'
    job.result = outcome.result ?? null
    job.error = outcome.error ?? null
    job.finished_at = new Date().toISOString()
    writeJson(jobPath(paths, id), job)
    return job
  })
}
