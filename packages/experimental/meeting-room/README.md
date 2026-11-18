---
description: "Main-conversation meetings with isolated participant Sessions and retained conclusions."
kind: "package-reference"
---

# @deepseek-ai/dsh-meeting-room

English | [中文](README.zh.md)

## Summary

Run independent meeting participants from a main conversation and inspect their existing subagent Sessions. Retain participant opinions separately from versioned main-assistant conclusions; conclusions do not confirm plans or schedule tasks. Save reusable teams and sourced project plans, then execute confirmed versions with per-node acceptance and checkpoint-based continuation. When Agent Teams is enabled, admitted plan tasks are mirrored to its shared task board while project acceptance remains the release authority. The authenticated dashboard reads actual records and refreshes saved plans, confirmations and execution checkpoints.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with a subagent provider and the route the meeting Session and its children use:

```yaml
- id: meeting-room
  name: '@deepseek-ai/dsh-meeting-room'
  config:
    provider: spawn
    agentOptions:
      provider: deepseek
      model: deepseek-chat
```

Call `ctx.meetingRoom.startMeeting(request, signal?, caller?)` from your own orchestration or tool. The request carries the shared `requirement` and the roles to run; each role supplies a `name` and a `brief`.

A role may select a saved `employeeId` from `employee_list` to use that employee's provider, model, responsibilities and optional preset independently of the main assistant. All employee references are resolved before any participant starts; a missing reference rejects the meeting. The captured employee configuration appears in the child's logged input, and model requests record the route actually used. Roles without an employee reference retain inherited routing. Configure model connections and credentials through the existing DSH providers, including `llm-pi-ai`; employee records contain no API keys. The plugin's `provider: spawn` selects the subagent execution provider, not the model vendor.

- The returned meetingId identifies the process; sessionId identifies the initiating main conversation or owned standalone root whose catalog contains its participants.
- Each returned round carries the role name, the child Session id, and the final assistant text.
- `signal` cancels child startup and remaining work; completed rounds stay in their logs.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Registered subagent provider used for every role round. |
| `agentOptions` | unset | Model route for standalone meetings and unassigned project workers. Tool-driven participants without employee references inherit their main agent route. |
| `acceptanceMaxBytes` | `4194304` | Maximum bytes per UTF-8 acceptance artifact. |
| `modelCatalogTimeoutMs` | `10000` | Per-connection employee model-catalog discovery deadline in milliseconds. |

### Versioned project plans

Plans, designs and deliverables are real files in the selected Git project directory. Before `project_plan_save`, write the complete UTF-8 plan with the existing file tools and pass `documentPath`. The saved index captures its canonical path, project directory and decoded-content SHA-256. Confirmation, execution and continuation reject missing or changed documents and different project directories. Legacy plans remain readable; associate a real document through a new revision before confirmation or execution. Inline execution also requires a Git project directory. The Host does not initialize repositories, write plan documents, commit or push.

Use `project_plan_save` to create or edit a draft containing a goal, team, ordered employee assignments, acceptance criteria and sourced background. Creation uses revision zero; edits specify the current id and revision. Each content revision captures team membership and employee settings and remains queryable through `project_plan_list`. Editing retains earlier generations and requires confirmation of the new revision.

The workspace exposes user confirmation through its Remote action. The model tools save and read drafts. Run a confirmed latest revision with `project_execute({ planId, planRevision })`, omitting inline goal, tasks and team. The workers receive the saved source content, reference identifiers and captured employee settings in their logged prompts. Later roster edits affect later drafts. Each confirmed revision admits one execution. Repeated starts and stale or unconfirmed versions fail before child startup. An interrupted execution requires inspection and a new reviewed revision before retrying; automatic resume remains pending.

Inline execution with a goal and tasks remains available for existing callers. Plan confirmation checks apply to executions that select a saved plan. New runs capture the executing caller's working directory; continuation keeps that directory. Task dependency scheduling remains pending. The workspace shows the latest plan generation; the plan tool returns retained generations. Host queries currently read all retained plan records.

Tasks may include `review` with independent team reviewers, criteria, methods, pass conditions, evidence, explicit `artifactPaths`, downstream inputs and `automatic` or `human` release. UTF-8 artifacts must be bounded regular files inside the captured execution directory; `acceptanceMaxBytes` defaults to 4 MiB per file. Each reviewer must use the `read` tool on every artifact and submit each criterion once through structured output. The structured-result schema restricts criterion IDs and evidence paths to the confirmed criteria and observed canonical artifacts. Missing evidence becomes unverifiable; diagnostics identify missing reads or invalid references and retain the reviewer's submitted status and observations. Host-observed decoded-text SHA-256 values and canonical paths bind reports to files; version checks run after review, before human release and before downstream work. Automatic gates continue after all reviewers pass. Human gates wait for workspace release, then `project_execute({ projectId, expectedCheckpoint })` continues from the next task in the original directory. The checkpoint is claimed once. Changed plans or files reject release or continuation. Legacy nodes without explicit paths retain `awaiting-acceptance`; plans without `review` retain final manual review.

Failed acceptance retains its report and blocks downstream work. A confirmed `review.rework.maxAttempts` authorizes a positive bounded number of repair executions for that task; omission disables repair. The original main conversation calls `project_execute({ projectId, expectedCheckpoint })` on the exact latest `acceptance-blocked` checkpoint. An atomic `reworking` claim links the attempt to its failed checkpoint before tools start. The assigned employee receives the failed report and unchanged requirements, uses the original directory and undergoes fresh independent review. Earlier reports remain readable, and human gates still require workspace release. Failed or interrupted attempts consume the limit; other failed or interrupted execution states cannot resume this way and require inspection. New plan revisions invalidate old repair claims. The workspace prepares repair drafts and displays the confirmed limit and consumed attempts; it does not automatically send drafts.

Before dispatching each next task, execution checks for pending user input in the main conversation. It records `awaiting-direction` and returns control without interrupting the active employee round or dropping the queued message. After processing that input, the original main conversation may claim the exact checkpoint to continue the unchanged confirmed plan; changed requirements require a revised, confirmed plan. The checkpoint index identifies the next unstarted task, so continuation does not repeat completed work. Inline executions stop as `interrupted`, without offering checkpoint continuation; inspect existing work and save a confirmed plan for the remaining tasks. Input still queued at continuation rejects with `PROJECT_DIRECTION_PENDING` without advancing checkpoints.

### Reusable employees and teams

The authenticated `projectRoster` service exposes registered connection catalogs and version-checked employee/team saves for the workspace editor. Saving an employee requires a registered provider route; its model id may be absent from the advisory catalog. A connection's registration does not verify credentials. Model-catalog discovery has a per-route deadline and settles on cancellation or plugin disposal; failures are explicit per route. The provider still owns any underlying catalog request that its adapter cannot cancel. Saving roster configuration neither confirms a plan nor starts model work, and confirmed plans retain their captured employee configurations.

`employee_list` returns the Host's saved employees and team templates. `employee_save` saves a name, responsibilities, explicit provider/model and optional registered DSH `preset`. `team_save` saves a team of distinct existing employee ids. Creation omits the id and uses `expectedRevision: 0`; updates use the current id and revision. A stale save fails with `PROJECT_ROSTER_STALE`. The file database preserves these records across restart and upgrades the existing project database to schema version 6 while retaining history.

Pass `employeeId` on a project task to use that employee's model, instructions and optional preset. An omitted preset uses the caller composition. Pass `teamId` to require every task's employee to belong to that saved team. Admission resolves all task references before execution and checkpoints the employee and team revisions. Later roster edits affect later runs. Existing tasks without employee ids keep their previous behavior.

The roster tools and the dashboard catalog operate across this Host. Model routes and presets must be available in the running composition; the subagent runtime reports unavailable configurations when it starts work. Employee configuration is not a tool permission policy. Presets and the existing tool approval system own effective capabilities. Deletion, employee activity projections and per-skill editing remain pending.

### Project execution

The authenticated `projectTeamContext` service captures a main conversation's planning defaults through `select`, using the displayed selection, team and employee revisions; `current` reads the saved snapshot. Selection is stored in the project database and does not dispatch work, enable the shared board, grant tool permissions or confirm plans. Later roster edits leave the captured snapshot unchanged. An explicit null team clears the default with a new revision. Descendants cannot change their parent's selection.

The required `systemPrompt` service materializes these defaults into the main assistant's logged runtime context. Employees receive their own task assignments rather than this root-only context. A clear produces an explicit no-default context, superseding earlier choices. Only context actually sent to a model enters the Session log; the business database owns the current planning preference. The client entry is documented in the [workspace UI](../client-ui-meeting-room/README.md).

`project_execute` takes a goal and ordered tasks containing `role`, `instruction` and `acceptance`. Workers use the caller's working directory and tool composition through the configured subagent provider. Every task receives the previous worker's handoff and the shared goal. Execution returns `awaiting-review`; the caller checks artifacts before accepting delivery. A non-completed child result stops subsequent tasks with a typed error.

`project_records` reads recent checkpoints for the calling Session, newest first, with an explicit positive `limit`. Configure `databasePath` to a file for persistence across restarts. The index stores the plan, task status, child Session references, handoffs and the selected employee/team revisions. Child Session logs retain tool calls and prompts. A running checkpoint after process interruption requires inspection before retrying. Continuation and repair retain the original execution identity.

Tasks execute sequentially within a call. Separate calls share their caller's workspace and require coordination. Cancellation stops remaining tasks and disposes the current child; file and external tool effects may already exist. Automatic restart, project-wide pause and full knowledge retrieval are pending. Queries are count-bounded; handoff size follows worker output limits.

### Team shared tasks

When the initiating root has Agent Teams enabled, admitting a confirmed plan creates one shared task per plan task before any worker starts. Tasks carry the employee, instruction, acceptance text and a stable marker; each task depends on the preceding one, so an unreleased node keeps downstream work blocked. The project database stores the association and latest observed revision. The dispatched worker Session claims its task through the Team service; project acceptance remains the release authority.

Automatic release completes the task after the project records `acceptance-passed`. Human release stays `in_progress` until the release is synchronized during the next accepted continuation. Failed acceptance, repair, blocking and interruption keep the task `in_progress` with its worker, and the project checkpoint records the real reason. Repeated admission reuses a durably admitted run and adopts marker-matched tasks instead of creating duplicates.

Linked workers reserve their child Session identity and wait at `agent/pre-step` until the Team claim succeeds; no model request or tool execution precedes the claim. Providers without reserved-child support fail with `PROJECT_TEAM_GATE_UNAVAILABLE`. Manual board edits, releases, reassignments and externally completed tasks are checked against retained revisions and owners rather than adopted as project actions. Partial-link retries preserve prior association revisions. Concurrent admissions are serialized within this Host instance, and unload waits for linking, release synchronization and worker cleanup before closing storage. Cross-process exclusion and crash recovery are not provided. Workspace human release checks artifacts; Team conflicts are checked by subsequent execution before downstream dispatch.

Team mode off at admission records `teamLink: disabled` and runs project-only; a missing Team service records `unavailable`. Turning Team mode off after linking stops the next dispatch or continuation with `PROJECT_TEAM_DISABLED`; re-enable it and inspect the board before continuing. Deleted, completed-ahead or missing Team tasks stop the run for inspection. Existing unlinked executions are not retroactively linked. The optional integration lives in `src/team-link.ts`; `src/store.ts` owns the association table.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

startMeeting(request, signal, caller) uses the supplied main agent as the participants’ parent. Without caller it owns a new root. Role children use delivery caller and isolated goal/role prompts. Partial or non-completed outputs stop remaining roles. Cancellation and plugin unload dispose active participants and join execution before storage closes.

`rolePrompt` emits the shared goal, role name, role brief and optional captured employee configuration. It includes no sibling inputs or outputs. Discussion rounds that need earlier drafts must explicitly include them.

SQLite schema version 5 retains meeting associations, participant outputs, immutable conclusion revisions and Team task associations. Existing meetings and rounds remain stored; unlinked historical rows are not assigned to a conversation. A failed final checkpoint reports unknown saved state and requires inspection before retrying.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent runtime](../../subagent/subagent/README.md) — providers, activations, and child catalogues.
- [Session](../../core/session/README.md) — session headers, events, and persistence.

## Model Experience

### meeting_start tool

#### What the model sees

The model supplies a goal and role briefs to meeting_start and receives JSON with process and conversation identities plus participant outputs. meeting_records returns retained conclusion revisions. meeting_record_decision appends the initiating main assistant conclusion without confirming a plan. Starting participants requires the configured approval capability; absent answerers fail closed.

#### Token effect

The declaration adds a small schema to every request that sees the tool; the result costs one block per role.

#### KV Cache effect

The declaration is stable, so it does not change the prefix per call. Approval adds a user interaction, not model context.

### Role prompt

#### What the model sees

Each role receives one user message: `会议目标：<requirement>`, its own role name, brief and optional captured employee configuration. No sibling prompt or draft appears in that request, because the spawn child starts from an empty Session.

#### Token effect

One request per role, sized by the goal, brief and optional employee configuration; the role prompt adds no tool declarations or system-prompt section.

#### KV Cache effect

Each child Session starts empty, so roles share no cacheable prefix and every first round pays full prompt cost. A discussion round that must read earlier drafts would extend this text and change that accounting.

### Project tools

#### What the model sees

Execution exposes the goal, ordered instructions and acceptance criteria, returning a project id, review state, Team link state and final handoff. Record queries return caller-owned checkpoints. Roster queries return Host-wide employee and team records. Employee responsibilities and the selected revision enter the worker prompt. Saved-plan execution also includes its exact background content and source references. Worker prompts contain the goal, task and previous handoff. Reviewers also receive the confirmed criteria, author handoff and observed artifact versions, with a child-scoped structured-output tool. Continued workers receive released reports in their logged prompts.

#### Token effect

The two project schemas, three roster schemas and two plan schemas add fixed context. Worker requests include task and handoff text; queries add requested checkpoints. Each independent reviewer adds one child conversation and its structured-result schema; released reports add downstream context.

#### KV Cache effect

Tool results append to caller history. Each worker starts a fresh child Session. Repair workers also receive the failed report and attempt reference in their logged input.

### Selected team context

#### What the model sees

The main assistant receives the captured team and employees as a required runtime-context section, with instructions to collect selected employees’ opinions through `meeting_start`, retain the main assistant’s synthesis through `meeting_record_decision`, and prepare a confirmable plan. User corrections require inspecting actual execution records and revising the plan when necessary. Requested n8n validation belongs in a testing employee assignment using available command tools, with actual execution evidence; unavailable tools or permissions remain explicit blockers. An explicit clear says no default team is selected. Child employees receive no copy of this section. The Session records the actual rendered context through the existing context-snapshot mechanism.

#### Token effect

Selection and clearing add no model requests. The rendered snapshot carries the selected employee configurations; its token size follows their text. An unchanged selection uses the existing runtime-context reuse policy.

#### KV Cache effect

The stable tool declarations and system sections do not change. A changed preference updates the logged runtime-context suffix; previously confirmed plan content remains independent.

## Known Limitations and Deferred Work

- Only independent first rounds exist; discussion rounds, objections, verdicts, and publishing are not implemented.
- Rounds run serially; parallel rounds need explicit working-directory and ownership decisions.
- Further discussion rounds and automatic scheduling from meeting conclusions are not implemented.
- The conversation menu reads actual linked meetings; historical rows without a known initiating conversation remain index-only.
- Team mirroring follows plan order only; parallel dependencies, multi-project queues and cross-process recovery remain pending.
- Team ownership or dependency edits made directly on the Team board are not reconciled; a deleted, completed-ahead or missing task stops project execution for inspection.

### Dev Note

MeetingStartRequest and MeetingStartResult describe the direct orchestration API in [the service source](src/index.ts). The store owns plan and meeting business records; Session logs retain complete conversations and tool traces.
