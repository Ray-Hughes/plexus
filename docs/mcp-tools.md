# MCP tool reference

Every tool the `harness-bridge` server exposes. Both agents get all of them in their
interactive sessions; a *dispatched* agent gets far less (see [Scoping](#scoping)).

Tool names are prefixed by the calling CLI: Claude Code sees
`mcp__harness-bridge__submit_review`, Copilot CLI sees `harness-bridge-submit_review`.

---

## Tier 3 — Dispatch

### `dispatch`

Hand a bounded task to the other agent.

| Field | Type | Default | Notes |
|---|---|---|---|
| `target` | `"claude" \| "copilot"` | — | Dispatching to yourself is refused. |
| `task` | string | — | State it so it stands alone; the other agent has none of your context. |
| `context` | string | — | Appended under a `Context:` heading. |
| `mode` | `"sync" \| "async"` | `"sync"` | `sync` blocks; `async` returns a job id. |
| `timeout_seconds` | integer | `300` | Max 3600. |

```jsonc
// sync — the answer comes back inside your turn
{ "target": "copilot", "task": "Does src/zip/pipeline.ts handle a retry-exhausted upload?" }

// async — returns { "job_id": "job-1a2b3c4d", "status": "queued" }
{ "target": "copilot", "task": "Audit every call site of uploadArtifact", "mode": "async" }
```

### `get_job`

Poll an async dispatch. Returns the full job record: `status` (`queued`/`running`/`done`/
`failed`), `result`, `error`, and timestamps.

---

## Tier 1 / 5 — Awareness

### `get_activity`

`{ "last_n": 20 }` → the shared trace, newest last. **Check this before starting work.**

### `post_chat`

`{ "message": "..." }` — speak into the room the human is watching. Use it to flag that
you're about to touch a file, or to ask a question that isn't worth a task.

### `get_chat`

`{ "last_n": 30 }` → recent messages with speaker and timestamp.

---

## Tier 4 — Task board

### `create_task`

| Field | Type | Default |
|---|---|---|
| `title` | string | — |
| `description` | string | — |
| `assignee` | `"claude" \| "copilot" \| "human" \| "self" \| "unassigned"` | `"unassigned"` |
| `priority` | `"low" \| "normal" \| "high"` | `"normal"` |

`"self"` resolves to whichever agent is calling. An unassigned task opens as `open`; an
assigned one as `in_progress`; one assigned to `human` as `needs_human`.

### `assign_task`

`{ "task_id": "task-1a2b3c4d", "assignee": "copilot" }`. Assigning to `human` also posts a
line into the shared room.

### `update_task`

`{ "task_id": ..., "status"?: ..., "note"?: ... }`

Valid statuses: `open`, `in_progress`, `blocked`, `review`, `revise`, `needs_human`,
`cancelled`.

**`done` is deliberately not in that list.** The only way a task closes is the other agent
approving it.

### `list_tasks` / `get_task`

`list_tasks` filters by `assignee` and/or `status`, newest activity first. `get_task`
returns one task in full, including its note trail and any reviews.

---

## Tier 6 — Consensus

### `submit_proposal`

```jsonc
{ "task_id": "task-1a2b3c4d",
  "result": "Added a retry-exhausted branch in uploadArtifact (src/zip/pipeline.ts:88) that
             surfaces the failure instead of returning a truthy handle. Covered by the new
             case in pipeline.test.ts." }
```

This is how you finish work. It:

1. records the result and moves the task to `review`,
2. clears any verdicts from a previous round,
3. increments your `proposals` count,
4. dispatches the *other* agent headlessly to review it, and
5. returns the task once that review has resolved it.

Proposing on an already-closed task errors.

### `submit_review`

```jsonc
{ "task_id": "task-1a2b3c4d",
  "verdict": "revise",
  "notes": "The retry-exhausted branch is right, but uploadArtifact is also called from
            src/zip/batch.ts:41 where the return value is still assumed truthy." }
```

| Verdict | Effect |
|---|---|
| `approve` | Task closes as `done`. If it took no revision rounds, the proposer's `approved_first_try` goes up. |
| `revise` | Back to the proposer with your notes, `revision_rounds` +1. At 2 rounds it escalates to the human instead. |
| `reject` | Straight to the human. No revision round. Use this only when the *approach* is wrong. |

`notes` is required for every verdict, including `approve` — an approval with no reasoning
is exactly the thing this loop exists to prevent.

### `get_scoreboard`

```jsonc
{ "claude":  { "proposals": 3, "approved_first_try": 2, "needed_revision": 1,
               "reviews_done": 4, "issues_caught": 1 },
  "copilot": { "proposals": 4, "approved_first_try": 4, "needed_revision": 0,
               "reviews_done": 3, "issues_caught": 1 } }
```

Read it as a trend over dozens of tasks. See
[architecture.md](architecture.md#on-the-scoreboard) for what `issues_caught` can and
cannot tell you.

---

## Scoping

An agent working interactively has every tool above. An agent that was *dispatched* has
much less, and that is the point.

| Context | Claude | Copilot |
|---|---|---|
| Plain dispatch | `Read,Grep,Glob` | `--deny-tool=write --deny-tool=shell --no-ask-user` |
| Review dispatch | the above plus `get_task`, `submit_review` | the above plus `--allow-tool=harness-bridge` |

A reviewer can read the repo and record a verdict. It cannot write files, run shell
commands, or dispatch anyone else.

Override the argument vectors per project in `.harness/config.json` if a CLI renames a flag:

```jsonc
{ "review": { "copilot": {
    "command": "copilot",
    "args": ["-p", "{{PROMPT}}", "-s", "--no-ask-user",
             "--deny-tool=write", "--deny-tool=shell",
             "--additional-mcp-config", "@.copilot/mcp-config.json",
             "--allow-tool=harness-bridge"] } } }
```

`{{PROMPT}}` is substituted with the task text. Anything you leave out falls back to the
built-in default.
