# Running without the app

The Electron app is a shell. Everything works from a terminal, which is also the fastest
way to see what the harness is actually doing.

## Build

```bash
git clone git@github.com:Ray-Hughes/plexus.git
cd plexus
npm install
npm run build:cli
```

That produces three self-contained bundles that run from any directory:

| Bundle | What it is |
|---|---|
| `dist/cli/harness-bridge.mjs` | The MCP server. Launched by the CLIs, not by you. |
| `dist/cli/harness-coordinator.mjs` | The shared room — Pane 3. |
| `dist/cli/harness-watch.mjs` | The Tier 2 job watcher, for async dispatch. |

## Wire up a project

Two config files in the repo the agents will share:

```jsonc
// .mcp.json
{ "mcpServers": { "harness-bridge": {
    "command": "node",
    "args": ["/abs/path/to/plexus/dist/cli/harness-bridge.mjs", "--agent=claude"] } } }
```

```jsonc
// .copilot/mcp-config.json    (the "type" field is required by Copilot)
{ "mcpServers": { "harness-bridge": {
    "type": "local",
    "command": "node",
    "args": ["/abs/path/to/plexus/dist/cli/harness-bridge.mjs", "--agent=copilot"] } } }
```

Same server, two configs, each stamping its instance with a different identity.

Then give each agent its instructions — copy this repo's [`CLAUDE.md`](../CLAUDE.md) and
[`.github/copilot-instructions.md`](../.github/copilot-instructions.md), or let the app
write them for you.

## The three panes

```bash
# tmux, iTerm splits, Windows Terminal panes — anything with three panes
claude                                                  # pane 1
copilot                                                 # pane 2
node /abs/path/to/plexus/dist/cli/harness-coordinator.mjs   # pane 3
```

The coordinator prints the transcript, tails it for anything either agent posts, and takes
your input:

```
plexus coordinator · /Users/you/your-repo
Address a message with @claude, @copilot, or @both. Ctrl-C to exit.

05:09:53 copilot  approved "State the harness revision cap" (task-c6b7c14b) — Verified…
> @both does the auth refactor break the upload pipeline?
```

Anything without a mention gets a question back rather than a guess.

## Async dispatch

Sync dispatch blocks the calling agent's turn. For long jobs, `dispatch(mode: "async")`
returns a job id immediately — but something has to run the queue:

```bash
node /abs/path/to/plexus/dist/cli/harness-watch.mjs
```

Safe to run more than one; claiming is atomic.

## Watching the state

```bash
tail -f .harness/activity.log         # everything, as it happens
tail -f .harness/chat.log             # just the room
cat .harness/scoreboard.json          # the tallies
ls .harness/tasks/                    # the board
jq . .harness/tasks/task-1a2b3c4d.json
```

Because it's all flat files, `git diff` on `.harness/` is a readable history of what the
two agents did to each other.

## Environment

| Variable | Effect |
|---|---|
| `PLEXUS_PROJECT_DIR` | The project to operate on. Defaults to the process's cwd. |
| `PLEXUS_AGENT` | Identity, if `--agent=` isn't passed. |
