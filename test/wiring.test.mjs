import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { bridgeHealth, claudeConfigPath, copilotConfigPath } from '../dist/lib/plexus.mjs'

/**
 * "Wired" has to mean the bridge is really there. An entry pointing into an app
 * bundle that was replaced or deleted makes the agent fail with a bare
 * "No such file or directory", which reads as a Plexus bug rather than a stale
 * path — that is exactly how this repo's own config broke.
 */

function project() {
  const root = mkdtempSync(join(tmpdir(), 'plexus-wiring-'))
  mkdirSync(join(root, '.copilot'), { recursive: true })
  mkdirSync(join(root, 'dist', 'cli'), { recursive: true })
  return root
}

function writeConfig(root, entry, path = claudeConfigPath(root)) {
  writeFileSync(path, JSON.stringify({ mcpServers: entry ? { 'harness-bridge': entry } : {} }))
}

describe('bridge health', () => {
  const root = project()
  after(() => rmSync(root, { recursive: true, force: true }))

  it('reports no entry when nothing is configured', () => {
    writeConfig(root, null)
    const health = bridgeHealth(claudeConfigPath(root), root)
    assert.deepEqual(health, { present: false, wired: false, script: null, reason: 'no-entry' })
  })

  it('reports no entry when the file does not exist at all', () => {
    assert.equal(bridgeHealth(join(root, 'nope.json'), root).reason, 'no-entry')
  })

  it('accepts a relative path once the bridge has been built', () => {
    writeFileSync(join(root, 'dist', 'cli', 'harness-bridge.mjs'), '// built')
    writeConfig(root, { command: 'node', args: ['dist/cli/harness-bridge.mjs', '--agent=claude'] })

    const health = bridgeHealth(claudeConfigPath(root), root)
    assert.equal(health.wired, true)
    assert.equal(health.reason, 'ok')
    assert.equal(health.script, join(root, 'dist', 'cli', 'harness-bridge.mjs'))
  })

  it('rejects a relative path when the bridge has not been built', () => {
    const fresh = project()
    writeConfig(fresh, { command: 'node', args: ['dist/cli/harness-bridge.mjs', '--agent=claude'] })

    const health = bridgeHealth(claudeConfigPath(fresh), fresh)
    assert.equal(health.wired, false)
    assert.equal(health.reason, 'script-missing')
    rmSync(fresh, { recursive: true, force: true })
  })

  it('rejects an entry pointing into an app bundle that is gone', () => {
    writeConfig(root, {
      command: '/Applications/Deleted.app/Contents/MacOS/Plexus',
      args: ['/Applications/Deleted.app/Contents/Resources/cli/harness-bridge.mjs', '--agent=claude'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })

    const health = bridgeHealth(claudeConfigPath(root), root)
    assert.equal(health.present, true, 'the entry exists')
    assert.equal(health.wired, false, 'but it points at nothing')
    assert.equal(health.reason, 'script-missing')
  })

  it('rejects an entry whose launcher is gone even if the script survives', () => {
    const script = join(root, 'dist', 'cli', 'harness-bridge.mjs')
    writeFileSync(script, '// built')
    writeConfig(root, {
      command: '/Applications/Deleted.app/Contents/MacOS/Plexus',
      args: [script, '--agent=claude']
    })

    assert.equal(bridgeHealth(claudeConfigPath(root), root).reason, 'command-missing')
  })

  it('does not treat a bare "node" launcher as missing', () => {
    const script = join(root, 'dist', 'cli', 'harness-bridge.mjs')
    writeFileSync(script, '// built')
    writeConfig(root, { command: 'node', args: [script] })
    assert.equal(bridgeHealth(claudeConfigPath(root), root).wired, true)
  })

  it('reports an entry that names no bridge at all', () => {
    writeConfig(root, { command: 'node', args: ['some-other-server.mjs'] })
    assert.equal(bridgeHealth(claudeConfigPath(root), root).reason, 'no-script')
  })

  it('checks the copilot config in its own location', () => {
    const script = join(root, 'dist', 'cli', 'harness-bridge.mjs')
    writeFileSync(script, '// built')
    writeConfig(
      root,
      { type: 'local', command: 'node', args: [script, '--agent=copilot'] },
      copilotConfigPath(root)
    )
    assert.equal(bridgeHealth(copilotConfigPath(root), root).wired, true)
    assert.match(copilotConfigPath(root), /\.copilot[/\\]mcp-config\.json$/)
  })

  it('survives a config file that is not valid JSON', () => {
    const broken = project()
    writeFileSync(claudeConfigPath(broken), '{ not json')
    assert.equal(bridgeHealth(claudeConfigPath(broken), broken).reason, 'no-entry')
    rmSync(broken, { recursive: true, force: true })
  })
})
