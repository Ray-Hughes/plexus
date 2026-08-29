import { useState } from 'react'
import type { Assignee, Priority, Task } from '../../shared/types'
import { PlusIcon } from '../components/Icons'
import TaskDetail from './TaskDetail'

/** Tier 4 as a real board: a list you can filter, and a task you can open. */

const ORDER: Record<string, number> = {
  needs_human: 0,
  review: 1,
  revise: 2,
  in_progress: 3,
  blocked: 4,
  open: 5,
  done: 6,
  cancelled: 7
}

type Filter = 'active' | 'mine' | 'done' | 'all'

const FILTERS: { key: Filter; label: string; match: (t: Task) => boolean }[] = [
  { key: 'active', label: 'Active', match: (t) => t.status !== 'done' && t.status !== 'cancelled' },
  { key: 'mine', label: 'Needs you', match: (t) => t.assignee === 'human' },
  { key: 'done', label: 'Closed', match: (t) => t.status === 'done' || t.status === 'cancelled' },
  { key: 'all', label: 'All', match: () => true }
]

interface Props {
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export default function TaskBoard({ tasks, selectedId, onSelect }: Props): JSX.Element {
  const [filter, setFilter] = useState<Filter>('active')
  const [creating, setCreating] = useState(false)

  const selected = selectedId ? tasks.find((t) => t.id === selectedId) : undefined
  if (selected) return <TaskDetail task={selected} onBack={() => onSelect(null)} />

  const match = FILTERS.find((f) => f.key === filter)?.match ?? (() => true)
  const shown = tasks
    .filter(match)
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updated_at.localeCompare(a.updated_at))

  return (
    <div className="view">
      <header className="view-head">
        <h2>Tasks</h2>
        <div className="segmented">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? 'on' : ''}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="count">{tasks.filter(f.match).length}</span>
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}>
          <PlusIcon /> New task
        </button>
      </header>

      <div className="view-body">
        {creating && <CreateTask onDone={() => setCreating(false)} onOpen={onSelect} />}

        {shown.length === 0 && !creating && (
          <div className="empty">
            Nothing here. Either agent opens a task with <code>create_task</code>, anything you
            send in the chat opens one automatically, or start one yourself.
          </div>
        )}

        <div className="task-list">
          {shown.map((task) => (
            <TaskRow key={task.id} task={task} onOpen={() => onSelect(task.id)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }): JSX.Element {
  const met = task.requirements.filter((r) => r.done).length
  const preview = task.instructions || task.description

  return (
    <button className="task-row" onClick={onOpen}>
      <div className="task-row-main">
        <span className="task-title">{task.title}</span>
        <span className={`status ${task.status}`}>{task.status.replace('_', ' ')}</span>
      </div>
      <p className="task-preview">{preview}</p>
      <div className="task-meta">
        <span className="task-id">{task.id}</span>
        <span>→ {task.assignee}</span>
        {task.priority !== 'normal' && <span className={`prio ${task.priority}`}>{task.priority}</span>}
        {task.requirements.length > 0 && (
          <span className={met === task.requirements.length ? 'met' : ''}>
            {met}/{task.requirements.length} requirements
          </span>
        )}
        {task.attachments.length > 0 && <span>{task.attachments.length} attached</span>}
        {task.revision_rounds > 0 && <span>round {task.revision_rounds + 1}</span>}
      </div>
    </button>
  )
}

function CreateTask({
  onDone,
  onOpen
}: {
  onDone: () => void
  onOpen: (id: string) => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState<Assignee>('unassigned')
  const [priority, setPriority] = useState<Priority>('normal')

  async function create(): Promise<void> {
    if (!title.trim() || !description.trim()) return
    const task = await window.plexus.createTask({
      title: title.trim(),
      description: description.trim(),
      assignee,
      priority
    })
    onDone()
    // Straight into the detail view, which is where requirements and
    // attachments get added.
    onOpen(task.id)
  }

  return (
    <div className="create-task">
      <input
        className="field"
        autoFocus
        value={title}
        placeholder="Title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="field"
        rows={3}
        value={description}
        placeholder="What needs doing, in a sentence or two. Detailed instructions and requirements come next."
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="add-row">
        <select className="field" value={assignee} onChange={(e) => setAssignee(e.target.value as Assignee)}>
          <option value="unassigned">Unassigned</option>
          <option value="claude">claude</option>
          <option value="copilot">copilot</option>
          <option value="human">me</option>
        </select>
        <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
        <div className="spacer" />
        <button className="btn" onClick={() => void create()} disabled={!title.trim() || !description.trim()}>
          Create
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}
