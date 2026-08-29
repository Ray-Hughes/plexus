import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { useEffect, useRef } from 'react'
import type { AgentId } from '../../shared/types'

/**
 * A real PTY hosted in xterm.js — `claude` and `copilot` behave here exactly as
 * they do in a standalone terminal, because this hosts their UI rather than
 * reimplementing it.
 */

const THEME = {
  background: '#0d1017',
  foreground: '#e4e9f2',
  cursor: '#e4e9f2',
  selectionBackground: '#2f5fa855',
  black: '#0d1017',
  red: '#f85149',
  green: '#56d364',
  yellow: '#e3b341',
  blue: '#58a6ff',
  magenta: '#a371f7',
  cyan: '#39c5cf',
  white: '#c9d1d9',
  brightBlack: '#5d6779',
  brightRed: '#ff7b72',
  brightGreen: '#7ee787',
  brightYellow: '#f2cc60',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc'
}

interface Props {
  id: AgentId
  running: boolean
  error: string | null
  onStart: (cols: number, rows: number) => void
}

export default function TerminalPane({ id, running, error, onStart }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!host.current || !running) return

    const terminal = new Terminal({
      fontFamily: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 20000,
      theme: THEME
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(host.current)
    fitAddon.fit()

    term.current = terminal
    fit.current = fitAddon

    // Repaint whatever the process already emitted, so remounting a pane (or
    // switching tabs) doesn't look like the session was lost.
    void window.plexus.agentBuffer(id).then((buffer) => {
      if (buffer) terminal.write(buffer)
    })

    const offData = window.plexus.onPtyData((who, chunk) => {
      if (who === id) terminal.write(chunk)
    })
    const offExit = window.plexus.onPtyExit((who, code) => {
      if (who === id) terminal.write(`\r\n\x1b[2m[${id} exited with code ${code}]\x1b[0m\r\n`)
    })
    const input = terminal.onData((data) => window.plexus.writeAgent(id, data))

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.plexus.resizeAgent(id, terminal.cols, terminal.rows)
      } catch {
        // Fires while the pane is collapsed; nothing to do.
      }
    })
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      input.dispose()
      offData()
      offExit()
      terminal.dispose()
      term.current = null
      fit.current = null
    }
  }, [id, running])

  if (!running) {
    return (
      <div className="term-idle">
        {error ? (
          <pre className="term-error">{error}</pre>
        ) : (
          <p>
            <code>{id}</code> is not running in this pane.
          </p>
        )}
        <button
          className="btn"
          onClick={() => {
            const el = host.current
            const cols = el ? Math.max(40, Math.floor(el.clientWidth / 7)) : 100
            const rows = el ? Math.max(10, Math.floor(el.clientHeight / 17)) : 30
            onStart(cols, rows)
          }}
        >
          {error ? `Try ${id} again` : `Start ${id}`}
        </button>
        <div ref={host} style={{ position: 'absolute', width: 0, height: 0 }} />
      </div>
    )
  }

  return <div className="term-host" ref={host} />
}
