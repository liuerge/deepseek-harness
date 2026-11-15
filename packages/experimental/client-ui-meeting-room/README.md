---
description: "Meeting list and meeting detail pages for the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-meeting-room

English | [中文](README.zh.md)

## Summary

This package adds the meeting pages to the Web client: a sidebar entry opens the meeting list, and a row opens one meeting's detail page. Both pages show sample meetings that ship with the package, so the layout, the stage bar and the governance rules are visible before real meetings exist. The list filters by meeting state and searches titles and projects; the detail page shows the stage bar, the rounds, the side cards, the objection ledger and the artifacts. All copy lives in a typed locale dictionary with eight shipped languages. This package adds no model-facing input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The sidebar shows a **Meetings** entry with a people glyph. Selecting it opens the meeting list in the main panel; the same entry stays selected while the list shows the detail page of one meeting.

The list page shows the title **Meetings** and a primary **New meeting** button, a segmented filter with **All**, **In progress**, **Awaiting my review** and **Completed**, and a search field. Every row shows the meeting title with its project, the meeting state as a colored dot with its label, up to three member avatars followed by a count of the rest, the round progress as `done/total`, the time since the last update, and the current plan version with its review state. A meeting that matches neither the filter nor the search query leaves the list empty and says so; a profile without any meeting shows the empty state that points at the main assistant.

The detail page shows the meeting title, its state, a **Pause** and an **Add round** button, and a five-step stage bar: independent first round, discussion, synthesis, independent final review and published. The rounds appear as a timeline; a speech names its role, its model and its time, and a discussion speech quotes the round and role it answers. A first-round draft of another role stays hidden behind a striped placeholder that names the publication rule, because the first round is independent until the final review. The side column holds the controls with the call budget, the read-only materials, the plan versions with the review state, and the members with their permissions. Below the rounds, the objection ledger lists each claim with its author, verdict and basis, and the artifacts list the delivered files with an **Accept** action.

The pages read the records their registrant injects. This package ships six sample meetings with three full records, in the language of the reader's interface for the chrome and in the sample language of the records themselves.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export registers its locale dictionary and two slots through Cordis effects; it mounts no Remote namespace. The main slot is keyed by the panel id `meeting-room`, and the `sidebar.panellist` list carries the same id, so the sidebar row and the panel occupant share one identity. Disposing the plugin fiber removes both registrations and the dictionary.

The panel keeps its viewing state in a declared store: the open meeting, the list filter and the search query. Components read the state through the framework's selector hook and write through the declared actions. The panel renders the list page while no meeting is open, and the detail page of the open meeting otherwise.

Copy lives in one typed dictionary; the sample records live in a separate module and stay in their own language. The registration injects the records, so a later Host source replaces them without touching the pages.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Dictionary, main panel and sidebar entry registrations |
| [`src/client/MeetingRoomPanel.tsx`](src/client/MeetingRoomPanel.tsx) | Chooses the list page or the detail page |
| [`src/client/MeetingListPage.tsx`](src/client/MeetingListPage.tsx) | Filter, search and the meeting rows |
| [`src/client/MeetingDetailPage.tsx`](src/client/MeetingDetailPage.tsx) | Stage bar, round timeline, side cards, ledger and artifacts |
| [`src/client/meeting-store.ts`](src/client/meeting-store.ts) | Viewing state of the panel |
| [`src/client/meeting-format.ts`](src/client/meeting-format.ts) | Status, stage, permission and relative-time helpers |
| [`src/client/demo-data.ts`](src/client/demo-data.ts) | Sample meetings and their full records |
| [`src/client/locales.ts`](src/client/locales.ts) | Page copy in eight languages |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Meeting room host plugin](../meeting-room/README.md) — the meeting service, the `meeting_start` tool and the SQLite index.
- [Product design](../../../docs/meeting-room/02-产品设计与交互.md) — the information architecture these pages follow.
- [UI specification](../../../docs/meeting-room/08-UI出图需求.md) — the layout, colors and sample content of both pages.

-----

<a id="model-experience"></a>
## Model Experience

None, as these pages render records their registrant injects and add no model-facing input.

#### KV Cache effect

No direct effect; the meeting service and the `meeting_start` tool own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Sample records only** — the pages read the sample meetings shipped with the package; no Host source feeds them yet.
- **Read-only pages** — the filter, the search and the buttons change local view state only; creating a meeting, pausing one or accepting an artifact belongs to the Host service.
- **No product navigation** — the sidebar entry opens one panel; the product's own navigation belongs to the meeting room shell described in the product design.
