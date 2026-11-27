# Issue tracker: Linear

Issues and specs for Pronto live in Linear: workspace YG Lab (`linear.app/yg-labs`), team **Pronto**, key `PRO`. Use the Linear MCP tools (`mcp__plugin_engineering_linear__*`). Don't use `gh issue`; GitHub Issues aren't used.

## Conventions

- **Check for duplicates first**: `list_issues` with `team: "PRO"` and `query: "<keywords>"`.
- **Create an issue**: `save_issue` with `team: "PRO"`, a `title`, a Markdown `description`, a `project` (one of: Project setup & CI/CD, Dispatcher controls & commands, Customer conversation flow, Fare engine, Booking & notifications, Payment flow, Maps & zone resolution, Testing), and exactly one type label (`Feature`, `Improvement` or `Bug`).
- **Sub-issues**: use `save_issue` with `parentId: "PRO-N"` for small pieces of an existing issue.
- **Read an issue**: `get_issue` with `id: "PRO-N"`, then `list_comments` for the discussion. `get_issue` doesn't include comments.
- **List issues**: `list_issues` with `team: "PRO"`, filtered by `label`, `state`, `project` or `assignee`. Follow `cursor` while `hasNextPage` is true.
- **Comment**: `save_comment` on the issue.
- **Apply / remove labels**: `save_issue` with `addLabels` / `removeLabels`. Never pass `labels`, because it replaces the whole label set.
- **Status**: `save_issue` with `state`. The lifecycle is In Progress (work started) → In Review (PR open) → Done (deployed, staging smoke tests pass). Use Canceled to close without doing the work.
- **Old keys**: `PRT-N` (Jira) maps to `PRO-(N−8)`. `SOL-N` is the same issue as `PRO-N`.
- Put agent-specific detail (file lists, plans, logs) in a collapsible `+++ Agent notes` section at the end of the description.

## When a skill says "publish to the issue tracker"

Create a Linear issue in team PRO, following the conventions above.

## When a skill says "fetch the relevant ticket"

Run `get_issue` plus `list_comments` for the given `PRO-N`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent issue and its **child** issues are the tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions so far / Fog body.
- **Child ticket**: a sub-issue (`parentId` = the map), labelled `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
- **Blocking**: Linear's native relations, via `save_issue` with `blockedBy: ["PRO-N"]`. A ticket is unblocked when all its blockers are Done or Canceled.
- **Frontier query**: `list_issues` with `parentId` = the map and an open state. Drop any ticket that has an open blocker or an assignee. The first in map order wins.
- **Claim**: `save_issue` with `assignee: "me"`. This is the session's first write.
- **Resolve**: comment the answer, set the state to Done, then add a context pointer (the gist plus a link) to the map's Decisions so far.
