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

describe('dispatch commands', () => {
  it('keeps plain dispatch read-only for both agents', async () => {
    const { DEFAULT_DISPATCH_CONFIG } = await import('../dist/lib/plexus.mjs')
    const { claude, copilot } = DEFAULT_DISPATCH_CONFIG.dispatch

    assert.deepEqual(claude.args.slice(-2), ['--allowedTools', 'Read,Grep,Glob'])
    assert.ok(copilot.args.includes('--deny-tool=write'))
    assert.ok(copilot.args.includes('--deny-tool=shell'))
    assert.ok(copilot.args.includes('--no-ask-user'))
  })

  it('grants the reviewer the bridge tools and nothing more', async () => {
    const { DEFAULT_DISPATCH_CONFIG } = await import('../dist/lib/plexus.mjs')
    const { claude, copilot } = DEFAULT_DISPATCH_CONFIG.review

    const allowed = claude.args[claude.args.indexOf('--allowedTools') + 1].split(',')
    assert.deepEqual(allowed, [
      'Read',
      'Grep',
      'Glob',
      'mcp__harness-bridge__get_task',
      'mcp__harness-bridge__submit_review'
    ])

    // Copilot reads MCP config only from ~/.copilot/mcp-config.json, so the
    // project-local file must be passed explicitly — and the allow syntax is
    // `server`, not `mcp(server)`. Both were wrong once; this pins them.
    assert.deepEqual(
      copilot.args.slice(copilot.args.indexOf('--additional-mcp-config'), copilot.args.length),
      ['--additional-mcp-config', '@.copilot/mcp-config.json', '--allow-tool=harness-bridge']
    )
    assert.ok(!copilot.args.some((a) => a.includes('mcp(')), 'mcp(...) is not valid copilot syntax')
    assert.ok(copilot.args.includes('--deny-tool=write'), 'a reviewer still must not write')
  })

  it('substitutes the prompt into exactly one argument', async () => {
    const { DEFAULT_DISPATCH_CONFIG, PROMPT_TOKEN } = await import('../dist/lib/plexus.mjs')
    for (const mode of ['dispatch', 'review']) {
      for (const [agent, spec] of Object.entries(DEFAULT_DISPATCH_CONFIG[mode])) {
        const slots = spec.args.filter((a) => a.includes(PROMPT_TOKEN))
        assert.equal(slots.length, 1, `${mode}.${agent} must have exactly one prompt slot`)
      }
    }
  })
})

describe('activity + chat parsing edge cases', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('keeps a colon in the message body intact', () => {
    harness.postChat('claude', 'note: the retry path is fine')
    const last = harness.getChat(1)[0]
    assert.equal(last.speaker, 'claude')
    assert.equal(last.text, 'note: the retry path is fine')
  })

  it('survives a message containing bracket characters', () => {
    harness.postChat('copilot', '[warn] check src/[id]/page.tsx')
    assert.equal(harness.getChat(1)[0].text, '[warn] check src/[id]/page.tsx')
  })

  it('returns an empty list rather than throwing on a fresh project', () => {
    const { harness: h, cleanup: c } = tempHarness()
    assert.deepEqual(h.getChat(), [])
    assert.deepEqual(h.getActivity(), [])
    assert.deepEqual(h.listTasks(), [])
    assert.deepEqual(h.listJobs(), [])
    c()
  })
})

describe('dispatch environment', () => {
  it('passes the harness spawn environment to the CLI', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.spawnEnv = { PATH: '/custom/bin:/usr/bin' }

    // Stand in for a CLI with node itself, which exists on every platform --
    // /bin/sh does not, and this test failed on the Windows runner.
    harness.dispatchConfig = {
      ...harness.dispatchConfig,
      dispatch: {
        ...harness.dispatchConfig.dispatch,
        copilot: {
          command: process.execPath,
          args: ['-e', 'process.stdout.write(process.env.PATH ?? "")']
        }
      }
    }

    const out = await harness.dispatch('claude', 'copilot', 'ignored')
    assert.equal(out, '/custom/bin:/usr/bin', 'the spawned process must see the resolved PATH')
  })

  it('explains a missing CLI instead of reporting a bare ENOENT', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.dispatchConfig = {
      ...harness.dispatchConfig,
      dispatch: {
        ...harness.dispatchConfig.dispatch,
        copilot: { command: 'definitely-not-installed-xyz', args: ['{{PROMPT}}'] }
      }
    }

    await assert.rejects(
      () => harness.dispatch('claude', 'copilot', 'do a thing'),
      (err) => {
        assert.match(err.message, /was not found on PATH/)
        assert.doesNotMatch(err.message, /ENOENT/)
        assert.equal(err.timedOut, false)
        return true
      }
    )
  })

  it('records the failure on the activity trace', async () => {
    const { harness, cleanup } = tempHarness()
    after(cleanup)
    harness.dispatchConfig = {
      ...harness.dispatchConfig,
      dispatch: {
        ...harness.dispatchConfig.dispatch,
        copilot: { command: 'definitely-not-installed-xyz', args: ['{{PROMPT}}'] }
      }
    }
    await harness.dispatch('claude', 'copilot', 'x').catch(() => {})

    assert.match(harness.getActivity(2).map((e) => e.text).join('\n'), /FAILED <- copilot/)
  })
})
