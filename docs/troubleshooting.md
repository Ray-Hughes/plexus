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

Nothing to do with PATH, despite how it reads. `node-pty` execs a `spawn-helper` binary out
of its prebuild directory, and npm strips the executable bit when it packs a tarball:

```bash
node scripts/fix-native-permissions.mjs
```

That runs automatically on `postinstall`. The other way to hit this is letting
`electron-builder` rebuild the native module, which swaps the host binary for one built for
whatever architecture was last packaged — `npmRebuild: false` prevents that. See
[packaging.md](packaging.md#no-native-toolchain-required).

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

## "Plexus is damaged and can't be opened"

Fixed in v0.3.1 — **download that or later.** Builds before it carried an invalid signature
(electron-builder skipped signing but had already modified the bundle, leaving Electron's
stale one behind). macOS reports an Apple Silicon app with a broken signature as *damaged*,
refuses to open it, and **deletes it from disk** — which is why it seemed to vanish.

## "Apple could not verify Plexus is free of malware"

Expected, and *not* the same as "damaged" — the app is fine and still on disk. The builds
are ad-hoc signed but not notarized, because notarizing needs a paid Apple developer
account, so macOS quarantines them on download.

The dialog offers only **Move to Trash** and **Done**. Click **Done**, then either open
**System Settings → Privacy & Security** and click **Open Anyway**, or clear the flag:

```bash
xattr -dr com.apple.quarantine /Applications/Plexus.app
```

Easiest is to let the installer do it:

```bash
curl -fsSL https://raw.githubusercontent.com/Ray-Hughes/plexus/main/scripts/install-macos.sh | bash
```

**This comes back on every manual update.** The quarantine flag belongs to the copy your
browser downloaded, so dragging a new `.dmg` over an existing install re-applies it — even
if you cleared it on the copy you just replaced.

A launch that exits immediately with code 137 and leaves the app in place is the same
thing, caught from a terminal where there is no dialog to show you.

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
