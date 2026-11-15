/** Viewing state of the meeting pages: the open meeting, the list filter and the search query. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { PropsStore } from '@deepseek-ai/dsh-client-ui-slots'

/** Filter applied to the meeting rows. */
export type MeetingFilter = 'all' | 'running' | 'awaiting' | 'completed'

/** State the meeting pages keep while the panel stays mounted. */
export interface MeetingViewState {
  /** Meeting whose detail page is open, absent while the list page shows. */
  selectedId: string | undefined
  /** Filter applied to the rows. */
  filter: MeetingFilter
  /** Search query typed into the list page. */
  query: string
}

const actions = {
  /** Open one meeting's detail page. */
  open: (state: MeetingViewState, id: string): void => { state.selectedId = id },
  /** Return to the list page. */
  close: (state: MeetingViewState): void => { state.selectedId = undefined },
  /** Apply one filter to the rows. */
  setFilter: (state: MeetingViewState, filter: MeetingFilter): void => { state.filter = filter },
  /** Keep the search query the user typed. */
  setQuery: (state: MeetingViewState, query: string): void => { state.query = query },
}

/**
 * Declare the viewing state of the meeting pages.
 * @returns the store handle the framework binds to the panel entry.
 */
export function createMeetingStore(): EngineStoreHandle<MeetingViewState, typeof actions> {
  return defineStore({
    init: (): MeetingViewState => ({ selectedId: undefined, filter: 'all', query: '' }),
    actions,
  })
}

/** Framework-bound selectors and actions; components never receive the store itself. */
export type MeetingStoreProps = PropsStore<ReturnType<typeof createMeetingStore>>
