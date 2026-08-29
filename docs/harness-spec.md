# Dual-Agent Harness: Claude Code + Copilot CLI, Joined by a Shared Nervous System

Two separate bodies — one Claude Code session, one Copilot CLI session — each with its own head (context window, conversation history, model) but wired into one shared nervous system: a spine that carries signals between them, a memory trace both can read, a working memory of who's doing what, a shared room where you and both agents are present at once, and a consensus loop that means nothing counts as finished until both agents agree it's actually good. Neither agent loses its independence — they just can't quietly ship slop past each other anymore.

## 1. Goal

Two independent, long-running agent sessions — Claude Code in one terminal pane, Copilot CLI in another, both pointed at the same repo — that:

1. See what the other is currently doing (shared situational awareness)
2. Can ask the other to do a bounded task and get a result back (cross-dispatch), e.g. "Claude, have Copilot review this diff"
3. Stay independent otherwise — separate context windows, separate conversation history, no shared memory beyond what's explicitly exchanged
4. Track work as assignable tasks — to Claude, to Copilot, to itself, or to you — with status and a full history, not fire-and-forget calls
5. Meet in one shared chat, where you type once and either agent (routed by a coordinator) picks it up, with both agents' output landing in that same room
6. Never mark work done unilaterally — every proposal one agent produces has to survive the other agent's review before it counts as finished, with disagreements escalating to you, and a running scoreboard of who proposes clean work and who catches real problems

This is achievable today, on real primitives both tools already support:

| Primitive | Claude Code | Copilot CLI |
|---|---|---|
| Headless/one-shot invocation | `claude -p "..." --output-format json --allowedTools "Read,Grep,Glob"` | `copilot -p "..." -s --no-ask-user --deny-tool=write --deny-tool=shell` |
| MCP server support | Project `.mcp.json` | Project `.mcp.json` / `.github/mcp.json` (needs `"type"` field) or user `~/.copilot/mcp-config.json` |
| Skills (SKILL.md) | `.claude/skills/`, personal skills dir | `.github/skills/`, `~/.copilot/skills/` |

One small local MCP server that both agents load (the bridge) is the core. A standalone process anchors the shared chat pane (the coordinator). Everything else — task tracking, review, scoring — is state the bridge manages on top of those two pieces.

---

## 2. Physical layout

```
tmux (or iTerm/Windows Terminal split — three panes)
├── Pane 1: claude              (interactive Claude Code, cwd = repo root)
├── Pane 2: copilot             (interactive Copilot CLI, cwd = repo root)
└── Pane 3: chat                (node harness-coordinator/index.js — shared room + scheduler)

repo-root/
├── .harness/
│   ├── activity.log             # Tier 1 — background trace
│   ├── chat.log                 # Tier 5 — shared multiplayer transcript
│   ├── jobs/                    # Tier 2/3 — async job results (job-<id>.json)
│   ├── tasks/                   # Tier 4 — task board (task-<id>.json per task)
│   └── scoreboard.json          # Tier 6 — running consensus/quality tally
├── .mcp.json                    # Claude Code MCP config (bridge, --agent=claude)
├── .copilot/
│   └── mcp-config.json          # Copilot CLI MCP config (bridge, --agent=copilot)
├── harness-bridge/
│   ├── package.json
│   ├── lib.js                    # shared: runHeadless, tasks, chat, review, scoreboard
│   └── index.js                  # the MCP server — tools both agents call
└── harness-coordinator/
    └── index.js                  # standalone process behind Pane 3 — the scheduler
```

Both agents work in the same repo/worktree. Dispatch calls default to bounded, mostly read-only tasks — see §8 for the guardrails around widening that.

---

## 3. The nervous system — six tiers, build every one of them, in order

Ambient awareness first, then a reflex, a real spinal cord, working memory of who's doing what, the room where everyone including you is present, and finally the layer that forces agreement before anything counts as finished.

### Tier 1 — Shared memory trace (background / autonomic)
`.harness/activity.log`. Each session appends a line when it starts or finishes something meaningful.

- Claude Code: in `CLAUDE.md` — "Before starting significant work, append a line to `.harness/activity.log`. Before answering, check the last 10 lines for what Copilot is doing."
- Copilot CLI: same instruction in `.github/copilot-instructions.md`

### Tier 2 — File-based task mailbox (reflex arc)
`.harness/jobs/<id>.json`, written by the requester, picked up by a watcher that runs the target CLI headlessly and writes the result back. This is the async backbone the `dispatch` tool's async mode is built on in Tier 3 — build it now, not as a retrofit.

### Tier 3 — MCP bridge server (the spinal cord)
A local MCP server, loaded by **both** CLIs. The live channel: a signal sent from one agent, carried straight to the other, response handed back before the sending agent's turn ends. Everything in Tiers 4–6 is tools on this same server.

### Tier 4 — Shared task board (working memory)
Persistent records in `.harness/tasks/` — what a task is, who it's assigned to (Claude, Copilot, itself, or you), what state it's in, and a running trail of notes. This is what makes work visible and ownable instead of a string returned from a one-off call.

### Tier 5 — Shared chat + coordinator (the central executive)
A third pane where you type once, into a room both agents are effectively listening to. The **coordinator** doesn't do any coding itself — it routes: reads what you type, decides who should act, opens a Tier 4 task, dispatches through the Tier 3 bridge, and posts the result back into the room.

### Tier 6 — Consensus and reward (the immune system)
No task reaches `done` on one agent's say-so. When the assignee believes its work is finished, it submits a proposal instead of closing the task — and that proposal is automatically routed to the *other* agent for review before it counts. The reviewer casts a verdict; disagreement escalates back to the proposer for revision, and repeated disagreement escalates to you. Every proposal and every review is tallied on a running scoreboard, so over time you have real signal — not a vibe — on which agent tends to ship clean work and which one actually catches problems when it reviews.

---

## 4. Bridge server design (Tiers 3–6 — one server, all its tools)

### 4.1 Tool schemas

```jsonc
// dispatch — Tier 3
{
  "name": "dispatch",
  "description": "Send a bounded task to the other coding agent and get its result back.",
  "input_schema": { "type": "object", "properties": {
    "target": { "type": "string", "enum": ["claude", "copilot"] },
    "task": { "type": "string" }, "context": { "type": "string" },
    "mode": { "type": "string", "enum": ["sync", "async"], "default": "sync" },
    "timeout_seconds": { "type": "integer", "default": 300 }
  }, "required": ["target", "task"] }
}
```

```jsonc
// task board — Tier 4
{ "name": "create_task", "input_schema": { "type": "object", "properties": {
    "title": { "type": "string" }, "description": { "type": "string" },
    "assignee": { "type": "string", "enum": ["claude", "copilot", "human", "self", "unassigned"], "default": "unassigned" },
    "priority": { "type": "string", "enum": ["low", "normal", "high"], "default": "normal" }
  }, "required": ["title", "description"] } }

{ "name": "assign_task", "input_schema": { "type": "object", "properties": {
    "task_id": { "type": "string" }, "assignee": { "type": "string", "enum": ["claude", "copilot", "human", "self"] }
  }, "required": ["task_id", "assignee"] } }

{ "name": "update_task", "input_schema": { "type": "object", "properties": {
    "task_id": { "type": "string" },
    "status": { "type": "string", "enum": ["open", "in_progress", "blocked", "review", "revise", "needs_human", "done", "cancelled"] },
    "note": { "type": "string" }
  }, "required": ["task_id"] } }

{ "name": "list_tasks", "input_schema": { "type": "object", "properties": {
    "assignee": { "type": "string" }, "status": { "type": "string" } } } }

{ "name": "get_task", "input_schema": { "type": "object", "properties": { "task_id": { "type": "string" } }, "required": ["task_id"] } }
```

```jsonc
// chat — Tier 5
{ "name": "post_chat", "input_schema": { "type": "object", "properties": { "message": { "type": "string" } }, "required": ["message"] } }
{ "name": "get_activity", "input_schema": { "type": "object", "properties": { "last_n": { "type": "integer", "default": 20 } } } }
```

```jsonc
// consensus + reward — Tier 6
{ "name": "submit_proposal", "description": "Mark a task's work as ready for review. Automatically dispatches the other agent to evaluate it before it can be marked done.",
  "input_schema": { "type": "object", "properties": {
    "task_id": { "type": "string" }, "result": { "type": "string" }
  }, "required": ["task_id", "result"] } }

{ "name": "submit_review", "description": "Called by the reviewing agent to cast a verdict on a proposal. Resolves the task's status.",
  "input_schema": { "type": "object", "properties": {
    "task_id": { "type": "string" },
    "verdict": { "type": "string", "enum": ["approve", "revise", "reject"] },
    "notes": { "type": "string" }
  }, "required": ["task_id", "verdict", "notes"] } }

{ "name": "get_scoreboard", "input_schema": { "type": "object", "properties": {} } }
```

### 4.2 Shared library (`harness-bridge/lib.js`)

```js
// harness-bridge/lib.js
import { execFile } from "node:child_process";
import { appendFileSync, writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const HARNESS_DIR = ".harness";
export const LOG = `${HARNESS_DIR}/activity.log`;
export const CHAT_LOG = `${HARNESS_DIR}/chat.log`;
export const TASKS_DIR = `${HARNESS_DIR}/tasks`;
export const SCOREBOARD = `${HARNESS_DIR}/scoreboard.json`;
mkdirSync(`${HARNESS_DIR}/jobs`, { recursive: true });
mkdirSync(TASKS_DIR, { recursive: true });
if (!existsSync(CHAT_LOG)) writeFileSync(CHAT_LOG, "");
if (!existsSync(SCOREBOARD)) {
  const blank = () => ({ proposals: 0, approved_first_try: 0, needed_revision: 0, reviews_done: 0, issues_caught: 0 });
  writeFileSync(SCOREBOARD, JSON.stringify({ claude: blank(), copilot: blank() }, null, 2));
}

export function log(line) { appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`); }
export function postChat(speaker, message) { appendFileSync(CHAT_LOG, `[${new Date().toISOString()}] ${speaker}: ${message}\n`); }

export function bumpScore(agent, field, by = 1) {
  const board = JSON.parse(readFileSync(SCOREBOARD, "utf8"));
  board[agent][field] += by;
  writeFileSync(SCOREBOARD, JSON.stringify(board, null, 2));
}
export function getScoreboard() { return JSON.parse(readFileSync(SCOREBOARD, "utf8")); }

// Plain dispatch/review commands. Review variant also grants the bridge's own
// tools so a headless reviewer can call get_task / submit_review on its way out --
// check `copilot --help` / claude docs for exact current MCP-tool-allow syntax,
// both CLIs iterate their flag names frequently.
const CMDS = {
  claude: (task) => ["claude", ["-p", task, "--output-format", "json", "--allowedTools", "Read,Grep,Glob"]],
  copilot: (task) => ["copilot", ["-p", task, "-s", "--no-ask-user", "--deny-tool=write", "--deny-tool=shell"]],
};
const REVIEW_CMDS = {
  claude: (task) => ["claude", ["-p", task, "--output-format", "json",
    "--allowedTools", "Read,Grep,Glob,mcp__harness-bridge__get_task,mcp__harness-bridge__submit_review"]],
  copilot: (task) => ["copilot", ["-p", task, "-s", "--no-ask-user", "--deny-tool=write", "--deny-tool=shell",
    "--allow-tool=mcp(harness-bridge)"]],
};

export async function runHeadless(target, task, { review = false } = {}) {
  const [cmd, args] = (review ? REVIEW_CMDS : CMDS)[target](task);
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 20, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// --- Tier 4: task board ---
export function createTask({ title, description, created_by, assignee = "unassigned", priority = "normal" }) {
  const id = `task-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const task = { id, title, description, created_by, assignee,
                 status: assignee === "unassigned" ? "open" : "in_progress",
                 priority, created_at: now, updated_at: now, notes: [], result: null,
                 reviews: {}, revision_rounds: 0 };
  writeFileSync(`${TASKS_DIR}/${id}.json`, JSON.stringify(task, null, 2));
  log(`TASK CREATED ${id} by ${created_by} -> ${assignee}: ${title}`);
  return task;
}

export function getTask(id) { return JSON.parse(readFileSync(`${TASKS_DIR}/${id}.json`, "utf8")); }
export function saveTask(task) { task.updated_at = new Date().toISOString(); writeFileSync(`${TASKS_DIR}/${task.id}.json`, JSON.stringify(task, null, 2)); }

export function assignTask(id, assignee, by) {
  const task = getTask(id);
  task.assignee = assignee;
  task.status = assignee === "unassigned" ? "open" : "in_progress";
  task.notes.push({ by, at: new Date().toISOString(), text: `assigned to ${assignee}` });
  saveTask(task);
  log(`TASK ASSIGNED ${id} -> ${assignee} (by ${by})`);
  if (assignee === "human") postChat("coordinator", `needs your input -- ${task.title} (${id})`);
  return task;
}

export function updateTask(id, { status, note, by }) {
  const task = getTask(id);
  if (status) task.status = status;
  if (note) task.notes.push({ by, at: new Date().toISOString(), text: note });
  saveTask(task);
  log(`TASK UPDATED ${id}: status=${task.status}`);
  return task;
}

export function listTasks({ assignee, status } = {}) {
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${TASKS_DIR}/${f}`, "utf8")))
    .filter((t) => (!assignee || t.assignee === assignee) && (!status || t.status === status));
}

// --- Tier 6: consensus + reward ---
const OTHER = { claude: "copilot", copilot: "claude" };
const MAX_REVISION_ROUNDS = 2;

export async function submitProposal(id, result, proposer) {
  const task = getTask(id);
  task.result = result;
  task.status = "review";
  task.reviews = {};
  saveTask(task);
  bumpScore(proposer, "proposals");
  log(`PROPOSAL ${id} by ${proposer}`);
  postChat(proposer, `proposed a result for "${task.title}" (${id}) -- routing to ${OTHER[proposer]} for review`);

  const reviewer = OTHER[proposer];
  const prompt = `Task ${id} ("${task.title}") was proposed by ${proposer}.\n\nDescription: ${task.description}\n\nProposed result:\n${result}\n\n` +
    `Call get_task("${id}") if you need the full record, then evaluate this on its merits -- correctness, completeness, whether it actually solves the task, not just whether it looks plausible. ` +
    `Call submit_review with task_id="${id}", verdict ("approve" | "revise" | "reject"), and notes explaining your reasoning either way.`;
  await runHeadless(reviewer, prompt, { review: true });
  return getTask(id);
}

export function submitReview(id, verdict, notes, reviewer) {
  const task = getTask(id);
  task.reviews[reviewer] = { verdict, notes, at: new Date().toISOString() };
  saveTask(task);
  bumpScore(reviewer, "reviews_done");
  if (verdict !== "approve") bumpScore(reviewer, "issues_caught");

  const proposer = OTHER[reviewer];
  if (verdict === "approve") {
    task.status = "done";
    if (task.revision_rounds === 0) bumpScore(proposer, "approved_first_try");
    postChat(reviewer, `approved "${task.title}" (${id})${notes ? ` -- ${notes}` : ""}`);
  } else if (verdict === "reject") {
    task.status = "needs_human";
    task.assignee = "human";
    postChat("coordinator", `${proposer} and ${reviewer} disagree on "${task.title}" (${id}) -- ${reviewer} rejected it outright: ${notes}. Needs your call.`);
  } else {
    // revise
    task.revision_rounds += 1;
    bumpScore(proposer, "needed_revision");
    if (task.revision_rounds >= MAX_REVISION_ROUNDS) {
      task.status = "needs_human";
      task.assignee = "human";
      postChat("coordinator", `"${task.title}" (${id}) has gone through ${task.revision_rounds} revision rounds without agreement -- needs your call. Latest note from ${reviewer}: ${notes}`);
    } else {
      task.status = "revise";
      task.assignee = proposer;
      postChat(reviewer, `sent "${task.title}" (${id}) back for revision -- ${notes}`);
    }
  }
  saveTask(task);
  log(`REVIEW ${id} by ${reviewer}: ${verdict}`);
  return task;
}
```

### 4.3 The bridge server (`harness-bridge/index.js`)

Each CLI launches its own instance with an `--agent=` flag baked into its MCP config — that's what makes `assignee: "self"` resolve to something real, and what tells the server which identity is calling `submit_proposal` or `submit_review`.

```js
// harness-bridge/index.js
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import * as lib from "./lib.js";

const AGENT = (process.argv.find((a) => a.startsWith("--agent=")) || "--agent=unknown").split("=")[1];
const resolve = (who) => (who === "self" ? AGENT : who);

const server = new Server({ name: "harness-bridge", version: "0.3.0" }, { capabilities: { tools: {} } });

server.setRequestHandler("tools/call", async (req) => {
  const { name, arguments: a } = req.params;

  switch (name) {
    case "dispatch": {
      const task = a.context ? `${a.task}\n\nContext:\n${a.context}` : a.task;
      lib.log(`DISPATCH ${AGENT} -> ${a.target}: ${a.task.slice(0, 120)}`);
      const out = await lib.runHeadless(a.target, task);
      lib.log(`DONE <- ${a.target}`);
      return { content: [{ type: "text", text: out }] };
    }
    case "get_activity": {
      const lines = readFileSync(lib.LOG, "utf8").trim().split("\n");
      return { content: [{ type: "text", text: lines.slice(-(a.last_n ?? 20)).join("\n") }] };
    }
    case "create_task":
      return { content: [{ type: "text", text: JSON.stringify(lib.createTask({ ...a, created_by: AGENT, assignee: resolve(a.assignee ?? "unassigned") })) }] };
    case "assign_task":
      return { content: [{ type: "text", text: JSON.stringify(lib.assignTask(a.task_id, resolve(a.assignee), AGENT)) }] };
    case "update_task":
      return { content: [{ type: "text", text: JSON.stringify(lib.updateTask(a.task_id, { ...a, by: AGENT })) }] };
    case "list_tasks":
      return { content: [{ type: "text", text: JSON.stringify(lib.listTasks(a)) }] };
    case "get_task":
      return { content: [{ type: "text", text: JSON.stringify(lib.getTask(a.task_id)) }] };
    case "post_chat":
      lib.postChat(AGENT, a.message);
      return { content: [{ type: "text", text: "posted" }] };
    case "submit_proposal":
      return { content: [{ type: "text", text: JSON.stringify(await lib.submitProposal(a.task_id, a.result, AGENT)) }] };
    case "submit_review":
      return { content: [{ type: "text", text: JSON.stringify(lib.submitReview(a.task_id, a.verdict, a.notes, AGENT)) }] };
    case "get_scoreboard":
      return { content: [{ type: "text", text: JSON.stringify(lib.getScoreboard()) }] };
    default:
      return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
```

This is a working skeleton, not production code — no schema validation, no concurrent-job cap. Good enough to prove the design out; harden it per §8 before trusting it with anything destructive.

### 4.4 Registering it in both CLIs

`.mcp.json` (repo root, Claude Code reads this natively):
```json
{
  "mcpServers": {
    "harness-bridge": { "command": "node", "args": ["harness-bridge/index.js", "--agent=claude"] }
  }
}
```

`.copilot/mcp-config.json` (Copilot CLI requires the `type` field):
```json
{
  "mcpServers": {
    "harness-bridge": { "type": "local", "command": "node", "args": ["harness-bridge/index.js", "--agent=copilot"] }
  }
}
```

Same server code, two config files, each launching its own instance with its own identity baked in.

---

## 5. Shared chat + coordinator (Tier 5)

`harness-coordinator/index.js` runs in Pane 3. It isn't an MCP server — it's a standalone process that owns the chat pane directly: prints the transcript, reads what you type, drives the same `lib.js` functions the bridge uses.

```js
// harness-coordinator/index.js
import * as lib from "../harness-bridge/lib.js";
import { createInterface } from "node:readline";
import { watchFile, readFileSync } from "node:fs";

process.stdout.write(readFileSync(lib.CHAT_LOG, "utf8"));

let lastSize = readFileSync(lib.CHAT_LOG, "utf8").length;
watchFile(lib.CHAT_LOG, { interval: 500 }, () => {
  const content = readFileSync(lib.CHAT_LOG, "utf8");
  if (content.length > lastSize) process.stdout.write(content.slice(lastSize));
  lastSize = content.length;
});

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  lib.postChat("human", line);

  let targets = [];
  let body = line;
  if (/^@claude\b/.test(line)) { targets = ["claude"]; body = line.replace(/^@claude\b/, "").trim(); }
  else if (/^@copilot\b/.test(line)) { targets = ["copilot"]; body = line.replace(/^@copilot\b/, "").trim(); }
  else if (/^@both\b/.test(line)) { targets = ["claude", "copilot"]; body = line.replace(/^@both\b/, "").trim(); }
  else { lib.postChat("coordinator", "Reply with @claude, @copilot, or @both so I know who should take this."); return; }

  for (const target of targets) {
    const task = lib.createTask({ title: body.slice(0, 60), description: body, created_by: "coordinator", assignee: target });
    try {
      const result = await lib.runHeadless(target, body);
      await lib.submitProposal(task.id, result, target);
      lib.postChat(target, result);
    } catch (e) {
      lib.updateTask(task.id, { status: "blocked", note: e.message, by: "coordinator" });
      lib.postChat("coordinator", `${target} failed: ${e.message}`);
    }
  }
});
```

Every piece of chat-routed work goes through `submitProposal`, not straight to `done` — that's what pulls Tier 6's consensus loop into the shared chat automatically, not just into direct pane-to-pane dispatches.

The routing rule is deliberately simple: `@claude` / `@copilot` / `@both`, anything else gets bounced back with a question instead of guessed at. That's auditable by design. The natural upgrade once you trust it is swapping the `if/else` for a cheap classification call that reads the message and current task board and picks a target — same interface, smarter router.

**Human-in-the-loop** runs through the same room. `assignTask(..., "human")` and the escalation paths inside `submitReview` (repeated revision, an outright reject) all call `postChat("coordinator", ...)`, which the coordinator's file watcher prints into Pane 3 immediately. You see it in the room you're already watching, and reply with `@claude` or `@copilot` to hand it back, or resolve it yourself.

---

## 6. Consensus and reward (Tier 6)

The mechanism: when an agent believes its work on a task is finished, it doesn't set `status: done` itself — it calls `submit_proposal`, which flips the task to `review` and automatically dispatches the *other* agent, headlessly, with instructions to pull the task, evaluate it on its merits, and call `submit_review` with a verdict. That headless reviewer session still has the bridge's tools loaded (via its own `--agent=` instance), so it can act on the task directly rather than just returning text for a human to interpret.

Three outcomes:
- **Approve** → task closes as `done`. If it closed without needing any revision round, the proposer's `approved_first_try` count goes up.
- **Revise** → task bounces back to the proposer with the reviewer's notes attached, capped at two rounds before it escalates.
- **Reject** → skips revision entirely and escalates straight to you — a flat rejection means the two agents disagree on the approach itself, not just the execution, and that's a call worth making yourself rather than iterating on.

The scoreboard (`get_scoreboard`) tallies, per agent: proposals made, how many were approved first try, how many needed revision, how many reviews it did of the other's work, and how many of those reviews flagged something (`issues_caught`). Read this as a trend over dozens of tasks, not a verdict on any single one — it's a proxy, not a certified quality measure. A reviewer that always approves will show a low `issues_caught` rate that could mean the other agent's work is genuinely clean, or could mean it's rubber-stamping; a reviewer that's harsh will show the opposite pattern for the opposite possible reasons. What it's good for is noticing, over time, whether one tool tends to produce work that survives review cleanly and whether the other one's reviews are actually catching real things — which is exactly the signal you're after in wanting them to reach consensus in the first place, rather than trusting either one's self-report.

---

## 7. Example flows

**Direct dispatch with consensus, from inside the Claude Code pane:**

You ask Claude to fix a bug in the zip pipeline. Claude does the work, then calls `submit_proposal(task_id, result)` instead of just telling you it's done. That automatically dispatches Copilot headlessly to review the change against the task description. Copilot calls `get_task`, reads the proposal, and calls `submit_review(task_id, "revise", "the fix handles the timeout case but not the retry-exhausted case")`. The task bounces back to Claude with that note attached; Claude addresses it and proposes again; Copilot approves; the task closes `done`, and Claude's `approved_first_try` count does *not* go up, since it needed a round of revision — an honest record of what actually happened.

**Shared chat with escalation to you, from Pane 3:**

You type `@both check if the eFolder status refactor breaks the zip pipeline`. The coordinator opens a task for each agent, dispatches both, and each one's result routes through `submitProposal` — meaning Claude's finding gets reviewed by Copilot and vice versa. Say Copilot's proposal claims no issue, but Claude's review flags a real race condition and casts `verdict: "reject"` because it's not a "needs polish" issue, it's a wrong conclusion. That skips revision and escalates straight to you: `coordinator: claude and copilot disagree on "..." -- claude rejected it outright: ... Needs your call.` You see it live in the chat pane and make the call.

---

## 8. Guardrails worth building in from day one

- **Keep the dispatched agent read-only by default.** `--allowedTools Read,Grep,Glob` / `--deny-tool=write --deny-tool=shell` for plain dispatch and proposal work; the review variant additionally scopes in only the bridge's own task/review tools, nothing else. Widen scope per-call, deliberately, never globally.
- **Timeout everything.** Cap headless calls at 5 minutes so nothing hangs a turn indefinitely.
- **Cap revision rounds.** `MAX_REVISION_ROUNDS = 2` in the reference implementation — beyond that, the disagreement itself is the signal, and it goes to you rather than looping forever.
- **A flat reject skips straight to human, not another revision round.** Rejection means the agents disagree on the approach, not the execution — that's not something more automated back-and-forth resolves.
- **Log every dispatch, task transition, and review verdict**, even failures — your debugging trail across three concurrent processes and two review paths.
- **The task board and review loop are not an approval system for tool permissions.** A task assigned to an agent, or a proposal sent for review, doesn't grant broader tool access than that specific dispatch call's flags allow.
- **Keep the coordinator's chat routing simple and auditable.** The `@mention` rule in §5 is intentional — no hidden model call decides what happens to your message before you've watched the simple version behave correctly for a while.
- **Read the scoreboard as a trend, not a scorecard for any single task** — see §6's caveat on what `issues_caught` can and can't tell you.
- **Don't dispatch into files being actively edited** by the other pane unless the call is read-only — the one real file-collision risk here.

---

## 9. Technical requirements — building this as a desktop app

Everything above is currently spec'd as terminal panes plus a Node MCP server. That maps directly onto a desktop app instead of a tmux layout — the bridge logic doesn't change, only where it runs and how you see it.

### 9.1 Repo

- **Host:** `github.com/ray-hughes` (personal account), private repo.
- **Working name:** `plexus` — a network of interconnected nerves, which is exactly what this is. Trivial to rename before you push the first commit if you want something else.
- **SSH:** the laptop has separate keys for work and personal GitHub — use the personal host alias already configured in `~/.ssh/config`, not bare `github.com` (which may resolve to whichever key your global config defaults to). Concretely:
  - `git remote add origin git@<your-personal-host-alias>:ray-hughes/plexus.git`, using whatever alias you already set up for the personal key — check `~/.ssh/config` for the `Host` entry pointing at the personal identity file.
  - Set the git identity inside this repo specifically rather than relying on a global default, in case that default is your work email: `git config user.email "<personal email>"` (run from inside the repo, so it's local not global).
  - If you use `gh` for repo creation, confirm `gh auth status` shows the personal account active first (`gh auth switch` if it's currently on work), then `gh repo create ray-hughes/plexus --private --source=. --remote=origin`.

### 9.2 Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Mature PTY/native-module and packaging story for both platforms in one build. You've already built [[specter-ide]] on this exact stack, so there's real prior experience to draw on. [[hyperonic]] is the more interesting long-term bet, but it's still in development and this app leans hard on things Electron already has solved (node-pty, code signing, auto-update) — worth revisiting once Hyperonic has a packaging and PTY story of its own. |
| UI | React + TypeScript | Same as Specter IDE. |
| Terminal panes | `node-pty` + `xterm.js` | Spawns `claude` and `copilot` as real PTY processes — full ANSI/interactive fidelity, not a re-implementation of their UI. This is the same combination VS Code's integrated terminal uses. |
| Bridge logic | Ported directly from `harness-bridge/lib.js` (§4.2) | One implementation of tasks/chat/consensus/scoreboard, exposed two ways: as an MCP server over stdio (for `claude` and `copilot`'s own tool calls, unchanged from §4.3) and over Electron IPC (for the app's own UI panels). |
| State | Flat files under `.harness/` in the opened project folder, unchanged from §4.2 | Git-diffable, no new dependency, already spec'd. Revisit with `better-sqlite3` only if concurrent-write contention becomes a real problem in practice. |
| Packaging | `electron-builder` | One config produces a signed `.dmg` (macOS) and `.exe`/`.msi` via NSIS (Windows) — the direct answer to "Mac and Windows support" without two build pipelines. |
| CI/Release | GitHub Actions, `macos-latest` + `windows-latest` matrix, `electron-builder`'s GH Actions integration | Tag a release, get both installers published to the repo's Releases page automatically. |

Packaging notes worth knowing going in, not discovering later: an unsigned `.dmg` triggers Gatekeeper friction on first launch, an unsigned `.exe` triggers SmartScreen — both fine to defer for a personal tool, both fixable later with an Apple Developer cert and a Windows code-signing cert respectively if you ever want to hand this to someone else. `node-pty` needs native compilation per platform/Electron version — `electron-rebuild` (or `@electron/rebuild`) handles that as part of the build step, and it's the one dependency in this stack that occasionally needs attention across Electron version bumps.

### 9.3 App repo layout

```
plexus/                              # github.com/ray-hughes/plexus
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts
│   │   ├── bridge/                   # ported from harness-bridge/lib.js
│   │   │   ├── tasks.ts
│   │   │   ├── chat.ts
│   │   │   ├── consensus.ts
│   │   │   ├── scoreboard.ts
│   │   │   └── dispatch.ts
│   │   ├── mcp-server.ts             # exposes bridge over stdio, for claude/copilot
│   │   ├── pty.ts                    # node-pty session management (Claude/Copilot panes)
│   │   └── ipc.ts                    # exposes bridge over IPC, for the renderer
│   ├── preload/
│   │   └── index.ts                  # contextBridge — safely exposes ipc.ts to the renderer
│   └── renderer/                     # React UI
│       ├── panes/
│       │   ├── ClaudePane.tsx        # xterm.js instance wired to a claude pty
│       │   ├── CopilotPane.tsx       # xterm.js instance wired to a copilot pty
│       │   └── ChatPane.tsx          # replaces the coordinator's terminal loop with a real chat UI
│       ├── views/
│       │   ├── TaskBoard.tsx         # Tier 4 as an actual board, not a directory of JSON files
│       │   └── Scoreboard.tsx        # Tier 6's tallies as a dashboard
│       └── App.tsx
├── electron-builder.yml
├── .github/workflows/release.yml
├── package.json
└── tsconfig.json
```

The three-pane tmux layout from §2 becomes three panels in one window: Claude and Copilot as real embedded terminals (identical experience to running them standalone — `node-pty` doesn't reimplement their UI, it just hosts it), and the chat pane becomes an actual chat view instead of a terminal running `harness-coordinator/index.js`'s readline loop — same underlying logic from §5, real UI instead of a scrollback buffer. The Task Board and Scoreboard, which existed only as JSON files and `list_tasks`/`get_scoreboard` tool calls before, get real views for the first time.

---

## 10. Build order — all six tiers, in order

1. **Tier 1** — shared log + one instruction line in each tool's config.
2. **Tier 2** — file-based job mailbox (`.harness/jobs/`) and a watcher script; this becomes the async backbone `dispatch` uses.
3. **Tier 3** — `harness-bridge` with `dispatch` and `get_activity`. Register in both `.mcp.json` files with `--agent=`. Test both directions.
4. **Tier 4** — task tools (`create_task`, `assign_task`, `update_task`, `list_tasks`, `get_task`) and `.harness/tasks/`. Each agent's instructions file should reference logging significant work as a task.
5. **Tier 5** — `harness-coordinator` in Pane 3: `chat.log`, the `@mention` router, `post_chat` on the bridge so the interactive panes can speak into the room directly too.
6. **Tier 6** — `submit_proposal` / `submit_review` / `get_scoreboard`, the review-variant headless invocation, and the escalation paths into `assign_task(..., "human")`. Wire the coordinator's dispatch results through `submitProposal` instead of straight to `done`.
7. **Scaffold `plexus`** (§9) — Electron + React + TypeScript shell, `ray-hughes/plexus` on the personal SSH identity, `node-pty` + `xterm.js` panes wired to `claude` and `copilot`. At this point the app is a tmux replacement and nothing more — the bridge logic from steps 1–6 is ported in wholesale, not redesigned.
8. **Wire the bridge in two directions** — stdio MCP server for the CLIs (identical role to §4.3, just launched by the app instead of by hand) and Electron IPC for the new Task Board and Scoreboard views.
9. **Package and ship** — `electron-builder` config for both platforms, GitHub Actions release matrix, first tagged release to `ray-hughes/plexus`.

By the end of step 6 the design is complete as a terminal-based tool; steps 7–9 are purely about giving it a real shell. Either stopping point is a working version of two independent agents that share awareness, hand each other bounded work, track it as real tasks assignable to either of them or to you, meet you in one room to do it, and can't call anything finished without the other one signing off — with a running record of how good that sign-off has actually been.
