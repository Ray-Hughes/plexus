#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import type { AgentId, Assignee } from '../shared/types'
import { DEFAULT_TIMEOUT_SECONDS, isAgentId } from '../shared/types'
import { Harness } from './bridge'

/**
 * Tier 3–6 exposed over stdio. Each CLI launches its own instance with its own
 * `--agent=` flag — that identity is what makes `assignee: "self"` resolve to
 * something real, and what tells the server who is proposing or reviewing.
 */

function readAgent(argv: string[]): AgentId {
  const flag = argv.find((a) => a.startsWith('--agent='))?.split('=')[1]
  const value = flag ?? process.env.PLEXUS_AGENT
  if (!isAgentId(value)) {
    throw new Error(
      `harness-bridge needs an identity: pass --agent=claude or --agent=copilot (got ${value ?? 'nothing'})`
    )
  }
  return value
}

const AGENT = readAgent(process.argv.slice(2))
const harness = new Harness()
const resolve = (who: Assignee | 'self' | undefined): Assignee =>
  who === 'self' ? AGENT : ((who ?? 'unassigned') as Assignee)

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

const server = new McpServer(
  { name: 'harness-bridge', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions: `You are "${AGENT}", one of two agents sharing this repo. The other is "${harness.other(AGENT)}".

Before starting significant work, call create_task. Check get_activity to see what the other agent is doing.
When you believe a task is finished, call submit_proposal — never mark it done yourself. The other agent
reviews it, and only its approval closes the task.`
  }
)

// --- Tier 3: dispatch ---

server.registerTool(
  'dispatch',
  {
    title: 'Dispatch to the other agent',
    description:
      'Send a bounded task to the other coding agent and get its result back. The dispatched agent runs read-only (Read/Grep/Glob only).',
    inputSchema: {
      target: z.enum(['claude', 'copilot']).describe('Which agent should do the work'),
      task: z.string().min(1).describe('The task, stated so it stands alone'),
      context: z.string().optional().describe('Extra context appended to the task'),
      mode: z
        .enum(['sync', 'async'])
        .default('sync')
        .describe('sync blocks for the result; async returns a job id to poll with get_job'),
      timeout_seconds: z.number().int().positive().max(3600).default(DEFAULT_TIMEOUT_SECONDS)
    }
  },
  async ({ target, task, context, mode, timeout_seconds }) => {
    if (target === AGENT) return fail(`refusing to dispatch to self (${AGENT})`)
    if (mode === 'async') {
      const job = harness.enqueue({
        target,
        task: context ? `${task}\n\nContext:\n${context}` : task,
        requested_by: AGENT
      })
      return json({ job_id: job.id, status: job.status, poll_with: 'get_job' })
    }
    try {
      return text(await harness.dispatch(AGENT, target, task, { context, timeoutSeconds: timeout_seconds }))
    } catch (err) {
      return fail(`dispatch to ${target} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
)

server.registerTool(
  'get_job',
  {
    title: 'Check an async dispatch',
    description: 'Poll a job created by dispatch(mode: "async").',
    inputSchema: { job_id: z.string() }
  },
  async ({ job_id }) => {
    try {
      return json(harness.getJob(job_id))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

// --- Tier 1/5: awareness ---

server.registerTool(
  'get_activity',
  {
    title: 'Read the shared activity trace',
    description: 'See what the other agent has been doing. Check this before starting work.',
    inputSchema: { last_n: z.number().int().positive().max(500).default(20) }
  },
  async ({ last_n }) => json(harness.getActivity(last_n))
)

server.registerTool(
  'post_chat',
  {
    title: 'Speak into the shared room',
    description: 'Post a message visible to the human and the other agent in the shared chat pane.',
    inputSchema: { message: z.string().min(1) }
  },
  async ({ message }) => {
    harness.postChat(AGENT, message)
    return text('posted')
  }
)

server.registerTool(
  'get_chat',
  {
    title: 'Read the shared room',
    description: 'Read recent messages from the shared chat.',
    inputSchema: { last_n: z.number().int().positive().max(500).default(30) }
  },
  async ({ last_n }) => json(harness.getChat(last_n))
)

// --- Tier 4: task board ---

server.registerTool(
  'create_task',
  {
    title: 'Create a task',
    description: 'Open a task on the shared board so the work is visible and ownable.',
    inputSchema: {
      title: z.string().min(1),
      description: z.string().min(1),
      assignee: z.enum(['claude', 'copilot', 'human', 'self', 'unassigned']).default('unassigned'),
      priority: z.enum(['low', 'normal', 'high']).default('normal'),
      instructions: z.string().optional().describe('Long-form detail: constraints, background, how to verify'),
      requirements: z
        .array(z.string().min(1))
        .optional()
        .describe('Checklist items the work must satisfy; shown verbatim to the reviewer')
    }
  },
  async ({ title, description, assignee, priority, instructions, requirements }) =>
    json(
      harness.createTask({
        title,
        description,
        created_by: AGENT,
        assignee: resolve(assignee),
        priority,
        instructions,
        requirements
      })
    )
)

server.registerTool(
  'assign_task',
  {
    title: 'Assign a task',
    description: 'Hand a task to an agent or to the human.',
    inputSchema: {
      task_id: z.string(),
      assignee: z.enum(['claude', 'copilot', 'human', 'self'])
    }
  },
  async ({ task_id, assignee }) => {
    try {
      return json(harness.assignTask(task_id, resolve(assignee), AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'update_task',
  {
    title: 'Update a task',
    description:
      'Change a task\'s status or add a note. Note: you cannot set "done" here — that requires the other agent\'s approval via submit_proposal.',
    inputSchema: {
      task_id: z.string(),
      status: z
        .enum(['open', 'in_progress', 'blocked', 'review', 'revise', 'needs_human', 'cancelled'])
        .optional(),
      note: z.string().optional()
    }
  },
  async ({ task_id, status, note }) => {
    try {
      return json(harness.updateTask(task_id, { status, note, by: AGENT }))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description: 'List tasks on the shared board, newest activity first.',
    inputSchema: {
      assignee: z.enum(['claude', 'copilot', 'human', 'self', 'unassigned']).optional(),
      status: z
        .enum(['open', 'in_progress', 'blocked', 'review', 'revise', 'needs_human', 'done', 'cancelled'])
        .optional()
    }
  },
  async ({ assignee, status }) =>
    json(harness.listTasks({ assignee: assignee ? resolve(assignee) : undefined, status }))
)

server.registerTool(
  'get_task',
  {
    title: 'Get a task',
    description: 'Read one task in full, including its notes and any reviews.',
    inputSchema: { task_id: z.string() }
  },
  async ({ task_id }) => {
    try {
      return json(harness.getTask(task_id))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

// --- Task detail: instructions, requirements, attachments ---

server.registerTool(
  'get_brief',
  {
    title: 'Read a task brief',
    description:
      "The task rendered as one document: description, instructions, requirements checklist, and attachments. Read this before starting work — it is what you will be reviewed against.",
    inputSchema: { task_id: z.string() }
  },
  async ({ task_id }) => {
    try {
      return text(harness.brief(task_id))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'set_instructions',
  {
    title: 'Set a task\'s detailed instructions',
    description:
      'Replace the long-form instructions on a task: constraints, background, how to verify. Does not touch the one-line description.',
    inputSchema: { task_id: z.string(), instructions: z.string() }
  },
  async ({ task_id, instructions }) => {
    try {
      return json(harness.setInstructions(task_id, instructions, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'add_requirement',
  {
    title: 'Add a requirement',
    description:
      'Add a checklist item the work must satisfy. Requirements are shown verbatim to the reviewing agent, so state them so they can be checked rather than interpreted.',
    inputSchema: { task_id: z.string(), text: z.string().min(1) }
  },
  async ({ task_id, text: requirement }) => {
    try {
      return json(harness.addRequirement(task_id, requirement, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'set_requirement_done',
  {
    title: 'Tick or untick a requirement',
    description:
      'Mark a requirement met or not met. Ticking one is a claim the reviewer will check, not a way to close the task.',
    inputSchema: { task_id: z.string(), requirement_id: z.string(), done: z.boolean() }
  },
  async ({ task_id, requirement_id, done }) => {
    try {
      return json(harness.setRequirementDone(task_id, requirement_id, done, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'add_attachment',
  {
    title: 'Attach context to a task',
    description:
      'Attach a repo file the assignee should read ("file"), a URL ("link"), or inline text ("note").',
    inputSchema: {
      task_id: z.string(),
      kind: z.enum(['file', 'link', 'note']),
      name: z.string().min(1).describe('A short label'),
      value: z.string().min(1).describe('Repo-relative path, URL, or the note text')
    }
  },
  async ({ task_id, kind, name, value }) => {
    try {
      return json(harness.addAttachment(task_id, kind, name, value, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

// --- Tier 6: consensus + reward ---

server.registerTool(
  'submit_proposal',
  {
    title: 'Submit work for review',
    description:
      "Mark a task's work as ready for review. This is how you finish a task — you never set it to done yourself. The other agent is dispatched automatically to evaluate it.",
    inputSchema: {
      task_id: z.string(),
      result: z.string().min(1).describe('What you did and why it satisfies the task')
    }
  },
  async ({ task_id, result }) => {
    try {
      return json(await harness.submitProposal(task_id, result, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'submit_review',
  {
    title: 'Review the other agent\'s work',
    description:
      'Cast a verdict on a proposal. "approve" closes the task, "revise" sends it back with your notes, "reject" escalates to the human because the approach itself is wrong.',
    inputSchema: {
      task_id: z.string(),
      verdict: z.enum(['approve', 'revise', 'reject']),
      notes: z.string().min(1).describe('Your reasoning — required whether you approve or not')
    }
  },
  async ({ task_id, verdict, notes }) => {
    try {
      return json(harness.submitReview(task_id, verdict, notes, AGENT))
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
)

server.registerTool(
  'get_scoreboard',
  {
    title: 'Read the consensus scoreboard',
    description:
      'Per-agent tallies of proposals, first-try approvals, revisions needed, reviews done, and issues caught. A trend, not a verdict on any single task.',
    inputSchema: {}
  },
  async () => json(harness.getScoreboard())
)

harness.log(`BRIDGE ONLINE agent=${AGENT} project=${harness.paths.root}`)
await server.connect(new StdioServerTransport())
