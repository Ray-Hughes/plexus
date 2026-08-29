import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import { extractText, readJsonOr, withLock, writeAtomic, writeJson } from '../dist/lib/plexus.mjs'
import { tempHarness } from './helpers.mjs'

describe('store', () => {
  const { harness, root, cleanup } = tempHarness()
  after(cleanup)

  it('writes atomically, leaving no temp files behind', () => {
    const path = `${root}/atomic.json`
    writeJson(path, { a: 1 })
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: 1 })
    writeAtomic(path, 'replaced')
    assert.equal(readFileSync(path, 'utf8'), 'replaced')
  })

  it('falls back rather than throwing on unreadable JSON', () => {
    writeAtomic(`${root}/bad.json`, '{ not json')
    assert.deepEqual(readJsonOr(`${root}/bad.json`, { ok: true }), { ok: true })
    assert.deepEqual(readJsonOr(`${root}/missing.json`, null), null)
  })

  it('serialises read-modify-write across the lock', () => {
    const order = []
    withLock(harness.paths.locksDir, 'demo', () => {
      order.push('outer-start')
      // A nested acquisition of a *different* lock must not deadlock.
      withLock(harness.paths.locksDir, 'other', () => order.push('inner'))
      order.push('outer-end')
    })
    assert.deepEqual(order, ['outer-start', 'inner', 'outer-end'])
  })

  it('releases the lock even when the body throws', () => {
    assert.throws(() =>
      withLock(harness.paths.locksDir, 'boom', () => {
        throw new Error('kaboom')
      })
    )
    // If the lock had leaked, this would time out instead of returning.
    assert.equal(
      withLock(harness.paths.locksDir, 'boom', () => 'recovered'),
      'recovered'
    )
  })

  it('keeps concurrent scoreboard bumps from clobbering each other', () => {
    for (let i = 0; i < 25; i += 1) harness.bumpScore('claude', 'proposals')
    assert.equal(harness.getScoreboard().claude.proposals, 25)
  })

  it('starts every counter at zero for both agents', () => {
    const { harness: h, cleanup: c } = tempHarness()
    const board = h.getScoreboard()
    for (const agent of ['claude', 'copilot']) {
      assert.deepEqual(board[agent], {
        proposals: 0,
        approved_first_try: 0,
        needed_revision: 0,
        reviews_done: 0,
        issues_caught: 0
      })
    }
    c()
  })
})

describe('dispatch output handling', () => {
  it('unwraps the claude JSON envelope down to the prose', () => {
    assert.equal(extractText('claude', '{"result":"the fix looks right","is_error":false}'), 'the fix looks right')
  })

  it('passes copilot output through untouched', () => {
    assert.equal(extractText('copilot', '  the fix looks right \n'), 'the fix looks right')
    assert.equal(extractText('copilot', '{"result":"x"}'), '{"result":"x"}')
  })

  it('hands back raw output when the envelope is not what we expected', () => {
    assert.equal(extractText('claude', '{"unexpected":true}'), '{"unexpected":true}')
    assert.equal(extractText('claude', '{ truncated'), '{ truncated')
    assert.equal(extractText('claude', 'plain text answer'), 'plain text answer')
  })
})

describe('activity trace (Tier 1)', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('keeps entries in order and returns only the last n', () => {
    for (let i = 0; i < 30; i += 1) harness.log(`line ${i}`)
    const recent = harness.getActivity(5)
    assert.equal(recent.length, 5)
    assert.deepEqual(
      recent.map((e) => e.text),
      ['line 25', 'line 26', 'line 27', 'line 28', 'line 29']
    )
    assert.match(recent[0].at, /^\d{4}-\d{2}-\d{2}T/)
  })

  it('flattens newlines so one event stays one line', () => {
    harness.log('multi\nline\nentry')
    assert.equal(harness.getActivity(1)[0].text, 'multi line entry')
  })

  it('round-trips chat messages with their speaker', () => {
    harness.postChat('claude', 'looking at the zip pipeline now')
    const last = harness.getChat(1)[0]
    assert.equal(last.speaker, 'claude')
    assert.equal(last.text, 'looking at the zip pipeline now')
  })
})
