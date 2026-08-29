import { useEffect, useRef, useState } from 'react'
import type { Attachment, Requirement, Task } from '../../shared/types'
import {
  BackIcon,
  CloseIcon,
  FileIcon,
  LinkIcon,
  NoteIcon,
  PlusIcon
} from '../components/Icons'

/**
 * Everything an agent or a person needs to actually do the task, in one place.
 * The instructions, requirements and attachments here are what `get_brief`
 * renders and what the reviewing agent is checked against — so this panel is
 * the difference between "go do a thing" and a task that can be reviewed.
 */

interface Props {
  task: Task
  onBack: () => void
}

export default function TaskDetail({ task, onBack }: Props): JSX.Element {
  return (
    <div className="detail">
      <header className="detail-head">
        <button className="icon-btn" onClick={onBack} title="Back to the list">
          <BackIcon />
        </button>
        <div className="detail-title">
          <h2>{task.title}</h2>
          <div className="detail-sub">
            <span className="task-id">{task.id}</span>
            <span className={`status ${task.status}`}>{task.status.replace('_', ' ')}</span>
            <span>→ {task.assignee}</span>
            <span>{task.priority} priority</span>
          </div>
        </div>
      </header>

      <div className="detail-body">
        <Section title="Description">
          <p className="prose">{task.description}</p>
        </Section>

        <Instructions task={task} />
        <Requirements task={task} />
        <Attachments task={task} />

        {task.result && (
          <Section title={`Proposed result${task.revision_rounds ? ` · round ${task.revision_rounds + 1}` : ''}`}>
            <p className="prose">{task.result}</p>
          </Section>
        )}

        {Object.entries(task.reviews).length > 0 && (
          <Section title="Review">
            {Object.entries(task.reviews).map(([reviewer, review]) => (
              <div className="review" key={reviewer}>
                <div className="review-head">
                  <span className={`speaker ${reviewer}`}>{reviewer}</span>
                  <span className={`verdict ${review.verdict}`}>{review.verdict}</span>
                </div>
                <p className="prose">{review.notes}</p>
              </div>
            ))}
          </Section>
        )}

        {task.status === 'needs_human' && <Escalation task={task} />}

        {task.notes.length > 0 && (
          <Section title={`History · ${task.notes.length}`} collapsible>
            <ol className="trail">
              {task.notes.map((note, i) => (
                <li key={i}>
                  <time>{note.at.slice(11, 16)}</time>
                  <b>{note.by}</b> {note.text}
                </li>
              ))}
            </ol>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  action,
  collapsible = false
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
  collapsible?: boolean
}): JSX.Element {
  const [open, setOpen] = useState(!collapsible)
  return (
    <section className="detail-section">
      <div className="section-head">
        <h3
          onClick={collapsible ? () => setOpen(!open) : undefined}
          style={collapsible ? { cursor: 'pointer' } : undefined}
        >
          {collapsible && <span className={`caret ${open ? 'open' : ''}`}>›</span>}
          {title}
        </h3>
        {action}
      </div>
      {open && children}
    </section>
  )
}

/** Long-form detail. Saves on blur rather than on every keystroke. */
function Instructions({ task }: { task: Task }): JSX.Element {
  const [draft, setDraft] = useState(task.instructions)
  const [dirty, setDirty] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  // Adopt changes made elsewhere (an agent calling set_instructions) unless the
  // human is mid-edit, which would otherwise yank the text out from under them.
  useEffect(() => {
    if (!dirty) setDraft(task.instructions)
  }, [task.instructions, dirty])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    // +2 for the border box, or the last line sits under a scrollbar.
    el.style.height = `${Math.max(72, el.scrollHeight + 2)}px`
  }, [draft])

  function save(): void {
    if (!dirty) return
    setDirty(false)
    void window.plexus.setInstructions(task.id, draft)
  }

  return (
    <Section
      title="Instructions"
      action={dirty ? <span className="hint-dot">unsaved</span> : undefined}
    >
      <textarea
        ref={area}
        className="field"
        value={draft}
        placeholder="Constraints, background, how to verify it worked. The assignee sees this, and the reviewer is held to it."
        onChange={(e) => {
          setDraft(e.target.value)
          setDirty(true)
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          if (e.key === 'Escape') {
            setDraft(task.instructions)
            setDirty(false)
          }
        }}
      />
    </Section>
  )
}

function Requirements({ task }: { task: Task }): JSX.Element {
  const [adding, setAdding] = useState('')
  const met = task.requirements.filter((r) => r.done).length

  function add(): void {
    const text = adding.trim()
    if (!text) return
    setAdding('')
    void window.plexus.addRequirement(task.id, text)
  }

  return (
    <Section
      title={task.requirements.length ? `Requirements · ${met}/${task.requirements.length}` : 'Requirements'}
    >
      {task.requirements.length === 0 && (
        <p className="muted-note">
          Nothing required yet. Each one is shown to the reviewing agent verbatim, so write them
          so they can be checked rather than interpreted.
        </p>
      )}

      <ul className="reqs">
        {task.requirements.map((r) => (
          <RequirementRow key={r.id} task={task} requirement={r} />
        ))}
      </ul>

      <div className="add-row">
        <input
          className="field"
          value={adding}
          placeholder="Add a requirement…"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
        />
        <button className="icon-btn" onClick={add} disabled={!adding.trim()} title="Add">
          <PlusIcon />
        </button>
      </div>
    </Section>
  )
}

function RequirementRow({
  task,
  requirement
}: {
  task: Task
  requirement: Requirement
}): JSX.Element {
  return (
    <li className={requirement.done ? 'done' : ''}>
      <input
        type="checkbox"
        checked={requirement.done}
        onChange={(e) => void window.plexus.setRequirementDone(task.id, requirement.id, e.target.checked)}
      />
      <span className="req-text">{requirement.text}</span>
      <span className="req-by">{requirement.added_by}</span>
      <button
        className="icon-btn ghost"
        title="Remove"
        onClick={() => void window.plexus.removeRequirement(task.id, requirement.id)}
      >
        <CloseIcon />
      </button>
    </li>
  )
}

function Attachments({ task }: { task: Task }): JSX.Element {
  const [mode, setMode] = useState<'idle' | 'link' | 'note'>('idle')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')

  async function pickFiles(): Promise<void> {
    const picked = await window.plexus.pickAttachmentFiles()
    for (const file of picked) {
      await window.plexus.addAttachment(task.id, 'file', file.name, file.value)
    }
  }

  function submit(): void {
    const label = name.trim() || (mode === 'link' ? 'link' : 'note')
    if (!value.trim()) return
    void window.plexus.addAttachment(task.id, mode === 'link' ? 'link' : 'note', label, value.trim())
    setName('')
    setValue('')
    setMode('idle')
  }

  return (
    <Section title={task.attachments.length ? `Attachments · ${task.attachments.length}` : 'Attachments'}>
      {task.attachments.length === 0 && mode === 'idle' && (
        <p className="muted-note">
          Files the assignee should read, links, or a note pasted inline. Files are attached as
          repo-relative paths, so the agent opens them itself.
        </p>
      )}

      <ul className="attachments">
        {task.attachments.map((a) => (
          <AttachmentRow key={a.id} task={task} attachment={a} />
        ))}
      </ul>

      {mode === 'idle' ? (
        <div className="add-row">
          <button className="btn small" onClick={() => void pickFiles()}>
            <FileIcon /> Add files
          </button>
          <button className="btn small" onClick={() => setMode('link')}>
            <LinkIcon /> Link
          </button>
          <button className="btn small" onClick={() => setMode('note')}>
            <NoteIcon /> Note
          </button>
        </div>
      ) : (
        <div className="add-form">
          <input
            className="field"
            value={name}
            placeholder="Label"
            onChange={(e) => setName(e.target.value)}
          />
          {mode === 'link' ? (
            <input
              className="field"
              value={value}
              placeholder="https://…"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          ) : (
            <textarea
              className="field"
              rows={3}
              value={value}
              placeholder="Paste the note…"
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          <div className="add-row">
            <button className="btn small" onClick={submit} disabled={!value.trim()}>
              Attach
            </button>
            <button
              className="btn small"
              onClick={() => {
                setMode('idle')
                setName('')
                setValue('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  )
}

function AttachmentRow({ task, attachment }: { task: Task; attachment: Attachment }): JSX.Element {
  const [open, setOpen] = useState(false)
  const Icon = attachment.kind === 'file' ? FileIcon : attachment.kind === 'link' ? LinkIcon : NoteIcon

  return (
    <li>
      <div className="attachment-head">
        <span className="attachment-icon">
          <Icon />
        </span>
        <span className="attachment-name">{attachment.name}</span>
        {attachment.kind === 'note' ? (
          <button className="attachment-value link" onClick={() => setOpen(!open)}>
            {open ? 'hide' : 'show note'}
          </button>
        ) : attachment.kind === 'link' ? (
          <a className="attachment-value link" href={attachment.value} target="_blank" rel="noreferrer">
            {attachment.value}
          </a>
        ) : (
          <code className="attachment-value">{attachment.value}</code>
        )}
        <button
          className="icon-btn ghost"
          title="Remove"
          onClick={() => void window.plexus.removeAttachment(task.id, attachment.id)}
        >
          <CloseIcon />
        </button>
      </div>
      {open && <pre className="attachment-note">{attachment.value}</pre>}
    </li>
  )
}

/**
 * The two agents couldn't agree, so the call is yours. Recorded on the task but
 * deliberately not on the scoreboard — those tallies show what the agents
 * managed unaided.
 */
function Escalation({ task }: { task: Task }): JSX.Element {
  const [notes, setNotes] = useState('')
  const reviewer = (Object.keys(task.reviews) as ('claude' | 'copilot')[])[0]
  const proposer = reviewer ? (reviewer === 'claude' ? 'copilot' : 'claude') : null
  const verdict = reviewer ? task.reviews[reviewer]?.verdict : undefined

  return (
    <div className="escalation">
      <p>
        {reviewer && proposer
          ? verdict === 'reject'
            ? `${reviewer} rejected ${proposer}'s approach outright — a disagreement about the approach, not the execution.`
            : `${proposer} and ${reviewer} went ${task.revision_rounds} rounds without agreeing.`
          : 'This task needs your call.'}
      </p>
      <textarea
        className="field"
        rows={2}
        value={notes}
        placeholder="Your reasoning (recorded on the task)…"
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="escalation-actions">
        <button className="mini approve" onClick={() => void window.plexus.resolveTask(task.id, 'accept', notes)}>
          Accept it
        </button>
        <button className="mini revise" onClick={() => void window.plexus.resolveTask(task.id, 'send_back', notes)}>
          Send back{proposer ? ` to ${proposer}` : ''}
        </button>
        <button className="mini" onClick={() => void window.plexus.resolveTask(task.id, 'cancel', notes)}>
          Drop it
        </button>
      </div>
    </div>
  )
}
