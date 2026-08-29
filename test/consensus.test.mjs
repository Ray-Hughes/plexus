import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { tempHarness } from './helpers.mjs'

/**
 * Every test here stubs `dispatch`, so the reviewer's verdict is chosen by the
 * test rather than by a real headless CLI. The routing, scoring and escalation
 * around it is the real implementation.
 */
function harnessWithReviewer(react) {
  const fixture = tempHarness()
  const seen = []
  fixture.harness.dispatch = async (from, target, task, opts = {}) => {
    seen.push({ from, target, task, review: opts.review === true })
    await react?.(fixture.harness, task)
    return 'reviewed'
  }
  return { ...fixture, seen }
}

function taskIdFrom(prompt) {
  return /task_id="(task-[a-z0-9]{8})"/.exec(prompt)?.[1] ?? /Task (task-[a-z0-9]{8})/.exec(prompt)[1]
}

describe('consensus (Tier 6)', () => {
  it('routes a proposal to the *other* agent, with review tools', async () => {
    const { harness, seen, cleanup } = harnessWithReviewer()
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude', assignee: 'claude' })
    await harness.submitProposal(task.id, 'I fixed it', 'claude')

    assert.equal(seen.length, 1)
    assert.equal(seen[0].target, 'copilot', 'claude proposes, copilot reviews')
    assert.equal(seen[0].review, true, 'reviewer must get the bridge tools')
    assert.match(seen[0].task, /I fixed it/)
  })

  it('leaves a task in review until a verdict lands', async () => {
    const { harness, cleanup } = harnessWithReviewer()
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    const after_ = await harness.submitProposal(task.id, 'r', 'claude')
    assert.equal(after_.status, 'review')
  })

  it('approve closes the task and credits a first-try approval', async () => {
    const { harness, cleanup } = harnessWithReviewer((h, prompt) =>
      h.submitReview(taskIdFrom(prompt), 'approve', 'checked it, holds up', 'copilot')
    )
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    const done = await harness.submitProposal(task.id, 'r', 'claude')

    assert.equal(done.status, 'done')
    const board = harness.getScoreboard()
    assert.equal(board.claude.proposals, 1)
    assert.equal(board.claude.approved_first_try, 1)
    assert.equal(board.claude.needed_revision, 0)
    assert.equal(board.copilot.reviews_done, 1)
    assert.equal(board.copilot.issues_caught, 0)
  })

  it('revise sends it back to the proposer with the notes attached', async () => {
    const { harness, cleanup } = harnessWithReviewer((h, prompt) =>
      h.submitReview(taskIdFrom(prompt), 'revise', 'misses the retry-exhausted case', 'copilot')
    )
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    const bounced = await harness.submitProposal(task.id, 'r', 'claude')

    assert.equal(bounced.status, 'revise')
    assert.equal(bounced.assignee, 'claude')
    assert.equal(bounced.revision_rounds, 1)
    assert.match(bounced.notes.at(-1).text, /retry-exhausted/)
    const board = harness.getScoreboard()
    assert.equal(board.claude.needed_revision, 1)
    assert.equal(board.copilot.issues_caught, 1)
  })

  it('does not credit a first-try approval after a revision round', async () => {
    let round = 0
    const { harness, cleanup } = harnessWithReviewer((h, prompt) => {
      round += 1
      h.submitReview(taskIdFrom(prompt), round === 1 ? 'revise' : 'approve', 'n', 'copilot')
    })
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'first attempt', 'claude')
    const done = await harness.submitProposal(task.id, 'second attempt', 'claude')

    assert.equal(done.status, 'done')
    const board = harness.getScoreboard()
    assert.equal(board.claude.proposals, 2)
    assert.equal(board.claude.approved_first_try, 0, 'it needed a revision, so it does not count')
    assert.equal(board.claude.needed_revision, 1)
  })

  it('escalates to the human after MAX_REVISION_ROUNDS', async () => {
    const { harness, cleanup } = harnessWithReviewer((h, prompt) =>
      h.submitReview(taskIdFrom(prompt), 'revise', 'still not right', 'copilot')
    )
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'a', 'claude')
    const stuck = await harness.submitProposal(task.id, 'b', 'claude')

    assert.equal(stuck.revision_rounds, 2)
    assert.equal(stuck.status, 'needs_human')
    assert.equal(stuck.assignee, 'human')
    assert.match(harness.getChat().at(-1).text, /revision rounds without agreement/)
  })

  it('reject skips revision and escalates straight to the human', async () => {
    const { harness, cleanup } = harnessWithReviewer((h, prompt) =>
      h.submitReview(taskIdFrom(prompt), 'reject', 'wrong approach entirely', 'copilot')
    )
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    const rejected = await harness.submitProposal(task.id, 'r', 'claude')

    assert.equal(rejected.status, 'needs_human')
    assert.equal(rejected.assignee, 'human')
    assert.equal(rejected.revision_rounds, 0, 'a reject is not a revision round')
    assert.match(harness.getChat().at(-1).text, /disagree.*rejected it outright/s)
  })

  it('clears the previous round of verdicts when a new proposal lands', async () => {
    let round = 0
    const { harness, cleanup } = harnessWithReviewer((h, prompt) => {
      round += 1
      if (round === 1) h.submitReview(taskIdFrom(prompt), 'revise', 'n', 'copilot')
    })
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'a', 'claude')
    assert.equal(harness.getTask(task.id).reviews.copilot.verdict, 'revise')
    const second = await harness.submitProposal(task.id, 'b', 'claude')
    assert.deepEqual(second.reviews, {}, 'a stale verdict must not close a new proposal')
  })

  it('refuses to reopen a task that already closed', async () => {
    const { harness, cleanup } = harnessWithReviewer((h, prompt) =>
      h.submitReview(taskIdFrom(prompt), 'approve', 'good', 'copilot')
    )
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'r', 'claude')
    await assert.rejects(() => harness.submitProposal(task.id, 'again', 'claude'), /already done/)
  })

  it('escalates rather than stranding a task when the reviewer fails', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.dispatch = async () => {
      throw new Error('copilot timed out after 300s')
    }
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    const stranded = await harness.submitProposal(task.id, 'r', 'claude')

    assert.equal(stranded.status, 'needs_human')
    assert.equal(stranded.assignee, 'human')
    assert.match(harness.getChat().at(-1).text, /couldn't get copilot to review/)
  })
})

describe('human resolution', () => {
  /** Drives a task to needs_human the way a reject does. */
  function escalated() {
    const fixture = tempHarness()
    fixture.harness.dispatch = async (_f, _t, prompt) => {
      const id = /Task (task-[a-z0-9]{8})/.exec(prompt)[1]
      fixture.harness.submitReview(id, 'reject', 'wrong approach', 'copilot')
      return 'reviewed'
    }
    return fixture
  }

  it('accepting closes the task without touching the scoreboard', async () => {
    const { harness, cleanup } = escalated()
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'r', 'claude')
    const before = harness.getScoreboard()

    const resolved = harness.resolveByHuman(task.id, 'accept', 'close enough')

    assert.equal(resolved.status, 'done')
    assert.deepEqual(
      harness.getScoreboard(),
      before,
      'a human breaking a tie is not one of the agents reviewing'
    )
    assert.match(resolved.notes.at(-1).text, /resolved by human \(accept\): close enough/)
    assert.equal(resolved.notes.at(-1).by, 'human')
  })

  it('sending back hands the task to the proposer, not to nobody', async () => {
    const { harness, cleanup } = escalated()
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'r', 'claude')
    assert.equal(harness.getTask(task.id).assignee, 'human')

    const sent = harness.resolveByHuman(task.id, 'send_back', 'try again')

    assert.equal(sent.status, 'revise')
    assert.equal(sent.assignee, 'claude', 'copilot reviewed, so claude proposed')
  })

  it('dropping it cancels the task', async () => {
    const { harness, cleanup } = escalated()
    after(cleanup)
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'r', 'claude')

    assert.equal(harness.resolveByHuman(task.id, 'cancel', '').status, 'cancelled')
  })

  it('announces the resolution in the shared room', async () => {
    const { harness, cleanup } = escalated()
    after(cleanup)
    const task = harness.createTask({ title: 'the disputed one', description: 'd', created_by: 'claude' })
    await harness.submitProposal(task.id, 'r', 'claude')
    harness.resolveByHuman(task.id, 'accept', 'my call')

    const last = harness.getChat().at(-1)
    assert.equal(last.speaker, 'human')
    assert.match(last.text, /resolved "the disputed one".*accept: my call/)
  })
})
