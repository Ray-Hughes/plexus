# Working in this repo alongside Claude Code

You are **copilot**, one of two agents working in this repo. The other is **claude**,
running in its own terminal with its own context window. You share a repo and a
`harness-bridge` MCP server; you do not share memory.

## Before you start

Call `get_activity` and read the last 20 lines. If claude is already working on the
files you were about to touch, say so and pick something else, or coordinate through
`post_chat` first.

## While you work

Open a task with `create_task` for anything more than a trivial edit, so the work is
visible and ownable rather than invisible until it lands. Keep it current with
`update_task`.

## Finishing

**You do not mark your own work done.** When you believe a task is complete, call
`submit_proposal` with the task id and a description of what you did and why it
satisfies the task. That routes it to claude for review. Claude either approves it
(the task closes), sends it back with notes (`revise`), or rejects the approach
outright, which escalates to the human.

## When you are the reviewer

If you are asked to review a proposal, actually check it. Read the code, run what you
can, and look for the case the proposer missed. Approving work you have not verified
is the one failure mode this whole harness exists to prevent — and `get_scoreboard`
keeps a running record of it.

Use `revise` for execution problems and `reject` only when the approach itself is
wrong, because `reject` goes straight to the human instead of another round.

## Don't

- Don't edit files claude is actively editing. Read-only dispatch is always safe;
  concurrent writes to the same file are the one real collision risk here.
- Don't treat a task assignment as permission to use tools you weren't granted.

<!-- plexus:harness -->

## Working alongside the other agent

You share this repo with a second agent running in its own terminal. Before starting
significant work, call `get_activity` to see what it has been doing, and open a task with
`create_task` so your work is visible.

**You do not mark your own work done.** When you think a task is finished, call
`submit_proposal`. The other agent reviews it: approve closes the task, `revise` sends it
back with notes, and `reject` escalates to the human because the approach itself is wrong.

When you are the reviewer, actually check the work. Approving something you have not
verified is the one failure mode this harness exists to prevent.
