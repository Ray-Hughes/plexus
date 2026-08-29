import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { tempHarness } from './helpers.mjs'

describe('job mailbox (Tier 2)', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('queues a job and returns an id to poll', () => {
    const job = harness.enqueue({ target: 'copilot', task: 'review the diff', requested_by: 'claude' })
    assert.match(job.id, /^job-[a-z0-9]{8}$/)
    assert.equal(job.status, 'queued')
    assert.equal(job.result, null)
    assert.equal(harness.getJob(job.id).status, 'queued')
  })

  it('runs a queued job and writes the result back', async () => {
    const { harness: h, cleanup: c } = tempHarness()
    h.dispatch = async () => 'the diff looks fine'
    const job = h.enqueue({ target: 'copilot', task: 't', requested_by: 'claude' })

    assert.equal(await h.drainOne(), true)
    const done = h.getJob(job.id)
    assert.equal(done.status, 'done')
    assert.equal(done.result, 'the diff looks fine')
    assert.ok(done.started_at && done.finished_at)
    c()
  })

  it('records a failure instead of retrying forever', async () => {
    const { harness: h, cleanup: c } = tempHarness()
    h.dispatch = async () => {
      throw new Error('copilot timed out after 300s')
    }
    const job = h.enqueue({ target: 'copilot', task: 't', requested_by: 'claude' })
    await h.drainOne()

    const failed = h.getJob(job.id)
    assert.equal(failed.status, 'failed')
    assert.match(failed.error, /timed out/)
    assert.equal(failed.result, null)
    c()
  })

  it('reports an empty queue so a watcher can back off', async () => {
    const { harness: h, cleanup: c } = tempHarness()
    assert.equal(await h.drainOne(), false)
    c()
  })

  it('claims each job exactly once, even with two watchers', async () => {
    const { harness: h, cleanup: c } = tempHarness()
    const claimed = []
    h.dispatch = async (_from, _target, task) => {
      claimed.push(task)
      return 'ok'
    }
    for (const n of [1, 2, 3]) h.enqueue({ target: 'copilot', task: `job ${n}`, requested_by: 'claude' })

    // Two "watchers" draining concurrently.
    await Promise.all([
      (async () => {
        while (await h.drainOne());
      })(),
      (async () => {
        while (await h.drainOne());
      })()
    ])

    assert.equal(claimed.length, 3, 'no job runs twice and none is dropped')
    assert.deepEqual([...claimed].sort(), ['job 1', 'job 2', 'job 3'])
    c()
  })

  it('rejects a job id that tries to escape the jobs directory', () => {
    assert.throws(() => harness.getJob('../secrets'), /invalid job id/)
  })
})
