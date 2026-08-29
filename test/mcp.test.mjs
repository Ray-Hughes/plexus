import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'

/**
 * Drives the real bundled server over stdio, the same way `claude` and
 * `copilot` load it. If this passes, the MCP wiring is genuinely correct
 * rather than correct-looking.
 */

const SERVER = resolve(import.meta.dirname, '../dist/cli/harness-bridge.mjs')

async function connect(agent, root) {
  const client = new Client({ name: 'plexus-test', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [SERVER, `--agent=${agent}`],
      env: { ...process.env, PLEXUS_PROJECT_DIR: root },
      stderr: 'pipe'
    })
  )
  return client
}

const textOf = (res) => res.content.map((c) => c.text).join('\n')
const jsonOf = (res) => JSON.parse(textOf(res))

describe('MCP bridge over stdio', () => {
  let root
  let claude
  let copilot

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'plexus-mcp-'))
    claude = await connect('claude', root)
    copilot = await connect('copilot', root)
  })

  after(async () => {
    await claude?.close()
    await copilot?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('advertises every tool the spec calls for', async () => {
    const names = (await claude.listTools()).tools.map((t) => t.name).sort()
    assert.deepEqual(names, [
      'assign_task',
      'create_task',
      'dispatch',
      'get_activity',
      'get_chat',
      'get_job',
      'get_scoreboard',
      'get_task',
      'list_tasks',
      'post_chat',
      'submit_proposal',
      'submit_review',
      'update_task'
    ])
  })

  it('publishes a usable input schema for each tool', async () => {
    for (const tool of (await claude.listTools()).tools) {
      assert.equal(tool.inputSchema.type, 'object', `${tool.name} has no object schema`)
      assert.ok(tool.description?.length > 10, `${tool.name} needs a real description`)
    }
  })

  it('resolves assignee "self" to the calling agent', async () => {
    const mine = jsonOf(
      await claude.callTool({
        name: 'create_task',
        arguments: { title: 'from claude', description: 'd', assignee: 'self' }
      })
    )
    assert.equal(mine.assignee, 'claude')
    assert.equal(mine.created_by, 'claude')

    const theirs = jsonOf(
      await copilot.callTool({
        name: 'create_task',
        arguments: { title: 'from copilot', description: 'd', assignee: 'self' }
      })
    )
    assert.equal(theirs.assignee, 'copilot')
  })

  it('shares one board across both agents', async () => {
    const created = jsonOf(
      await claude.callTool({
        name: 'create_task',
        arguments: { title: 'shared', description: 'both should see this' }
      })
    )
    const seen = jsonOf(await copilot.callTool({ name: 'get_task', arguments: { task_id: created.id } }))
    assert.equal(seen.title, 'shared')

    const listed = jsonOf(await copilot.callTool({ name: 'list_tasks', arguments: {} }))
    assert.ok(listed.some((t) => t.id === created.id))
  })

  it('will not let an agent mark its own task done', async () => {
    const tools = (await claude.listTools()).tools
    const update = tools.find((t) => t.name === 'update_task')
    const statuses = update.inputSchema.properties.status.enum
    assert.ok(!statuses.includes('done'), 'update_task must not expose "done"')
    assert.ok(statuses.includes('blocked'))
  })

  it('carries a message between agents through the shared room', async () => {
    await claude.callTool({ name: 'post_chat', arguments: { message: 'starting on the zip pipeline' } })
    const chat = jsonOf(await copilot.callTool({ name: 'get_chat', arguments: { last_n: 5 } }))
    const mine = chat.find((m) => m.text === 'starting on the zip pipeline')
    assert.ok(mine, 'copilot should see what claude said')
    assert.equal(mine.speaker, 'claude')
  })

  it('shows each agent what the other has been doing', async () => {
    const activity = jsonOf(await copilot.callTool({ name: 'get_activity', arguments: { last_n: 50 } }))
    assert.ok(activity.some((e) => /BRIDGE ONLINE agent=claude/.test(e.text)))
    assert.ok(activity.some((e) => /TASK CREATED/.test(e.text)))
  })

  it('refuses to dispatch to itself', async () => {
    const res = await claude.callTool({
      name: 'dispatch',
      arguments: { target: 'claude', task: 'do something' }
    })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /refusing to dispatch to self/)
  })

  it('returns a job id for an async dispatch without blocking', async () => {
    const res = jsonOf(
      await claude.callTool({
        name: 'dispatch',
        arguments: { target: 'copilot', task: 'review the diff', mode: 'async' }
      })
    )
    assert.match(res.job_id, /^job-[a-z0-9]{8}$/)
    assert.equal(res.status, 'queued')

    const job = jsonOf(await copilot.callTool({ name: 'get_job', arguments: { job_id: res.job_id } }))
    assert.equal(job.target, 'copilot')
    assert.equal(job.requested_by, 'claude')
  })

  it('reports a bad task id as a tool error, not a crash', async () => {
    const res = await claude.callTool({ name: 'get_task', arguments: { task_id: 'task-00000000' } })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /no such task/)
    // The connection must survive it.
    assert.ok((await claude.listTools()).tools.length > 0)
  })

  it('rejects arguments that do not match the schema', async () => {
    const res = await claude.callTool({ name: 'create_task', arguments: { title: 'no description' } })
    assert.equal(res.isError, true)
    assert.match(textOf(res), /validation error.*description/is)
    assert.equal(jsonOf(await claude.callTool({ name: 'list_tasks', arguments: {} })).length > 0, true)
  })

  it('exposes the scoreboard to both agents', async () => {
    const board = jsonOf(await copilot.callTool({ name: 'get_scoreboard', arguments: {} }))
    assert.deepEqual(Object.keys(board).sort(), ['claude', 'copilot'])
    assert.equal(typeof board.claude.proposals, 'number')
  })
})
