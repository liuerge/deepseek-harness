---
description: "Mount the meeting service and the meeting pages in one profile bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-meeting-room-bundle

English | [中文](README.zh.md)

## Summary

Add meeting and project workflows to a Web profile with their Host service and Client interface together. Start participants from the main conversation, inspect their existing subagent records, and retain opinions separately from assistant conclusions. The project workspace shows actual plans, progress and acceptance. Configure model routes and persistence in the profile patch; this bundle adds no model input itself.

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

Append `@deepseek-ai/dsh-experimental-meeting-room-bundle` to the existing Web profile’s `dsh.profile.bundles` array after its base and Web bundles. It adds the Host meeting service and Client interface. The Client supplies the project workspace and main-conversation meeting menu; the Host supplies tools and retained process records. The base composition provides the required agent, filesystem, Session and subagent services.

The bundle does not configure the service. The service's own configuration (`provider`, `agentOptions` and `databasePath`) belongs to the profile's patch layer, where a later layer replaces the row's configuration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle's substance is its patch file, declared by the `dsh.bundle.patch` manifest field and resolved by the profile composer through that field. The module carries no runtime API.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The two rows the bundle inserts |
| [`src/index.ts`](src/index.ts) | Empty module; the rows live in the patch |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Meeting room host plugin](../meeting-room/README.md) — the meeting service, the `meeting_start` tool and the SQLite index.
- [Meeting pages](../client-ui-meeting-room/README.md) — the project workspace and session-specific meeting menu.

-----

<a id="model-experience"></a>
## Model Experience

None, as this bundle composes plugins and adds no model-facing input.

#### KV Cache effect

No direct effect; the meeting service and the `meeting_start` tool own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No configuration of its own** — the service's provider, model route and database path stay in the profile's patch layer.
- **Two rows, one product** — the bundle mounts both halves; a profile that wants only the pages lists the client package itself.

### Dev Note

The patch owns composition only; the Host and Client package READMEs own process behavior and navigation.
