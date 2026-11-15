---
description: "Meeting orchestration over DSH sessions: one root Session per meeting and one spawn subagent per role round, with isolated first rounds."
kind: "package-reference"
---

# @deepseek-ai/dsh-meeting-room

English | [中文](README.zh.md)

## Summary

`dsh-meeting-room` turns a goal and a list of roles into one meeting: a dedicated root Session owns the meeting, and each role answers its first round in that Session's own subagent. A role's first request contains the goal and its own brief only, so no role sees another role's draft. The service returns each round's child Session id and final text; the meeting Session stores one `subagent/catalog` entry per role. It also registers the `meeting_start` tool and asks for approval before that tool runs.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

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

Call `ctx.meetingRoom.startMeeting(request, signal?)` from your own orchestration or tool. The request carries the shared `requirement` and the roles to run; each role supplies a `name` and a `brief`.

- The returned `sessionId` names the meeting root Session; read the meeting from the session log.
- Each returned round carries the role name, the child Session id, and the final assistant text.
- `signal` cancels child startup and remaining work; completed rounds stay in their logs.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `provider` | `spawn` | Registered subagent provider used for every role round. |
| `agentOptions` | unset | Provider and model for the meeting Session and its children; unset follows the composition's route. |

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`startMeeting` creates the meeting Session through `ctx.agents.create`, then runs each role through `ctx.subagents.startActivation` with `delivery: 'caller'` and awaits its result before starting the next role. Each child starts empty because the `spawn` provider declares `inheritsParentContext: false`; the prompt is the only user message it receives.

Isolation is a property of prompt construction, not of filtering existing context: `rolePrompt` emits the shared goal, the role name, and that role's brief. A future discussion round that must read earlier drafts would have to build that text explicitly, which keeps the first round independent by construction.

The service disposes the meeting handle before returning, so the spike-level contract leaves no live agent behind; the Session log remains stored. The meeting Session id is `meeting-<uuid>`; role children are catalogued on the meeting Session with their provider label.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent runtime](../../subagent/subagent/README.md) — providers, activations, and child catalogues.
- [Session](../../core/session/README.md) — session headers, events, and persistence.

## Model Experience

### meeting_start tool

#### What the model sees

`meeting_start` takes the shared goal and the roles, so the model can start a meeting without a client page. The tool result lists each role and its answer. A `tools/pre-execute` listener asks the user first, so no role child starts until the call is approved.

#### Token effect

The declaration adds a small schema to every request that sees the tool; the result costs one block per role.

#### KV Cache effect

The declaration is stable, so it does not change the prefix per call. Approval adds a user interaction, not model context.

### Role prompt

#### What the model sees

Each role receives one user message: `会议目标：<requirement>`, its own role name, and its brief. No sibling prompt or draft appears in that request, because the spawn child starts from an empty Session.

#### Token effect

One request per role, sized by the goal and that role's brief; the package adds no tool declarations and no system-prompt section.

#### KV Cache effect

Each child Session starts empty, so roles share no cacheable prefix and every first round pays full prompt cost. A discussion round that must read earlier drafts would extend this text and change that accounting.

## Known Limitations and Deferred Work

- Only independent first rounds exist; discussion rounds, objections, verdicts, and publishing are not implemented.
- Rounds run serially; parallel rounds need explicit working-directory and ownership decisions.
- The service disposes the meeting Session when it returns, so callers cannot continue a meeting from the returned handle.
- No client page: meetings are not yet visible outside the session log.
