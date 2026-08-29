import type { AgentId, Task, Verdict } from '../../shared/types'
import { MAX_REVISION_ROUNDS, OTHER } from '../../shared/types'
import { postChat } from './chat'
import { log } from './log'
import type { HarnessPaths } from './paths'
import { bumpScore } from './scoreboard'
import { addNote, getTask, isTerminal, mutateTask } from './tasks'

/**
 * Tier 6 — the immune system. Nothing reaches `done` on one agent's say-so.
 */

export interface ConsensusDeps {
  /** Runs the reviewing agent headlessly with the bridge's review-scoped tools. */
  dispatchReview: (reviewer: AgentId, prompt: string, taskId: string) => Promise<void>
}

export function reviewPrompt(task: Task, proposer: AgentId): string {
  return [
    `Task ${task.id} ("${task.title}") was proposed by ${proposer}.`,
    '',
    `Description: ${task.description}`,
    '',
    'Proposed result:',
    task.result ?? '(empty)',
    '',
    `Call get_task("${task.id}") if you need the full record, then evaluate this on its merits —`,
    'correctness, completeness, whether it actually solves the task, not just whether it looks',
    'plausible. Do not approve work you have not actually checked.',
    '',
    `Then call submit_review with task_id="${task.id}", a verdict of "approve", "revise", or`,
    '"reject", and notes explaining your reasoning either way. Use "reject" only when the',
    'approach itself is wrong — that escalates to the human instead of another revision round.'
  ].join('\n')
}

export async function submitProposal(
  paths: HarnessPaths,
  deps: ConsensusDeps,
  id: string,
  result: string,
  proposer: AgentId
): Promise<Task> {
  const existing = getTask(paths, id)
  if (isTerminal(existing)) {
    throw new Error(`task ${id} is already ${existing.status}; nothing to propose`)
  }

  const task = mutateTask(paths, id, (t) => {
    t.result = result
    t.status = 'review'
    // A fresh proposal invalidates the previous round's verdicts.
    t.reviews = {}
    addNote(t, proposer, 'submitted a proposal for review')
  })

  bumpScore(paths, proposer, 'proposals')
  log(paths, `PROPOSAL ${id} by ${proposer}`)
  const reviewer = OTHER[proposer]
  postChat(
    paths,
    proposer,
    `proposed a result for "${task.title}" (${id}) — routing to ${reviewer} for review`
  )

  await deps.dispatchReview(reviewer, reviewPrompt(task, proposer), id)
  return getTask(paths, id)
}

export function submitReview(
  paths: HarnessPaths,
  id: string,
  verdict: Verdict,
  notes: string,
  reviewer: AgentId
): Task {
  const proposer = OTHER[reviewer]

  const task = mutateTask(paths, id, (t) => {
    t.reviews[reviewer] = { verdict, notes, at: new Date().toISOString() }
    addNote(t, reviewer, `review: ${verdict} — ${notes}`)

    if (verdict === 'approve') {
      t.status = 'done'
      t.assignee = proposer
      return
    }

    if (verdict === 'reject') {
      // A flat reject means the two disagree on the approach, not the
      // execution. More automated back-and-forth won't resolve that (§8).
      t.status = 'needs_human'
      t.assignee = 'human'
      return
    }

    t.revision_rounds += 1
    if (t.revision_rounds >= MAX_REVISION_ROUNDS) {
      t.status = 'needs_human'
      t.assignee = 'human'
    } else {
      t.status = 'revise'
      t.assignee = proposer
    }
  })

  bumpScore(paths, reviewer, 'reviews_done')
  if (verdict !== 'approve') bumpScore(paths, reviewer, 'issues_caught')

  if (verdict === 'approve') {
    if (task.revision_rounds === 0) bumpScore(paths, proposer, 'approved_first_try')
    postChat(paths, reviewer, `approved "${task.title}" (${id})${notes ? ` — ${notes}` : ''}`)
  } else if (verdict === 'reject') {
    postChat(
      paths,
      'coordinator',
      `${proposer} and ${reviewer} disagree on "${task.title}" (${id}) — ${reviewer} rejected it outright: ${notes}. Needs your call.`
    )
  } else {
    bumpScore(paths, proposer, 'needed_revision')
    if (task.status === 'needs_human') {
      postChat(
        paths,
        'coordinator',
        `"${task.title}" (${id}) has gone through ${task.revision_rounds} revision rounds without agreement — needs your call. Latest note from ${reviewer}: ${notes}`
      )
    } else {
      postChat(paths, reviewer, `sent "${task.title}" (${id}) back for revision — ${notes}`)
    }
  }

  log(paths, `REVIEW ${id} by ${reviewer}: ${verdict} -> ${task.status}`)
  return task
}
