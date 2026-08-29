import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
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

describe('task detail: instructions, requirements, attachments', () => {
  const { harness, cleanup } = tempHarness()
  after(cleanup)

  it('defaults the new fields on a fresh task', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'human' })
    assert.equal(task.instructions, '')
    assert.deepEqual(task.requirements, [])
    assert.deepEqual(task.attachments, [])
  })

  it('accepts instructions and requirements at creation', () => {
    const task = harness.createTask({
      title: 'Fix the upload retry',
      description: 'Retries are exhausted silently',
      created_by: 'human',
      instructions: 'Do not change the public signature of uploadArtifact.',
      requirements: ['surfaces the failure to the caller', 'covered by a test']
    })
    assert.match(task.instructions, /public signature/)
    assert.equal(task.requirements.length, 2)
    assert.equal(task.requirements[0].done, false)
    assert.match(task.requirements[0].id, /^req-[a-z0-9]{8}$/)
    assert.equal(task.requirements[0].added_by, 'human')
  })

  it('adds, ticks, and removes a requirement', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'human' })
    const added = harness.addRequirement(task.id, 'handles the empty case', 'claude')
    const req = added.requirements[0]

    const ticked = harness.setRequirementDone(task.id, req.id, true, 'claude')
    assert.equal(ticked.requirements[0].done, true)
    assert.match(ticked.notes.at(-1).text, /met requirement: handles the empty case/)

    assert.equal(harness.setRequirementDone(task.id, req.id, false, 'claude').requirements[0].done, false)
    assert.deepEqual(harness.removeRequirement(task.id, req.id).requirements, [])
  })

  it('reports an unknown requirement rather than silently doing nothing', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'human' })
    assert.throws(() => harness.setRequirementDone(task.id, 'req-00000000', true, 'human'), /no such requirement/)
  })

  it('attaches files, links and notes, and removes them', () => {
    const task = harness.createTask({ title: 't', description: 'd', created_by: 'human' })
    harness.addAttachment(task.id, 'file', 'the pipeline', 'src/zip/pipeline.ts', 'human')
    harness.addAttachment(task.id, 'link', 'the ticket', 'https://example.com/1', 'human')
    const withNote = harness.addAttachment(task.id, 'note', 'repro', 'upload a 0-byte file', 'human')

    assert.deepEqual(
      withNote.attachments.map((a) => a.kind),
      ['file', 'link', 'note']
    )
    assert.match(withNote.attachments[0].id, /^att-[a-z0-9]{8}$/)
    assert.equal(harness.removeAttachment(task.id, withNote.attachments[1].id).attachments.length, 2)
  })

  it('renders a brief that carries everything an agent needs', () => {
    const task = harness.createTask({
      title: 'Fix the upload retry',
      description: 'Retries are exhausted silently',
      created_by: 'human',
      instructions: 'Do not change the public signature.',
      requirements: ['surfaces the failure', 'covered by a test']
    })
    harness.addAttachment(task.id, 'file', 'the pipeline', 'src/zip/pipeline.ts', 'human')
    harness.setRequirementDone(task.id, harness.getTask(task.id).requirements[0].id, true, 'claude')

    const brief = harness.brief(task.id)
    assert.match(brief, /# Fix the upload retry/)
    assert.match(brief, /Retries are exhausted silently/)
    assert.match(brief, /## Instructions[\s\S]*public signature/)
    assert.match(brief, /- \[x\] surfaces the failure/)
    assert.match(brief, /- \[ \] covered by a test/)
    assert.match(brief, /src\/zip\/pipeline\.ts.*read this file/)
  })

  it('omits empty sections from the brief', () => {
    const task = harness.createTask({ title: 'bare', description: 'just this', created_by: 'human' })
    const brief = harness.brief(task.id)
    assert.doesNotMatch(brief, /## Instructions|## Requirements|## Attachments/)
  })

  it('fills in the new fields when reading a task written before they existed', () => {
    const { harness: h, cleanup: c } = tempHarness()
    const task = h.createTask({ title: 't', description: 'd', created_by: 'human' })
    // Simulate a task file from an older build.
    const path = `${h.paths.tasksDir}/${task.id}.json`
    const legacy = JSON.parse(readFileSync(path, 'utf8'))
    delete legacy.instructions
    delete legacy.requirements
    delete legacy.attachments
    writeFileSync(path, JSON.stringify(legacy))

    const read = h.getTask(task.id)
    assert.equal(read.instructions, '')
    assert.deepEqual(read.requirements, [])
    assert.deepEqual(read.attachments, [])
    assert.doesNotThrow(() => h.brief(task.id))
    c()
  })
})
