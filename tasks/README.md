# Tasks

One place for work that is planned, in progress or finished. Agents and the owner both use it.

- `BOARD.md` is the list. One row per task: `T-NNNN`, title, status, next step, evidence.
- `specs/T-NNNN-short-name.md` is optional and only for tasks that need more than one line (scope, steps, risks, acceptance).
- Evidence (screenshots, logs, reports) goes to the ignored `.tmp/qa/T-NNNN/`, never into git. Put the conclusion in the spec or the progress log.

## Statuses

`open` (not started), `doing` (someone is working on it; say who in the next-step column), `blocked` (needs a decision or another task), `done` (merged; write the commit hash), `rejected` (decided against; keep the reason so it is not proposed again).

## Rules for agents

1. Before starting a user request, check `BOARD.md`. If the request matches a task, use its ID; otherwise add a row with the next free ID.
2. Set `doing` when you start and `done` with the short commit hash when the change is committed and checked. Do not mark a task done without the checks listed in `AGENTS.md`.
3. One task per commit where possible; mention the ID in the progress log entry in `docs/postep.md`.
4. A decision the owner has to make is `blocked` with the question in the next-step column. Do not guess.
5. Never put secrets, personal data, recordings or private paths here; the history is public.
