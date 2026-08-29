import type { AgentId, AgentScore, Scoreboard } from '../../shared/types'
import { emptyScoreboard } from '../../shared/types'
import type { HarnessPaths } from './paths'
import { readJsonOr, withLock, writeJson } from './store'

/** Tier 6 — the running tally. Read this as a trend, not a verdict (§6). */
export function getScoreboard(paths: HarnessPaths): Scoreboard {
  const board = readJsonOr<Partial<Scoreboard>>(paths.scoreboard, {})
  const base = emptyScoreboard()
  return {
    claude: { ...base.claude, ...board.claude },
    copilot: { ...base.copilot, ...board.copilot }
  }
}

export function bumpScore(
  paths: HarnessPaths,
  agent: AgentId,
  field: keyof AgentScore,
  by = 1
): Scoreboard {
  // Read-modify-write from up to three processes, so this has to be locked.
  return withLock(paths.locksDir, 'scoreboard', () => {
    const board = getScoreboard(paths)
    board[agent][field] += by
    writeJson(paths.scoreboard, board)
    return board
  })
}
