import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ActivityEntry,
  AgentId,
  Assignee,
  ChatMessage,
  Job,
  Scoreboard,
  Task,
  Verdict
} from '../../shared/types'
import { DEFAULT_TIMEOUT_SECONDS, OTHER } from '../../shared/types'
import { postChat, readChat } from './chat'
import { submitProposal, submitReview } from './consensus'
import {
  DEFAULT_DISPATCH_CONFIG,
  DispatchError,
  runHeadless,
  type DispatchConfig
} from './dispatch'
import { claimNextJob, enqueueJob, finishJob, getJob, listJobs } from './jobs'
import { log, readActivity } from './log'
import { ensureHarness, harnessPaths, type HarnessPaths } from './paths'
import { bumpScore, getScoreboard } from './scoreboard'
import { addNote, createTask, getTask, listTasks, mutateTask, type CreateTaskInput } from './tasks'
import { ensureFile, readJsonOr } from './store'

export * from './paths'
export * from './dispatch'
export { reviewPrompt } from './consensus'

export interface HarnessEvents {
  activity: [ActivityEntry]
  chat: [ChatMessage]
  task: [Task]
  job: [Job]
  scoreboard: [Scoreboard]
}

/**
 * The whole nervous system behind one object. The MCP server exposes it to the
 * CLIs over stdio; Electron exposes the same instance to the renderer over IPC.
 * One implementation, two front doors — §9.2.
 */
export class Harness extends EventEmitter<HarnessEvents> {
  readonly paths: HarnessPaths
  readonly dispatchConfig: DispatchConfig

  constructor(root?: string) {
    super()
    this.paths = ensureHarness(harnessPaths(root))
    ensureFile(this.paths.activityLog)
    ensureFile(this.paths.chatLog)
    ensureFile(this.paths.scoreboard, `${JSON.stringify(getScoreboard(this.paths), null, 2)}\n`)
    this.dispatchConfig = loadDispatchConfig(this.paths)
  }

  // --- Tier 1: activity trace ---

  log(line: string): void {
    log(this.paths, line)
    this.emit('activity', { at: new Date().toISOString(), text: line })
  }

  getActivity(lastN = 20): ActivityEntry[] {
    return readActivity(this.paths, lastN)
  }

  // --- Tier 5: chat ---

  postChat(speaker: string, message: string): ChatMessage {
    const entry = postChat(this.paths, speaker, message)
    this.emit('chat', entry)
    return entry
  }

  getChat(lastN?: number): ChatMessage[] {
    return readChat(this.paths, lastN)
  }

  // --- Tier 4: task board ---

  createTask(input: CreateTaskInput): Task {
    const task = createTask(this.paths, input)
    this.log(`TASK CREATED ${task.id} by ${input.created_by} -> ${task.assignee}: ${task.title}`)
    this.emit('task', task)
    return task
  }

  getTask(id: string): Task {
    return getTask(this.paths, id)
  }

  listTasks(filter?: { assignee?: string; status?: string }): Task[] {
    return listTasks(this.paths, filter)
  }

  assignTask(id: string, assignee: Assignee, by: string): Task {
    const task = mutateTask(this.paths, id, (t) => {
      t.assignee = assignee
      // A task handed to the human is waiting on the human, not in progress —
      // otherwise the escalation paths in Tier 6 get overwritten on the way out.
      t.status =
        assignee === 'unassigned' ? 'open' : assignee === 'human' ? 'needs_human' : 'in_progress'
      addNote(t, by, `assigned to ${assignee}`)
    })
    this.log(`TASK ASSIGNED ${id} -> ${assignee} (by ${by})`)
    if (assignee === 'human') {
      this.postChat('coordinator', `needs your input — ${task.title} (${id})`)
    }
    this.emit('task', task)
    return task
  }

  updateTask(id: string, patch: { status?: Task['status']; note?: string; by: string }): Task {
    const task = mutateTask(this.paths, id, (t) => {
      if (patch.status) t.status = patch.status
      if (patch.note) addNote(t, patch.by, patch.note)
    })
    this.log(`TASK UPDATED ${id}: status=${task.status}`)
    this.emit('task', task)
    return task
  }

  // --- Tiers 2/3: dispatch ---

  /** Synchronous dispatch — the answer comes back before the caller's turn ends. */
  async dispatch(
    from: string,
    target: AgentId,
    task: string,
    opts: { context?: string; timeoutSeconds?: number; review?: boolean } = {}
  ): Promise<string> {
    const prompt = opts.context ? `${task}\n\nContext:\n${opts.context}` : task
    this.log(`DISPATCH ${from} -> ${target}: ${task.slice(0, 120)}`)
    try {
      const out = await runHeadless(target, prompt, {
        review: opts.review,
        timeoutSeconds: opts.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        cwd: this.paths.root,
        config: this.dispatchConfig,
        env: { PLEXUS_PROJECT_DIR: this.paths.root, PLEXUS_AGENT: target }
      })
      this.log(`DONE <- ${target}`)
      return out
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log(`FAILED <- ${target}: ${message}`)
      throw err
    }
  }

  /** Async dispatch — drops a job in the mailbox and returns its id immediately. */
  enqueue(input: Parameters<typeof enqueueJob>[1]): Job {
    const job = enqueueJob(this.paths, input)
    this.log(`JOB QUEUED ${job.id} ${input.requested_by} -> ${input.target}`)
    this.emit('job', job)
    return job
  }

  getJob(id: string): Job {
    return getJob(this.paths, id)
  }

  listJobs(status?: Job['status']): Job[] {
    return listJobs(this.paths, status)
  }

  /**
   * Runs one queued job, if there is one. Returns false when the queue is empty
   * so a watcher loop knows to back off.
   */
  async drainOne(): Promise<boolean> {
    const job = claimNextJob(this.paths)
    if (!job) return false
    this.emit('job', job)
    try {
      const result = await this.dispatch(job.requested_by, job.target, job.task, {
        review: job.review
      })
      this.emit('job', finishJob(this.paths, job.id, { result }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit('job', finishJob(this.paths, job.id, { error: message }))
    }
    return true
  }

  // --- Tier 6: consensus + reward ---

  async submitProposal(id: string, result: string, proposer: AgentId): Promise<Task> {
    const task = await submitProposal(
      this.paths,
      {
        dispatchReview: async (reviewer, prompt, taskId) => {
          try {
            await this.dispatch('bridge', reviewer, prompt, { review: true })
          } catch (err) {
            // A reviewer that crashed or timed out must not leave the task
            // stranded in `review` with nobody coming back to it.
            const message = err instanceof DispatchError ? err.message : String(err)
            this.updateTask(taskId, {
              status: 'needs_human',
              note: `review dispatch to ${reviewer} failed: ${message}`,
              by: 'bridge'
            })
            this.assignTask(taskId, 'human', 'bridge')
            this.postChat(
              'coordinator',
              `couldn't get ${reviewer} to review "${taskId}" (${message}). Needs your call.`
            )
          }
        }
      },
      id,
      result,
      proposer
    )
    this.emit('task', task)
    this.emit('scoreboard', this.getScoreboard())
    return task
  }

  submitReview(id: string, verdict: Verdict, notes: string, reviewer: AgentId): Task {
    const task = submitReview(this.paths, id, verdict, notes, reviewer)
    this.emit('task', task)
    this.emit('scoreboard', this.getScoreboard())
    return task
  }

  /**
   * You breaking a tie is not one of the agents reviewing, so it must not move
   * the scoreboard — the whole point of those tallies is that they record what
   * the agents did unaided.
   */
  resolveByHuman(id: string, outcome: 'accept' | 'send_back' | 'cancel', notes: string): Task {
    const task = mutateTask(this.paths, id, (t) => {
      t.status = outcome === 'accept' ? 'done' : outcome === 'cancel' ? 'cancelled' : 'revise'
      if (outcome === 'send_back' && t.assignee === 'human') {
        // Hand it back to whoever proposed it, not to nobody.
        const reviewer = (Object.keys(t.reviews) as AgentId[])[0]
        if (reviewer) t.assignee = OTHER[reviewer]
      }
      addNote(t, 'human', `resolved by human (${outcome})${notes ? `: ${notes}` : ''}`)
    })
    this.log(`HUMAN RESOLVED ${id}: ${outcome} -> ${task.status}`)
    this.postChat('human', `resolved "${task.title}" (${id}) — ${outcome}${notes ? `: ${notes}` : ''}`)
    this.emit('task', task)
    return task
  }

  getScoreboard(): Scoreboard {
    return getScoreboard(this.paths)
  }

  bumpScore(agent: AgentId, field: Parameters<typeof bumpScore>[2], by = 1): Scoreboard {
    const board = bumpScore(this.paths, agent, field, by)
    this.emit('scoreboard', board)
    return board
  }

  other(agent: AgentId): AgentId {
    return OTHER[agent]
  }
}

/**
 * Both CLIs rename their flags often enough that a project needs an escape
 * hatch that isn't "edit the source". Anything absent falls back to the
 * defaults, so a partial override is fine.
 */
export function loadDispatchConfig(paths: HarnessPaths): DispatchConfig {
  const path = join(paths.harness, 'config.json')
  if (!existsSync(path)) return DEFAULT_DISPATCH_CONFIG
  const raw = readJsonOr<Partial<DispatchConfig>>(path, {})
  return {
    dispatch: { ...DEFAULT_DISPATCH_CONFIG.dispatch, ...raw.dispatch },
    review: { ...DEFAULT_DISPATCH_CONFIG.review, ...raw.review }
  }
}
