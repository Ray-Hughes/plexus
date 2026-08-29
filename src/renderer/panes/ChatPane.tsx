import { useEffect, useRef, useState } from 'react'
import type { ChatDefault, ChatMessage } from '../../shared/types'

/**
 * Tier 5 with a real UI instead of a scrollback buffer. The routing behind it
 * is the same `handleHumanMessage` the terminal coordinator uses.
 */

const KNOWN = new Set(['claude', 'copilot', 'human', 'coordinator'])

/**
 * Task ids are the one thing in the room worth clicking: they're how a chat
 * message connects back to the requirements and attachments behind it.
 */
function linkTasks(text: string, onOpenTask: (id: string) => void): React.ReactNode[] {
  // split() with a capture group puts every capture at an odd index, so the
  // index alone identifies a match — and a /g regex's .test() is stateful.
  return text.split(TASK_ID).map((part, i) =>
    i % 2 === 1 ? (
      <button key={i} className="task-link" onClick={() => onOpenTask(part)}>
        {part}
      </button>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

/**
 * A review can run to several hundred words, and one of them unclamped pushes
 * every other message out of the room. Long messages collapse to a readable
 * height with a toggle.
 */
const CLAMP_CHARS = 420

const TASK_ID = /(task-[a-z0-9]{8})/g

function placeholderFor(target: ChatDefault): string {
  if (target === 'ask') return '@claude, @copilot, or @both…'
  const who = target === 'both' ? 'both agents' : target
  return `Message ${who}…  (@claude / @copilot to pick one)`
}

interface Props {
  messages: ChatMessage[]
  disabled: boolean
  chatDefault: ChatDefault
  onOpenTask: (id: string) => void
}

function Message({
  message,
  onOpenTask
}: {
  message: ChatMessage
  onOpenTask: (id: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const long = message.text.length > CLAMP_CHARS
  const shown = long && !expanded ? `${message.text.slice(0, CLAMP_CHARS).trimEnd()}…` : message.text

  return (
    <div className="msg">
      <div className="msg-head">
        <span className={`speaker ${KNOWN.has(message.speaker) ? message.speaker : 'coordinator'}`}>
          {message.speaker}
        </span>
        <span className="msg-time">{message.at ? message.at.slice(11, 19) : ''}</span>
      </div>
      <div className="msg-text">{linkTasks(shown, onOpenTask)}</div>
      {long && (
        <button className="msg-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${message.text.length.toLocaleString()} characters`}
        </button>
      )}
    </div>
  )
}

export default function ChatPane({
  messages,
  disabled,
  chatDefault,
  onOpenTask
}: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    setSending(true)
    try {
      await window.plexus.sendChat(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="empty">
            {chatDefault === 'ask' ? (
              <>
                Nothing said yet. Address a message with <code>@claude</code>,{' '}
                <code>@copilot</code>, or <code>@both</code>.
              </>
            ) : (
              <>
                Nothing said yet. Just type — messages go to{' '}
                <code>{chatDefault === 'both' ? 'both agents' : chatDefault}</code> unless you
                address one with <code>@claude</code> or <code>@copilot</code>.
              </>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={`${m.at}-${i}`} message={m} onOpenTask={onOpenTask} />
        ))}
        <div ref={bottom} />
      </div>

      <div className="chat-input">
        <div className="chat-input-inner">
        <textarea
          rows={3}
          value={draft}
          disabled={disabled || sending}
          placeholder={disabled ? 'Open a project first' : placeholderFor(chatDefault)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="chat-hint">
          {sending ? (
            'Dispatching…'
          ) : (
            <>
              <code>Enter</code> to send · goes to{' '}
              <code>{chatDefault === 'ask' ? 'whoever you @mention' : chatDefault}</code> · every
              reply is reviewed by the other agent before it counts as done
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
