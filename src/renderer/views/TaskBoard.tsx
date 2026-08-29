import { useState } from 'react'
import type { AgentId, Task } from '../../shared/types'

/** Tier 4 as an actual board, rather than a directory of JSON files. */

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

interface Props {
  tasks: Task[]
}

export default function TaskBoard({ tasks }: Props): JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (tasks.length === 0) {
    return (
      <div className="tab-body">
        <div className="empty">
          No tasks yet. Either agent opens one with <code>create_task</code>, and anything you send
          in the chat opens one automatically.
        </div>
      </div>
    )
  }

  const sorted = [...tasks].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.updated_at.localeCompare(a.updated_at)
  )

  return (
    <div className="tab-body">
      <div className="board">
        {sorted.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            open={expanded === task.id}
            onToggle={() => setExpanded(expanded === task.id ? null : task.id)}
          />
        ))}
      </div>
    </div>
  )
}

function TaskCard({
  task,
  open,
  onToggle
}: {
  task: Task
  open: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div className="task">
      <div className="task-head" onClick={onToggle} style={{ cursor: 'pointer' }}>
        <span className="task-title">{task.title}</span>
        <span className={`status ${task.status}`}>{task.status.replace('_', ' ')}</span>
      </div>

      <div className="task-meta">
        <span className="task-id">{task.id}</span>
        <span>→ {task.assignee}</span>
        {task.priority !== 'normal' && <span>{task.priority} priority</span>}
        {task.revision_rounds > 0 && (
          <span>
            {task.revision_rounds} revision round{task.revision_rounds === 1 ? '' : 's'}
          </span>
        )}
        {task.notes.length > 0 && (
          <span>
            {task.notes.length} note{task.notes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {open && (
        <>
          <div className="task-body">{task.description}</div>

          {task.result && (
            <div className="task-body">
              <b>Proposed:</b> {task.result}
            </div>
          )}

          {Object.entries(task.reviews).map(([reviewer, review]) => (
            <div className="task-body" key={reviewer}>
              <b>
                {reviewer} · {review.verdict}
              </b>{' '}
              — {review.notes}
            </div>
          ))}

          {task.notes.length > 0 && (
            <div className="notes">
              {task.notes.map((note, i) => (
                <div className="note" key={i}>
                  <b>{note.by}</b> {note.text}
                </div>
              ))}
            </div>
          )}

          {task.status === 'needs_human' && <Escalation task={task} />}
        </>
      )}
    </div>
  )
}

/**
 * The two agents couldn't agree, so the call is yours. It is recorded on the
 * task but deliberately not on the scoreboard: those tallies are meant to show
 * what the agents managed unaided.
 */
function Escalation({ task }: { task: Task }): JSX.Element {
  const [notes, setNotes] = useState('')
  // By the time a task is needs_human its assignee is "human", so the pair has
  // to come from the review that escalated it, not from the assignee.
  const reviewer = (Object.keys(task.reviews) as AgentId[])[0]
  const proposer = reviewer ? (reviewer === 'claude' ? 'copilot' : 'claude') : null
  const verdict = reviewer ? task.reviews[reviewer]?.verdict : undefined

  return (
    <div className="escalation">
      <p>
        {reviewer && proposer
          ? verdict === 'reject'
            ? `${reviewer} rejected ${proposer}'s approach outright — that's a disagreement about the approach, not the execution.`
            : `${proposer} and ${reviewer} went ${task.revision_rounds} rounds without agreeing.`
          : 'This task needs your call.'}
      </p>
      <textarea
        rows={2}
        value={notes}
        placeholder="Your reasoning (recorded on the task)…"
        onChange={(e) => setNotes(e.target.value)}
        style={{
          width: '100%',
          background: '#0d1017',
          border: '1px solid #222a38',
          borderRadius: 6,
          color: '#e4e9f2',
          font: 'inherit',
          padding: '6px 8px',
          marginBottom: 8,
          resize: 'none'
        }}
      />
      <div className="escalation-actions">
        <button
          className="mini approve"
          onClick={() => void window.plexus.resolveTask(task.id, 'accept', notes)}
        >
          Accept it
        </button>
        <button
          className="mini revise"
          onClick={() => void window.plexus.resolveTask(task.id, 'send_back', notes)}
        >
          Send back{proposer ? ` to ${proposer}` : ''}
        </button>
        <button className="mini" onClick={() => void window.plexus.resolveTask(task.id, 'cancel', notes)}>
          Drop it
        </button>
      </div>
    </div>
  )
}
