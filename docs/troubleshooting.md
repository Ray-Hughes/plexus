# Troubleshooting

## An agent can't see the bridge

**Symptom:** the agent says it has no `dispatch` or `submit_proposal` tool.

Check the server is loaded:

```bash
claude -p "List the tools from the harness-bridge MCP server." --allowedTools "mcp__harness-bridge__get_scoreboard"
copilot -p "List the tools from the harness-bridge MCP server." -s \
  --additional-mcp-config @.copilot/mcp-config.json --allow-tool=harness-bridge
```

If Claude sees it but Copilot doesn't, it's almost always one of these two:

- **Copilot only reads `~/.copilot/mcp-config.json`.** A project-local
  `.copilot/mcp-config.json` is *not* picked up automatically — it has to be passed with
  `--additional-mcp-config @.copilot/mcp-config.json`.
- **The allow syntax is `--allow-tool=harness-bridge`.** There is no `mcp(...)` wrapper.

The second one is nasty because it fails silently: the reviewer runs, has no tools, answers
in prose, never calls `submit_review`, and the task sits in `review` forever.

## A task is stuck in `review`

The reviewer ran but didn't cast a verdict — usually the tool-scoping problem above. The
harness escalates to `needs_human` when the review dispatch *errors*, but an agent that
runs fine and simply declines to call the tool looks like success.

Check what the reviewer actually saw:

```bash
grep "DISPATCH\|REVIEW\|FAILED" .harness/activity.log | tail -20
```

Resolve it yourself from the Tasks tab, or:

```bash
node -e "import('./dist/lib/plexus.mjs').then(({Harness})=>
  new Harness('.').submitReview('task-1a2b3c4d','revise','no verdict returned','copilot'))"
```

## `posix_spawnp failed`

`node-pty` is compiled for the wrong architecture — almost always because you packaged for
another arch. See [packaging.md](packaging.md#the-one-gotcha).

```bash
npm run rebuild
```

## `"claude" was not found on PATH`

The app resolves your login shell's PATH at startup (`$SHELL -ilc`), because a GUI app
inherits a bare one. If a CLI works in your terminal but not in Plexus:

- **You installed it after launching Plexus.** Restart the app; the PATH is cached.
- **Your PATH is set in a non-interactive-only file.** `-ilc` sources interactive rc files
  (`.zshrc`, `.bashrc`). If your version manager is only set up in `.zprofile` under a
  guard that skips interactive shells, it won't be found.

Check what the app sees:

```bash
$SHELL -ilc 'command -v claude copilot'
```

## macOS asks for keychain access

The first time Copilot runs as a child of Plexus rather than of your terminal, macOS treats
it as a new caller and prompts for the login keychain. Choose **Always Allow** once.

## The lock timed out

```
timed out waiting for lock "task-1a2b3c4d"
```

Something held a lock for more than 10 seconds. A dead process's lock is broken
automatically after 30 seconds, so this usually clears on its own. If it doesn't:

```bash
ls -la .harness/.locks/ && rm -rf .harness/.locks/*.lock
```

Only do that when you're sure nothing is running.

## Starting over

```bash
rm -rf .harness       # wipes tasks, chat, activity, jobs and the scoreboard
```

The harness recreates it on next launch. Nothing outside `.harness/` is touched.
