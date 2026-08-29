import type { AgentId, Task } from '../shared/types'
import type { Harness } from './bridge'

/**
 * Tier 5 — the central executive. It does no coding itself: it reads what you
 * type, decides who should act, opens a task, dispatches, and posts the result
 * back into the room.
 *
 * The routing rule is deliberately dumb and auditable (§8). No model call gets
 * to decide what happens to your message before you've watched the simple
 * version behave correctly for a while.
 */

export interface Route {
  targets: AgentId[]
  body: string
}

const MENTION = /^\s*@(claude|copilot|both)\b\s*([\s\S]*)$/i

export const ROUTING_HELP =
  'Reply with @claude, @copilot, or @both so I know who should take this.'

export function parseRoute(line: string): Route | null {
  const match = MENTION.exec(line)
  if (!match) return null
  const who = match[1].toLowerCase()
  const targets: AgentId[] = who === 'both' ? ['claude', 'copilot'] : [who as AgentId]
  const body = match[2].trim()
  if (!body) return null
  return { targets, body }
}

export interface HandleResult {
  routed: boolean
  tasks: Task[]
}

/**
 * Handle one line typed by the human. Every piece of chat-routed work goes
 * through submitProposal rather than straight to done — that is what pulls the
 * Tier 6 consensus loop into the shared chat automatically.
 */
export async function handleHumanMessage(harness: Harness, line: string): Promise<HandleResult> {
  const trimmed = line.trim()
  if (!trimmed) return { routed: false, tasks: [] }

  harness.postChat('human', trimmed)

  const route = parseRoute(trimmed)
  if (!route) {
    harness.postChat('coordinator', ROUTING_HELP)
    return { routed: false, tasks: [] }
  }

  const tasks: Task[] = []
  for (const target of route.targets) {
    const task = harness.createTask({
      title: route.body.length > 60 ? `${route.body.slice(0, 57)}...` : route.body,
      description: route.body,
      created_by: 'coordinator',
      assignee: target
    })
    tasks.push(task)

    try {
      // Dispatch the brief rather than the bare line, so anything the human
      // added to the task (instructions, requirements, attachments) travels
      // with it. For a chat-created task that is just the message itself.
      const result = await harness.dispatch('coordinator', target, harness.brief(task.id))
      harness.postChat(target, result)
      await harness.submitProposal(task.id, result, target)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      harness.updateTask(task.id, { status: 'blocked', note: message, by: 'coordinator' })
      harness.postChat('coordinator', `${target} failed: ${message}`)
    }
  }

  return { routed: true, tasks }
}
