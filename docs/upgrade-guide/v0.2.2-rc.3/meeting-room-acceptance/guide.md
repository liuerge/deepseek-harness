---
kind: upgrade-guide
description: "Meeting-room custom compositions require filesystem and working-directory services for version-checked acceptance."
---

# Meeting-room acceptance services

English | [中文](guide.zh.md)

## Change

The meeting-room plugin requires `fs` and `workingDirectory` in addition to agents, tools and subagents. Custom compositions missing either service cannot activate it. The shipped Web and headless base compositions provide both services. Saved plans remain readable; a structured acceptance node without explicit artifact paths stops after production and requires a revised confirmed plan for reviewer execution.

The meeting_start tool now returns a JSON object containing meetingId, sessionId and rounds instead of role-formatted text. Tool-driven participants belong to the initiating main conversation. The separate meeting sidebar entry is replaced by its session-header menu. SQLite advances to schema 5, including shared Team task associations; older application versions reject the upgraded database. New plans retain originSessionId; unassociated legacy drafts require an explicit main-conversation handoff.

## Migration

1. Run meeting-room in a profile including `@deepseek-ai/dsh-base`, or mount filesystem and working-directory providers before its entry in your custom composition. See the [filesystem service](../../../../packages/fs/fs/README.md) and [working-directory service](../../../../packages/session/working-directory/README.md).
2. When editing a structured acceptance node through `project_plan_save`, supply `review.artifactPaths` with nonempty UTF-8 file paths inside the execution directory. Confirm the new revision in the project workspace. Existing drafts retain their original content.
3. Execute the confirmed plan. Automatic nodes continue only after all independent reviewers pass. Human nodes show a report and a workspace release action; after confirming, continue using the released project id and exact checkpoint. Changed artifacts require rework and new acceptance.

4. Update meeting_start result readers to parse the JSON fields. Open meetings from the main conversation header More menu; use meeting_records and meeting_record_decision to retain the main assistant conclusion. Unlinked historical meeting rows are retained without guessing their owner.
5. For a legacy plan with no associated execution or main conversation, choose Continue this plan with a main assistant, send the prepared handoff draft and confirm its newly saved revision.
6. Continue or repair an existing execution only from its original main conversation. To authorize bounded repair, save and confirm a plan with `review.rework.maxAttempts` before starting. Claim the exact latest failed-acceptance checkpoint with `project_execute`; absent or exhausted limits require inspection and a revised plan. Existing plans do not gain repair authorization automatically.
7. To run meeting roles on independent model routes, save employees with explicit provider and model fields, then supply their `employeeId` in each selected role. Configure connections and credentials through the existing DSH providers. Roles without employee references retain inherited routing; missing employee references reject the meeting before dispatch.
