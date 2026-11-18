---
kind: upgrade-guide
description: "Meeting-room custom compositions require filesystem, working-directory and system-prompt services."
---

# Meeting-room acceptance services

English | [中文](guide.zh.md)

## Change

The meeting-room plugin requires `fs`, `workingDirectory` and `systemPrompt` in addition to agents, tools and subagents. Custom compositions missing any required service cannot activate it. The shipped Web and headless base compositions provide these services. Saved plans remain readable; a structured acceptance node without explicit artifact paths stops after production and requires a revised confirmed plan for reviewer execution.

The meeting_start tool now returns a JSON object containing meetingId, sessionId and rounds instead of role-formatted text. Tool-driven participants belong to the initiating main conversation. The separate meeting sidebar entry is replaced by its session-header menu. SQLite advances to schema 6, including shared Team task associations and conversation team preferences; older application versions reject the upgraded database. New plans retain originSessionId; unassociated legacy drafts require an explicit main-conversation handoff.

## Migration

Plans now require a real project document. Write it with existing file tools inside the selected Git project, then pass `documentPath` to `project_plan_save`. Confirmation and dispatch recheck its captured path, hash and directory. Legacy plans remain readable but require a file-linked revision before new confirmation or execution. File changes require renewed review; Git owns document history.

1. Run meeting-room in a profile including `@deepseek-ai/dsh-base`, or mount filesystem, working-directory and system-prompt providers before its entry in your custom composition. See the [filesystem service](../../../../packages/fs/fs/README.md), [working-directory service](../../../../packages/session/working-directory/README.md) and [system-prompt service](../../../../packages/core/system-prompt/README.md).
2. Supply `review.artifactPaths` with UTF-8 files inside the execution directory, then confirm the revised plan. Existing drafts retain their content.
3. Automatic nodes require all reviewers to pass. Human nodes require workspace release, then continuation with the exact checkpoint. Changed artifacts require rework and new acceptance.

4. Update meeting_start result readers to parse the JSON fields. Open meetings from the main conversation header More menu; use meeting_records and meeting_record_decision to retain the main assistant conclusion. Unlinked historical meeting rows are retained without guessing their owner.
5. For a legacy plan with no associated execution or main conversation, choose Continue this plan with a main assistant, send the prepared handoff draft and confirm its newly saved revision.
6. Continue or repair an existing execution only from its original main conversation. To authorize bounded repair, save and confirm a plan with `review.rework.maxAttempts` before starting. Claim the exact latest failed-acceptance checkpoint with `project_execute`; absent or exhausted limits require inspection and a revised plan. Existing plans do not gain repair authorization automatically.
7. To run meeting roles on independent model routes, save employees with explicit provider and model fields, then supply their `employeeId` in each selected role. Configure connections and credentials through the existing DSH providers. Roles without employee references retain inherited routing; missing employee references reject the meeting before dispatch.
8. Handle `awaiting-direction` as a dispatch hold for queued main-conversation user input. Process the input first; resume an unchanged confirmed plan from its exact checkpoint, or save and confirm a revised plan. Do not restart already produced tasks or treat this state as acceptance.
