---
description: "Mount the meeting service and the meeting pages in one profile bundle."
kind: "package-reference"
---

# @deepseek-ai/dsh-meeting-room-bundle

English | [中文](README.zh.md)

## Summary

This bundle composes the meeting room product for a profile: the Host meeting service with its `meeting_start` tool and SQLite index, and the meeting pages that list meetings and show one meeting's detail. A profile that lists this bundle mounts both halves, so the sidebar entry and the tool arrive together. The bundle holds no runtime code of its own; its rows live in the patch file. This bundle adds no model-facing input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

List `@deepseek-ai/dsh-meeting-room-bundle` in the profile's `dsh.profile.bundles` array. The profile composer applies the bundle's patch over the empty profile root, which inserts two rows: the Host meeting service and the meeting pages. The pages then register the sidebar entry and the main panel; the service registers the `meeting_start` tool, so a model can start a meeting and the pages can list what it stored.

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
- [Meeting pages](../client-ui-meeting-room/README.md) — the meeting list, the meeting detail page and the sidebar entry.

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
