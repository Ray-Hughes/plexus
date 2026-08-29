import { useEffect, useState } from 'react'
import type { AppSettings, ProjectState } from '../../shared/ipc'
import type { ChatDefault } from '../../shared/types'

const CHAT_DEFAULTS: { key: ChatDefault; label: string; hint: string }[] = [
  { key: 'both', label: 'Both', hint: 'Each answers, and each reviews the other' },
  { key: 'claude', label: 'claude', hint: 'copilot still reviews the result' },
  { key: 'copilot', label: 'copilot', hint: 'claude still reviews the result' },
  { key: 'ask', label: 'Ask me', hint: 'Bounces the message back instead of guessing' }
]

interface Props {
  project: ProjectState
}

export default function Settings({ project }: Props): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    void window.plexus.getSettings().then(setSettings)
  }, [])

  async function patch(next: Partial<AppSettings>): Promise<void> {
    setSettings(await window.plexus.setSettings(next))
  }

  const wired = project.wiring?.claude && project.wiring?.copilot

  return (
    <div className="view">
      <header className="view-head">
        <h2>Settings</h2>
      </header>

      <div className="view-body settings">
        <section className="detail-section">
          <div className="section-head">
            <h3>Project</h3>
          </div>
          <div className="setting">
            <div>
              <b>Open project</b>
              <p>Both agents are pointed at this directory, and `.harness/` lives inside it.</p>
              <code className="path">{project.root ?? 'none'}</code>
            </div>
            <button className="btn" onClick={() => void window.plexus.chooseProject()}>
              Change…
            </button>
          </div>

          <div className="setting">
            <div>
              <b>Bridge wiring</b>
              <p>
                {wired
                  ? 'This project’s MCP configs point at the bundled harness-bridge, so both agents have the shared tools.'
                  : 'Adds harness-bridge to .mcp.json and .copilot/mcp-config.json, and appends the shared-work instructions to CLAUDE.md. Existing entries are kept.'}
              </p>
              <div className="wiring">
                <span className={project.wiring?.claude ? 'ok' : 'off'}>
                  {project.wiring?.claude ? '✓' : '○'} .mcp.json
                </span>
                <span className={project.wiring?.copilot ? 'ok' : 'off'}>
                  {project.wiring?.copilot ? '✓' : '○'} .copilot/mcp-config.json
                </span>
                <span className={project.wiring?.instructions ? 'ok' : 'off'}>
                  {project.wiring?.instructions ? '✓' : '○'} CLAUDE.md
                </span>
              </div>
            </div>
            <button className="btn" onClick={() => void window.plexus.wireProject()}>
              {wired ? 'Re-wire' : 'Wire it up'}
            </button>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-head">
            <h3>Chat</h3>
          </div>
          <div className="setting">
            <div>
              <b>Where an unaddressed message goes</b>
              <p>
                Typing <code>@claude</code>, <code>@copilot</code> or <code>@both</code> always
                wins. This is only what happens when you don&apos;t.
              </p>
              <div className="segmented" style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                {CHAT_DEFAULTS.map((d) => (
                  <button
                    key={d.key}
                    className={settings?.chatDefault === d.key ? 'on' : ''}
                    title={d.hint}
                    onClick={() => void patch({ chatDefault: d.key })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p style={{ marginTop: 8 }}>
                {CHAT_DEFAULTS.find((d) => d.key === settings?.chatDefault)?.hint}
              </p>
            </div>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-head">
            <h3>Agents</h3>
          </div>
          <div className="setting">
            <div>
              <b>Start both agents when a project opens</b>
              <p>
                Off means the panes stay idle until you start them. Each session costs tokens from
                the moment it launches.
              </p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.autoStart ?? true}
                onChange={(e) => void patch({ autoStart: e.target.checked })}
              />
              <span />
            </label>
          </div>

          <div className="setting">
            <div>
              <b>Running now</b>
              <p>Restarting an agent reloads its MCP config — do that after re-wiring.</p>
            </div>
            <div className="add-row">
              {(['claude', 'copilot'] as const).map((id) => {
                const running = id === 'claude' ? project.claudeRunning : project.copilotRunning
                return (
                  <button
                    key={id}
                    className="btn small"
                    onClick={() =>
                      running ? void window.plexus.stopAgent(id) : void window.plexus.startAgent(id, 100, 28)
                    }
                  >
                    <span className={`dot ${running ? 'live' : ''}`} /> {running ? `Stop ${id}` : `Start ${id}`}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-head">
            <h3>How the consensus loop behaves</h3>
          </div>
          <p className="muted-note">
            These are fixed on purpose. A dispatched agent is read-only; a reviewer additionally
            gets the bridge’s own <code>get_task</code> and <code>submit_review</code> and nothing
            else. Headless calls time out after 5 minutes. A task bounces back for revision at most
            twice before it escalates to you, and an outright <code>reject</code> escalates
            immediately rather than starting another round.
          </p>
        </section>
      </div>
    </div>
  )
}
