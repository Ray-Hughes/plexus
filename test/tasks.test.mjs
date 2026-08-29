import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { tempHarness } from './helpers.mjs'

describe('task board (Tier 4)', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('creates an unassigned task as open', () => {
    const task = harness.createTask({
      title: 'Audit the zip pipeline',
      description: 'Check for a retry-exhausted path',
      created_by: 'claude'
    })
    assert.match(task.id, /^task-[a-z0-9]{8}$/)
    assert.equal(task.status, 'open')
    assert.equal(task.assignee, 'unassigned')
    assert.deepEqual(task.notes, [])
    assert.equal(task.result, null)
    assert.equal(task.revision_rounds, 0)
  })

  it('creates an assigned task as in_progress', () => {
    const task = harness.createTask({
      title: 'x',
      description: 'y',
      created_by: 'copilot',
      assignee: 'claude'
    })
    assert.equal(task.status, 'in_progress')
    assert.equal(task.assignee, 'claude')
  })

  it('records who assigned what', () => {
    const task = harness.createTask({ title: 'a', description: 'b', created_by: 'claude' })
    const assigned = harness.assignTask(task.id, 'copilot', 'claude')
    assert.equal(assigned.assignee, 'copilot')
    assert.equal(assigned.status, 'in_progress')
    assert.equal(assigned.notes.at(-1).text, 'assigned to copilot')
    assert.equal(assigned.notes.at(-1).by, 'claude')
  })

  it('announces human assignment in the shared room', () => {
    const task = harness.createTask({ title: 'needs a call', description: 'b', created_by: 'claude' })
    harness.assignTask(task.id, 'human', 'claude')
    const last = harness.getChat().at(-1)
    assert.equal(last.speaker, 'coordinator')
    assert.match(last.text, /needs your input/)
  })

  it('appends notes without losing earlier ones', () => {
    const task = harness.createTask({ title: 'a', description: 'b', created_by: 'claude' })
    harness.updateTask(task.id, { note: 'first', by: 'claude' })
    const second = harness.updateTask(task.id, { status: 'blocked', note: 'second', by: 'copilot' })
    assert.equal(second.status, 'blocked')
    assert.deepEqual(
      second.notes.map((n) => n.text),
      ['first', 'second']
    )
  })

  it('filters by assignee and status', () => {
    const { harness: h, cleanup: c } = tempHarness()
    h.createTask({ title: 'a', description: 'b', created_by: 'claude', assignee: 'claude' })
    h.createTask({ title: 'c', description: 'd', created_by: 'claude', assignee: 'copilot' })
    assert.equal(h.listTasks({ assignee: 'claude' }).length, 1)
    assert.equal(h.listTasks({ status: 'in_progress' }).length, 2)
    assert.equal(h.listTasks({ assignee: 'claude', status: 'open' }).length, 0)
    c()
  })

  it('rejects a task id that tries to escape the tasks directory', () => {
    assert.throws(() => harness.getTask('../../etc/passwd'), /invalid task id/)
    assert.throws(() => harness.getTask('task-../../x'), /invalid task id/)
  })

  it('reports a missing task rather than returning undefined', () => {
    assert.throws(() => harness.getTask('task-deadbeef'), /no such task/)
  })
})

describe('assignment semantics', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('a task handed to the human is needs_human, not in_progress', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude' })
    assert.equal(harness.assignTask(task.id, 'human', 'claude').status, 'needs_human')
  })

  it('unassigning reopens the task', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'claude', assignee: 'claude' })
    assert.equal(harness.assignTask(task.id, 'unassigned', 'claude').status, 'open')
  })
})
