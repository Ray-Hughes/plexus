import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { handleHumanMessage, parseRoute, ROUTING_HELP } from '../dist/lib/plexus.mjs'
import { tempHarness } from './helpers.mjs'

describe('chat routing (Tier 5)', () => {
  it('routes an explicit mention to one agent', () => {
    assert.deepEqual(parseRoute('@claude check the zip pipeline'), {
      targets: ['claude'],
      body: 'check the zip pipeline'
    })
    assert.deepEqual(parseRoute('@copilot review this'), { targets: ['copilot'], body: 'review this' })
  })

  it('routes @both to both agents', () => {
    assert.deepEqual(parseRoute('@both look at the refactor'), {
      targets: ['claude', 'copilot'],
      body: 'look at the refactor'
    })
  })

  it('is case-insensitive and tolerates leading whitespace', () => {
    assert.deepEqual(parseRoute('  @Claude  do the thing '), {
      targets: ['claude'],
      body: 'do the thing'
    })
  })

  it('refuses to guess when there is no mention', () => {
    assert.equal(parseRoute('someone please look at this'), null)
    assert.equal(parseRoute('@claude'), null, 'a mention with no body is not a request')
    assert.equal(parseRoute('email me @claudette'), null)
  })

  it('bounces an unaddressed message back instead of picking an agent', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    const result = await handleHumanMessage(harness, 'is the build green?')

    assert.equal(result.routed, false)
    assert.deepEqual(result.tasks, [])
    assert.equal(harness.getChat().at(-1).text, ROUTING_HELP)
    assert.equal(harness.listTasks().length, 0, 'no task is opened for an unrouted message')
  })

  it('opens a task per target and routes the result through review', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    const proposed = []
    harness.dispatch = async (_from, target) => `${target} says fine`
    harness.submitProposal = async (id, result, proposer) => {
      proposed.push({ id, result, proposer })
      return harness.getTask(id)
    }

    const result = await handleHumanMessage(harness, '@both check the refactor')

    assert.equal(result.tasks.length, 2)
    assert.deepEqual(
      result.tasks.map((t) => t.assignee),
      ['claude', 'copilot']
    )
    assert.equal(proposed.length, 2, 'chat work never goes straight to done')
    assert.deepEqual(
      proposed.map((p) => p.proposer),
      ['claude', 'copilot']
    )
  })

  it('marks the task blocked when a dispatch fails', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.dispatch = async () => {
      throw new Error('claude not found on PATH')
    }
    const result = await handleHumanMessage(harness, '@claude do a thing')

    assert.equal(harness.getTask(result.tasks[0].id).status, 'blocked')
    assert.match(harness.getChat().at(-1).text, /claude failed: claude not found/)
  })

  it('truncates a long message into a readable task title', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.dispatch = async () => 'ok'
    harness.submitProposal = async (id) => harness.getTask(id)
    const long = 'x'.repeat(200)
    const result = await handleHumanMessage(harness, `@claude ${long}`)

    assert.equal(result.tasks[0].title.length, 60)
    assert.ok(result.tasks[0].title.endsWith('...'))
    assert.equal(result.tasks[0].description, long, 'the full text survives on the task')
  })
})

describe('chat dispatch carries the brief', () => {
  it('dispatches the rendered brief, not just the raw line', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    let dispatched = ''
    harness.dispatch = async (_f, _t, task) => {
      dispatched = task
      return 'ok'
    }
    harness.submitProposal = async (id) => harness.getTask(id)

    await handleHumanMessage(harness, '@claude check the retry path in the upload pipeline')

    assert.match(dispatched, /^# check the retry path/, 'the brief leads with the title')
    assert.match(dispatched, /check the retry path in the upload pipeline/)
  })
})
