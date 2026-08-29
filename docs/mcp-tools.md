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
| `instructions` | string | — |
| `requirements` | string[] | — |

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

## Task detail — the brief

A task is more than a title and a sentence. What is attached to it here is what the
assignee works from and what the reviewer is held to.

### `get_brief`

`{ "task_id": "task-1a2b3c4d" }` → the task rendered as one document:

```markdown
# Surface retry-exhausted failures in the upload pipeline

When every retry is exhausted, uploadArtifact returns a truthy handle and the caller
carries on as if the upload succeeded.

## Instructions

Keep the public signature of uploadArtifact unchanged — three call sites depend on it.

## Requirements — the work must satisfy every one of these

- [ ] A retry-exhausted upload is distinguishable from a successful one at every call site
- [x] The public signature of uploadArtifact is unchanged
- [ ] Covered by a test that exercises the exhausted path

## Attachments

- **pipeline.ts** (file): `src/zip/pipeline.ts` — read this file
- **repro** (note):

  Point it at a bucket that 503s on every PUT.
```

**Call this first when you're handed a task.** Sections with nothing in them are omitted.

### `set_instructions`

`{ "task_id": ..., "instructions": "..." }` — the long-form detail: constraints,
background, how to verify. Replaces whatever was there; it does not touch `description`.

### `add_requirement`

`{ "task_id": ..., "text": "covered by a test that exercises the exhausted path" }`

Requirements are the bar. They go verbatim into the reviewing agent's prompt, which is
asked to walk them one at a time — so write them so they can be *checked*, not interpreted.
"Handles errors properly" is not a requirement; "returns null rather than a handle when the
retry budget is spent" is.

### `set_requirement_done`

`{ "task_id": ..., "requirement_id": "req-1a2b3c4d", "done": true }`

Ticking one is a claim the reviewer will check. It is not a way to close the task.

### `add_attachment`

| `kind` | `value` holds | Use it for |
|---|---|---|
| `file` | a repo-relative path | A file the assignee should open itself |
| `link` | a URL | A ticket, a doc, a failing CI run |
| `note` | the text inline | A repro, a log excerpt, a decision |

```jsonc
{ "task_id": ..., "kind": "file", "name": "pipeline.ts", "value": "src/zip/pipeline.ts" }
```

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
