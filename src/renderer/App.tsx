import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../shared/ipc'
import type { AgentId } from '../shared/types'
import Logo from './components/Logo'
import ChatPane from './panes/ChatPane'
import TerminalPane from './panes/TerminalPane'
import Scoreboard from './views/Scoreboard'
import TaskBoard from './views/TaskBoard'

type Tab = 'chat' | 'tasks' | 'scoreboard'

export default function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [sideWidth, setSideWidth] = useState(420)
  const [startErrors, setStartErrors] = useState<Partial<Record<AgentId, string>>>({})
  const dragging = useRef(false)

  useEffect(() => {
    void window.plexus.openProject().then(() => window.plexus.getSnapshot().then(setSnapshot))
    return window.plexus.onSnapshot(setSnapshot)
  }, [])

  // Drag-to-resize between the terminals and the side panel.
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      setSideWidth(Math.min(Math.max(320, window.innerWidth - e.clientX), window.innerWidth - 420))
    }
    const up = (): void => {
      dragging.current = false
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  const startAgent = useCallback((id: AgentId, cols: number, rows: number) => {
    void window.plexus.startAgent(id, cols, rows).then((result) => {
      setStartErrors((prev) => ({ ...prev, [id]: result.ok ? undefined : result.error }))
    })
  }, [])

  const project = snapshot?.project
  const open = Boolean(project?.root)
  const needsHuman = snapshot?.tasks.filter((t) => t.status === 'needs_human').length ?? 0
  const openTasks = snapshot?.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length ?? 0

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo />
          <span>Plexus</span>
        </div>
        {project?.root && <div className="project-path">{shortenPath(project.root)}</div>}
        <div className="spacer" />
        {open && (
          <>
            <span className="pill">
              <span className={`dot ${project?.claudeRunning ? 'live' : ''}`} />
              claude
            </span>
            <span className="pill">
              <span className={`dot ${project?.copilotRunning ? 'live' : ''}`} />
              copilot
            </span>
          </>
        )}
        <button className="btn" onClick={() => void window.plexus.chooseProject()}>
          {open ? 'Change project' : 'Open project'}
        </button>
      </header>

      {!open ? (
        <div className="welcome">
          <Logo size={54} />
          <h1>Two agents, one nervous system</h1>
          <p>
            Open a repo and Plexus hosts Claude Code and Copilot CLI side by side, wired into a
            shared task board and a consensus loop — so neither can call work finished without the
            other signing off.
          </p>
          <button className="btn" onClick={() => void window.plexus.chooseProject()}>
            Open a project…
          </button>
        </div>
      ) : (
        <div className="body">
          <div className="terminals">
            {project?.wiring && !(project.wiring.claude && project.wiring.copilot) && (
              <div className="banner">
                <div>
                  <b>This project isn&apos;t wired to the bridge yet.</b> Plexus will add
                  <code> harness-bridge </code> to <code>.mcp.json</code> and
                  <code> .copilot/mcp-config.json</code>, and append the shared-work instructions to
                  <code> CLAUDE.md</code>. Existing entries are kept.
                </div>
                <button className="btn" onClick={() => void window.plexus.wireProject()}>
                  Wire it up
                </button>
              </div>
            )}
            <section className="pane">
              <div className="pane-head">
                <span className="pane-title claude">claude</span>
                <div className="spacer" />
                {project?.claudeRunning && (
                  <button className="mini" onClick={() => void window.plexus.stopAgent('claude')}>
                    Stop
                  </button>
                )}
              </div>
              <TerminalPane
                id="claude"
                running={Boolean(project?.claudeRunning)}
                error={startErrors.claude ?? null}
                onStart={(c, r) => startAgent('claude', c, r)}
              />
            </section>

            <section className="pane">
              <div className="pane-head">
                <span className="pane-title copilot">copilot</span>
                <div className="spacer" />
                {project?.copilotRunning && (
                  <button className="mini" onClick={() => void window.plexus.stopAgent('copilot')}>
                    Stop
                  </button>
                )}
              </div>
              <TerminalPane
                id="copilot"
                running={Boolean(project?.copilotRunning)}
                error={startErrors.copilot ?? null}
                onStart={(c, r) => startAgent('copilot', c, r)}
              />
            </section>
          </div>

          <div
            className="divider"
            onMouseDown={() => {
              dragging.current = true
              document.body.style.cursor = 'col-resize'
            }}
          />

          <aside className="side" style={{ width: sideWidth, flex: `0 0 ${sideWidth}px` }}>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'chat'} className="tab" onClick={() => setTab('chat')}>
                Chat
              </button>
              <button role="tab" aria-selected={tab === 'tasks'} className="tab" onClick={() => setTab('tasks')}>
                Tasks
                {openTasks > 0 && <span className="count">{openTasks}</span>}
                {needsHuman > 0 && <span className="count" style={{ color: 'var(--bad)' }}>● {needsHuman}</span>}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'scoreboard'}
                className="tab"
                onClick={() => setTab('scoreboard')}
              >
                Scoreboard
              </button>
            </div>

            {tab === 'chat' && <ChatPane messages={snapshot?.chat ?? []} disabled={!open} />}
            {tab === 'tasks' && <TaskBoard tasks={snapshot?.tasks ?? []} />}
            {tab === 'scoreboard' && (
              <Scoreboard
                board={snapshot?.scoreboard ?? { claude: blank(), copilot: blank() }}
                activity={snapshot?.activity ?? []}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

/** `/Users/me/va/plexus` reads better as `~/va/plexus` in a title bar. */
function shortenPath(path: string): string {
  const home = /^\/Users\/[^/]+|^\/home\/[^/]+/.exec(path)?.[0]
  const short = home ? path.replace(home, '~') : path
  const parts = short.split('/')
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : short
}

function blank() {
  return {
    proposals: 0,
    approved_first_try: 0,
    needed_revision: 0,
    reviews_done: 0,
    issues_caught: 0
  }
}
