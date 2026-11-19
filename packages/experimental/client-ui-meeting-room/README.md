---
description: "Main-conversation meeting records, project progress and acceptance controls for the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meeting-room

English | [中文](README.zh.md)

## Summary

This plugin connects project work and meetings to the main conversation. Project progress remains in the sidebar workspace. The conversation header More menu prepares a meeting request or opens actual meetings initiated by that conversation; there is no separate meeting sidebar entry. Participant opinions and versioned main-assistant conclusions are displayed separately.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Use Ask assistant to arrange a meeting in the main conversation header More menu. It prepares an unsent request in that exact conversation, preserving existing draft text. Meetings in this conversation opens retained discussions, participant conversation links, conclusion revisions and follow-up actions. Recording a conclusion does not confirm a project requirement.

The project workspace opens on a status board: a property row for the goal, plan version, team, confirmation state and current phase, then five columns (to do, in progress, awaiting review, passed, blocked) whose headers carry task counts. A card shows only the employee, status, task role, Team task association, artifact chips and navigation actions; task instructions, acceptance criteria, acceptance reports and handoffs open in a full-width panel below the board. The board can expand into a viewport-sized dialog that keeps the same column layout and open detail. A project with an action waiting on the user shows a separate attention block. Saved employees and teams sit below the board and plan. Plan editing, saved-plan execution, corrections and released execution continuation prepare drafts in the associated main conversation. A legacy plan with no known main conversation offers an explicit handoff draft that asks the assistant to preserve the content and save a newly associated revision for confirmation.

Configure employees directly in the workspace: enter responsibilities, select a registered model connection, enter a model id and optionally name a DSH preset. Each employee has an independent route; custom gateway model ids are supported. Create or edit reusable teams by selecting saved employees. Saves check the displayed revision, retain form input on failure and do not start model work or change confirmed plans. Connection catalogs load independently of project records and do not certify credentials; configure credentials through the existing model-provider settings. Choose Team mode from the tool-preset dropdown, inspect every employee route, and select a saved team for this main conversation. Choose a workspace first if no conversation is bound. The team chip appears beside the preset only after a team is selected; established conversations offer a header action. Selection captures the inspected versions before enabling the shared board, without confirming a plan or starting work. If activation cannot be confirmed, the saved choice remains visible for inspection and retry. Clearing the preference preserves existing tasks and board mode.

Task execution links open the existing subagent conversation using its recorded direct parent and child identities. The existing root subagent catalog also receives a project-task footer from the same checkpoint source. Produced counts remain distinct from acceptance; this footer displays Team task identities and statuses but never changes them.

| Control | Effect |
|---|---|
| Confirm this version | Confirms the exact latest plan revision. |
| Confirm acceptance and release | Rechecks files and releases a passing human-review node. |
| Continue downstream tasks | Prepares an exact-checkpoint continuation draft in the original main conversation. |
| Ask the main assistant to repair | Prepares a failed-checkpoint draft within the confirmed attempt limit. Retains earlier reports and opens the latest task worker. |
| Refresh progress | Reloads the retained project catalog or selected conversation meetings. Plans, confirmations and project checkpoints also refresh automatically after they are saved. |

## Understand the implementation

The conversation header includes Results beside Chat and Trajectory. It lists the real disk document associated with each latest plan revision and the files observed in each task's latest independent-review report. All file rows reuse the standard context menu, including available download and native-open actions. Confirmation checks the exact revision and observed plan-file hash without starting work. Legacy plans lacking a file show a missing-document notice and cannot be confirmed. The list embeds no previews, creates no virtual documents, does not infer files from planned paths or prose, and does not certify that previously observed delivery files remain unchanged. The Host requires a Git project directory; the main assistant writes documents with existing tools, and Git owns commit history.

The plugin mounts the Host projectDashboard, projectRoster and projectTeamContext Remotes and registers panels, a sessionHeader context-menu contribution and the existing subagent footer through reversible effects. Meeting selection aborts the previous query; late results cannot populate another conversation. Disposal aborts and joins outstanding queries. Model work starts only after the user sends a prepared draft or the main assistant calls its tools.

SessionMeetings renders actual Host records. ProjectPage and SessionProjects share one project checkpoint source. The older prototype meeting components remain unmounted and do not supply product data.

## Further Exploration

- [Meeting Host](../meeting-room/README.md) — discussion execution, retained conclusions and project tools.
- [Subagent interface](../../client/ui-subagent/README.md) — existing execution conversations and navigation.
- [Team interface](../../client/ui-agent-team/README.md) — the independent shared-task board.

## Model Experience

### Main-conversation drafts

#### What the model sees

Project drafts carry references such as `projectId` and `expectedCheckpoint`; meeting drafts request `meeting_start` and `meeting_record_decision`. They become ordinary user input only when sent. Reading menus and reports adds no model requests.

#### Token effect

Only sent draft content adds user-input tokens. The Host plugin owns tool declarations and worker prompts.

#### KV Cache effect

Sent drafts append to conversation history. Existing draft text is preserved and followed by the prepared request.

## Known Limitations and Deferred Work

- Meetings require manual refresh. Plan and checkpoint invalidations follow this Host's stream; writes from other processes are not observed.
- Meetings execute independent first rounds sequentially; automatic debate, requirement confirmation and task scheduling from conclusions are not implemented.
- Task links are available only when the execution recorded a direct parent and child address. Historical unlinked meeting rows are retained without guessing an initiating conversation.
- The workspace displays Team task linkage but does not offer direct Team task edits; use the Team board for ownership or dependency changes.
- Main-conversation corrections prepare a revised plan; immediate mid-tool steering and automatic rework remain pending.

### Dev Note

The source registrations own navigation and query lifetime; components receive records and callbacks through typed injection. UI copy belongs to the locale dictionaries.
