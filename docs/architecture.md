# Architecture

Plexus is one implementation of a harness, exposed through three front doors: an MCP server
(for the CLIs), an Electron IPC surface (for the app's own views), and a terminal
coordinator. None of them reimplements the others.

```
src/
├── shared/
│   ├── types.ts          domain types — Task, Job, Scoreboard, verdicts
│   └── ipc.ts            the renderer ↔ main contract
├── main/
│   ├── bridge/           ← the whole nervous system
│   │   ├── paths.ts      where .harness/ lives
│   │   ├── store.ts      atomic writes + a cross-process lock
│   │   ├── log.ts        Tier 1
│   │   ├── jobs.ts       Tier 2
│   │   ├── dispatch.ts   Tier 3 — the CLI argument vectors
│   │   ├── tasks.ts      Tier 4
│   │   ├── chat.ts       Tier 5
│   │   ├── consensus.ts  Tier 6
│   │   ├── scoreboard.ts Tier 6
│   │   └── index.ts      the Harness facade everything else consumes
│   ├── mcp-server.ts     front door 1 — stdio, for claude and copilot
│   ├── coordinator.ts    the @mention router, shared by the app and the CLI
│   ├── index.ts          front door 2 — Electron main, window and IPC handlers
│   ├── pty.ts            node-pty session management
│   ├── env.ts            login-shell PATH resolution
│   ├── provision.ts      wiring a project's MCP configs
│   └── settings.ts       last project, autostart
├── cli/                  front door 3 — terminal coordinator + job watcher
├── lib.ts                the non-Electron public surface the tests exercise
├── preload/              contextBridge — the only thing the renderer can reach
└── renderer/             React UI: panes/, views/, components/
```

## Why the state is flat files

`.harness/` is plain JSON and plain text. It's git-diffable, inspectable with `cat`, and
survives every process in the system dying. The alternative — SQLite — buys transactional
integrity that the lock in `store.ts` already provides for the two patterns that need it.

Three processes write concurrently: the Claude-side bridge, the Copilot-side bridge, and
the app or coordinator. That shapes two decisions:

**Appends need no lock.** A single short line written with `O_APPEND` is atomic on macOS,
Linux and Windows, so `activity.log` and `chat.log` are append-only and lock-free. Both
loggers flatten newlines so one event is always exactly one line.

**Read-modify-write does.** Task transitions and scoreboard bumps read, mutate, and write
back. `withLock()` uses `mkdir`, which is atomic on every filesystem that matters and works
across processes rather than just across async tasks in one process. A lock older than 30
seconds is treated as stale and broken, so a process that dies holding one doesn't wedge
the harness; acquisition gives up after 10 seconds rather than blocking forever.

That stale threshold is a real constraint, not just a safety net: `mtime` is set at
acquisition and never refreshed, so a critical section that ran longer than 30s could have
its lock stolen. Every current critical section is short synchronous JSON work, well inside
that budget.

---

## Tier 1 — Shared trace

`.harness/activity.log`, one timestamped line per event. Both agents are instructed to read
the last lines before starting work and to log significant transitions. Every dispatch,
task transition, review verdict, and failure lands here — it is the debugging trail across
three concurrent processes and two review paths.

## Tier 2 — Job mailbox

`.harness/jobs/job-<id>.json`. `dispatch(mode: "async")` writes a job and returns its id
immediately; a watcher claims it and runs it.

Claiming happens under the `jobs` lock and flips `queued → running` in the same critical
section that selects the job, so two watchers can run against one project without ever
double-running or dropping work. A job that fails is recorded as `failed` with its error
rather than retried, because a dispatch that failed once for a real reason will usually
fail again.

## Tier 3 — The bridge

One MCP server, `src/main/mcp-server.ts`, loaded by both CLIs. Each launches its own
instance with `--agent=claude` or `--agent=copilot`. That identity is what makes
`assignee: "self"` resolve, and what tells the server who is proposing and who therefore
must review.

The argument vectors for spawning each CLI live in `dispatch.ts` and can be overridden
per-project in `.harness/config.json` without touching code, because both CLIs rename their
flags fairly often. Two defaults were wrong in the original spec and are worth knowing:

- Copilot reads MCP config only from `~/.copilot/mcp-config.json`. A project-local config
  must be passed explicitly with `--additional-mcp-config @<path>`.
- Copilot's allow syntax is `--allow-tool=harness-bridge` (or `server(tool)`). There is no
  `mcp(...)` wrapper. Getting this wrong produces a reviewer with no tools, which silently
  strands the task in `review` rather than erroring.

`claude --output-format json` wraps its answer in an envelope; `copilot -s` prints it bare.
`extractText()` normalises both so callers always get prose.

## Tier 4 — Task board

`.harness/tasks/task-<id>.json`, one file per task. Task ids are validated against
`/^task-[a-z0-9]{8}$/` before being turned into a path, so a hostile or malformed id can't
escape the tasks directory.

A task assigned to `human` is `needs_human`, not `in_progress` — otherwise the Tier 6
escalation paths get overwritten on their way out, and work that needs your attention looks
like work in flight.

## Tier 5 — Shared room

`chat.log` plus a router. An explicit `@claude`, `@copilot` or `@both` always wins;
anything else goes to the project's `defaultTarget` (`both` out of the box, or `ask` to
bounce it back). The point of the rule is that it is *fixed and legible* — no model call
decides where your message goes — not that you have to type a mention every time, which
turned out to be unusable in practice.

The default lives in `.harness/config.json` rather than in app settings, so the Electron
chat pane and the terminal coordinator can never disagree about it.

The app and the terminal coordinator both call the same `handleHumanMessage()`. Every piece
of chat-routed work goes through `submitProposal`, never straight to done, which is what
pulls the consensus loop into the shared chat automatically rather than only into direct
agent-to-agent dispatches.

## Tier 6 — Consensus and reward

The mechanism and its three outcomes are in the [README](../README.md#the-consensus-loop).
Details worth knowing:

**A new proposal clears the previous round's verdicts.** Without that, a stale `approve`
from round one could close a round-two proposal nobody looked at.

**A reviewer that never answers escalates rather than stranding.** If the review dispatch
throws or times out, the task is moved to `needs_human` and assigned to you, with the
failure recorded on the task and announced in the room. Silence is not consent.

**A closed task cannot be reopened by proposing again.** `submit_proposal` on a `done` or
`cancelled` task errors.

**`update_task` cannot set `done`.** The status is simply absent from its schema, so the
only path to a closed task is through the other agent's approval.

### On the scoreboard

`issues_caught` counts reviews that returned anything other than `approve`. It is a proxy,
and a weak one on any single task. A reviewer that always approves and a reviewer whose
counterpart genuinely writes clean code produce the same number. What it's good for is the
shape over dozens of tasks: whether one tool tends to produce work that survives review,
and whether the other's reviews ever catch anything.

---

## The app

The Electron shell adds three things the CLI harness can't:

**Real terminals.** `node-pty` + `xterm.js` host `claude` and `copilot` as actual PTY
processes — the same combination VS Code's integrated terminal uses. Their UI is hosted,
not reimplemented, so they behave in a pane exactly as they do standalone.

**PATH resolution.** A GUI app launched from Finder or the Dock inherits a bare
`/usr/bin:/bin:/usr/sbin:/sbin`, not your shell's PATH — so a version-manager install of
`claude` is invisible to it. `env.ts` asks the login shell (`$SHELL -ilc`) what PATH
actually is, once, at startup. Handlers that spawn a CLI await that resolution rather than
the app deferring IPC registration, which would race the renderer's first call.

**Per-project wiring.** `provision.ts` merges a `harness-bridge` entry into a project's MCP
configs, pointing at the server bundled in the app. It compares *resolved* paths, so a
checked-in config using a repo-relative path is recognised as already wired. The launcher
is the Electron binary with `ELECTRON_RUN_AS_NODE=1`, so a wired project doesn't depend on
the user having `node` on their PATH.
