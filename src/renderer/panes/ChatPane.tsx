import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../shared/types'

/**
 * Tier 5 with a real UI instead of a scrollback buffer. The routing behind it
 * is the same `handleHumanMessage` the terminal coordinator uses.
 */

const KNOWN = new Set(['claude', 'copilot', 'human', 'coordinator'])

interface Props {
  messages: ChatMessage[]
  disabled: boolean
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
          <div className="msg" key={`${m.at}-${i}`}>
            <div className="msg-head">
              <span className={`speaker ${KNOWN.has(m.speaker) ? m.speaker : 'coordinator'}`}>
                {m.speaker}
              </span>
              <span className="msg-time">{m.at ? m.at.slice(11, 19) : ''}</span>
            </div>
            <div className="msg-text">{m.text}</div>
          </div>
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
