import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/types'

/**
 * Tier 5 with a real UI instead of a scrollback buffer. The routing behind it
 * is the same `handleHumanMessage` the terminal coordinator uses.
 */

const KNOWN = new Set(['claude', 'copilot', 'human', 'coordinator'])

/**
 * A review can run to several hundred words, and one of them unclamped pushes
 * every other message out of the room. Long messages collapse to a readable
 * height with a toggle.
 */
const CLAMP_CHARS = 420

interface Props {
  messages: ChatMessage[]
  disabled: boolean
}

function Message({ message }: { message: ChatMessage }): JSX.Element {
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
      <div className="msg-text">{shown}</div>
      {long && (
        <button className="msg-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${message.text.length.toLocaleString()} characters`}
        </button>
      )}
    </div>
  )
}

export default function ChatPane({ messages, disabled }: Props): JSX.Element {
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
    <div className="tab-body">
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="empty">
            Nothing said yet. Address a message with <code>@claude</code>, <code>@copilot</code>, or{' '}
            <code>@both</code>.
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={`${m.at}-${i}`} message={m} />
        ))}
        <div ref={bottom} />
      </div>

      <div className="chat-input">
        <textarea
          rows={3}
          value={draft}
          disabled={disabled || sending}
          placeholder={disabled ? 'Open a project first' : '@claude, @copilot, or @both…'}
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
              <code>Enter</code> to send · <code>Shift+Enter</code> for a newline · every reply is
              routed to the other agent for review before it counts as done
            </>
          )}
        </div>
      </div>
    </div>
  )
}
