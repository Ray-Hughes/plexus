import type { ActivityEntry, AgentId, AgentScore, Scoreboard as Board } from '../../shared/types'

/** Tier 6's tallies as a dashboard, with §6's caveat kept in view. */

interface Props {
  board: Board
  activity: ActivityEntry[]
}

export default function Scoreboard({ board, activity }: Props): JSX.Element {
  return (
    <div className="view">
      <header className="view-head">
        <h2>Scoreboard</h2>
      </header>
      <div className="view-body">
        <div className="score-grid">
          {(['claude', 'copilot'] as AgentId[]).map((agent) => (
            <Card key={agent} agent={agent} score={board[agent]} />
          ))}
        </div>

        <p className="caveat">
          Read this as a trend over dozens of tasks, not a verdict on any single one. A reviewer
          that always approves shows a low <i>issues caught</i> rate — which could mean the other
          agent&apos;s work is genuinely clean, or could mean it&apos;s rubber-stamping.
        </p>

        <div className="activity">
          <h3>Activity</h3>
          <ol>
            {activity
              .slice()
              .reverse()
              .map((entry, i) => (
                <li key={i}>
                  <time>{entry.at ? entry.at.slice(11, 19) : ''}</time>
                  {entry.text}
                </li>
              ))}
          </ol>
          {activity.length === 0 && <div className="empty">Nothing logged yet.</div>}
        </div>
      </div>
    </div>
  )
}

function Card({ agent, score }: { agent: AgentId; score: AgentScore }): JSX.Element {
  const cleanRate = score.proposals > 0 ? score.approved_first_try / score.proposals : 0
  const catchRate = score.reviews_done > 0 ? score.issues_caught / score.reviews_done : 0
  const tint = agent === 'claude' ? 'var(--claude)' : 'var(--copilot)'

  return (
    <div className={`score-card ${agent}`}>
      <h3>{agent}</h3>

      <div className="stat">
        <span>Proposals</span>
        <b>{score.proposals}</b>
      </div>
      <div className="stat">
        <span>Approved first try</span>
        <b>{score.approved_first_try}</b>
      </div>
      <div className="meter">
        <span style={{ width: `${Math.round(cleanRate * 100)}%`, background: tint }} />
      </div>
      <div className="stat">
        <span>Clean rate</span>
        <b>{score.proposals ? `${Math.round(cleanRate * 100)}%` : '—'}</b>
      </div>

      <div className="stat" style={{ marginTop: 10 }}>
        <span>Needed revision</span>
        <b>{score.needed_revision}</b>
      </div>
      <div className="stat">
        <span>Reviews done</span>
        <b>{score.reviews_done}</b>
      </div>
      <div className="stat">
        <span>Issues caught</span>
        <b>{score.issues_caught}</b>
      </div>
      <div className="meter">
        <span style={{ width: `${Math.round(catchRate * 100)}%`, background: 'var(--review)' }} />
      </div>
      <div className="stat">
        <span>Catch rate</span>
        <b>{score.reviews_done ? `${Math.round(catchRate * 100)}%` : '—'}</b>
      </div>
    </div>
  )
}
