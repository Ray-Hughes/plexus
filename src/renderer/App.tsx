import { useCallback, useEffect, useRef, useState } from 'react'
import type { Snapshot } from '../shared/ipc'
import type { AgentId } from '../shared/types'
import {
  ChatIcon,
  CollapseIcon,
  ExpandIcon,
  ScoreIcon,
  SettingsIcon,
  TasksIcon
} from './components/Icons'
import Logo from './components/Logo'
import ChatPane from './panes/ChatPane'
import TerminalPane from './panes/TerminalPane'
import Scoreboard from './views/Scoreboard'
import Settings from './views/Settings'
import TaskBoard from './views/TaskBoard'

type View = 'chat' | 'tasks' | 'scoreboard' | 'settings'

const NAV: { key: View; label: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { key: 'chat', label: 'Chat', Icon: ChatIcon },
  { key: 'tasks', label: 'Tasks', Icon: TasksIcon },
  { key: 'scoreboard', label: 'Scoreboard', Icon: ScoreIcon },
  { key: 'settings', label: 'Settings', Icon: SettingsIcon }
]

const MIN_AGENTS = 300
const MIN_MAIN = 520

export default function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [view, setView] = useState<View>('chat')
  const [selectedTask, setSelectedTask] = useState<string | null>(null)
  const [agentsWidth, setAgentsWidth] = useState(380)
  const [maximized, setMaximized] = useState<AgentId | null>(null)
  const [startErrors, setStartErrors] = useState<Partial<Record<AgentId, string>>>({})
  const dragging = useRef(false)

  useEffect(() => {
    void window.plexus.openProject().then(() => window.plexus.getSnapshot().then(setSnapshot))
    return window.plexus.onSnapshot(setSnapshot)
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      const next = window.innerWidth - e.clientX
      setAgentsWidth(Math.min(Math.max(MIN_AGENTS, next), window.innerWidth - MIN_MAIN))
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

  // Escape leaves a maximized terminal, which is what every full-screen thing does.
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMaximized(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [maximized])

  const startAgent = useCallback((id: AgentId, cols: number, rows: number) => {
    void window.plexus.startAgent(id, cols, rows).then((result) => {
      setStartErrors((prev) => ({ ...prev, [id]: result.ok ? undefined : result.error }))
    })
  }, [])

  const openTask = useCallback((id: string | null) => {
    setSelectedTask(id)
    if (id) setView('tasks')
  }, [])

  const project = snapshot?.project
  const open = Boolean(project?.root)
  const tasks = snapshot?.tasks ?? []
  const needsYou = tasks.filter((t) => t.assignee === 'human').length
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length

  if (!open) {
    return (
      <div className="app">
        <header className="titlebar">
          <div className="brand">
            <Logo />
            <span>Plexus</span>
          </div>
          <div className="spacer" />
        </header>
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
      </div>
    )
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo />
          <span>Plexus</span>
        </div>
        {project?.root && <div className="project-path">{shortenPath(project.root)}</div>}
        <div className="spacer" />
        {(['claude', 'copilot'] as AgentId[]).map((id) => (
          <span className="pill" key={id}>
            <span
              className={`dot ${(id === 'claude' ? project?.claudeRunning : project?.copilotRunning) ? 'live' : ''}`}
            />
            {id}
          </span>
        ))}
      </header>

      <div className="body">
        <nav className="rail">
          {NAV.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={`rail-btn ${view === key ? 'on' : ''}`}
              title={label}
              onClick={() => {
                setView(key)
                if (key !== 'tasks') setSelectedTask(null)
              }}
            >
              <Icon />
              <span>{label}</span>
              {key === 'tasks' && needsYou > 0 && <i className="badge urgent">{needsYou}</i>}
              {key === 'tasks' && needsYou === 0 && active > 0 && <i className="badge">{active}</i>}
            </button>
          ))}
        </nav>

        <main className="main">
          {view === 'chat' && (
            <ChatPane messages={snapshot?.chat ?? []} disabled={!open} onOpenTask={openTask} />
          )}
          {view === 'tasks' && (
            <TaskBoard tasks={tasks} selectedId={selectedTask} onSelect={openTask} />
          )}
          {view === 'scoreboard' && (
            <Scoreboard
              board={snapshot?.scoreboard ?? { claude: blank(), copilot: blank() }}
              activity={snapshot?.activity ?? []}
            />
          )}
          {view === 'settings' && project && <Settings project={project} />}
        </main>

        <div
          className={`divider ${maximized ? 'hidden' : ''}`}
          onMouseDown={() => {
            dragging.current = true
            document.body.style.cursor = 'col-resize'
          }}
        />

        {/* Kept mounted while maximized so the side terminals don't lose their
            scrollback; hidden panes report zero size, which PtyManager ignores. */}
        <aside
          className={`agents ${maximized ? 'hidden' : ''}`}
          style={{ width: agentsWidth, flex: `0 0 ${agentsWidth}px` }}
        >
          {(['claude', 'copilot'] as AgentId[]).map((id) => (
            <AgentPane
              key={id}
              id={id}
              running={Boolean(id === 'claude' ? project?.claudeRunning : project?.copilotRunning)}
              error={startErrors[id] ?? null}
              onStart={(c, r) => startAgent(id, c, r)}
              onMaximize={() => setMaximized(id)}
            />
          ))}
        </aside>
      </div>

      {maximized && (
        <div className="overlay">
          <AgentPane
            id={maximized}
            running={Boolean(
              maximized === 'claude' ? project?.claudeRunning : project?.copilotRunning
            )}
            error={startErrors[maximized] ?? null}
            onStart={(c, r) => startAgent(maximized, c, r)}
            onMaximize={() => setMaximized(null)}
            maximized
          />
        </div>
      )}
    </div>
  )
}

function AgentPane({
  id,
  running,
  error,
  onStart,
  onMaximize,
  maximized = false
}: {
  id: AgentId
  running: boolean
  error: string | null
  onStart: (cols: number, rows: number) => void
  onMaximize: () => void
  maximized?: boolean
}): JSX.Element {
  return (
    <section className={`pane ${maximized ? 'maximized' : ''}`}>
      <div className="pane-head">
        <span className={`pane-title ${id}`}>{id}</span>
        <div className="spacer" />
        {running && (
          <button className="icon-btn ghost" title="Stop" onClick={() => void window.plexus.stopAgent(id)}>
            ×
          </button>
        )}
        <button
          className="icon-btn ghost"
          title={maximized ? 'Restore (Esc)' : `Focus ${id}`}
          onClick={onMaximize}
        >
          {maximized ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      </div>
      <TerminalPane
        id={id}
        running={running}
        error={error}
        onStart={onStart}
        instanceKey={maximized ? 'max' : 'side'}
      />
    </section>
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
