// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MEETINGS, MEETING_DETAILS, type MeetingDetail, type MeetingSummary } from '../src/client/demo-data.ts'
import { MeetingDetailPage } from '../src/client/MeetingDetailPage.tsx'
import { MeetingPanelIcon, type MeetingPanelIconProps } from '../src/client/MeetingPanelIcon.tsx'
import { MeetingRoomPanel, type MeetingRoomPanelProps } from '../src/client/MeetingRoomPanel.tsx'
import { zh } from '../src/client/locales.ts'
import { createMeetingStore, type MeetingViewState } from '../src/client/meeting-store.ts'

afterEach(() => {
  cleanup()
})

/** Props of one panel render, with the records the pages read. */
function bench(options: {
  meetings?: readonly MeetingSummary[]
  details?: Readonly<Record<string, MeetingDetail>>
} = {}) {
  const instance = createMeetingStore().create()
  const subscribe = (listener: () => void) => instance.subscribe(listener)
  const useStore = <S,>(selector: (state: MeetingViewState) => S): S =>
    useSyncExternalStore(subscribe, () => selector(instance.getSnapshot()))
  const props = {
    useStore,
    actions: instance.actions,
    meetings: options.meetings ?? MEETINGS,
    details: options.details ?? MEETING_DETAILS,
    t: makeTranslate(zh),
  } as MeetingRoomPanelProps
  return { props, instance }
}

describe('meeting room pages', () => {
  it('lists every meeting with its status, rounds and plan', () => {
    const { props } = bench()
    render(<MeetingRoomPanel {...props} />)

    expect(screen.getByRole('heading', { name: zh['list.title'] })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(MEETINGS.length)
    const rows = within(screen.getByRole('list'))
    expect(rows.getByText('会议室 v1 方案评审')).toBeTruthy()
    expect(rows.getAllByText('会议室产品').length).toBeGreaterThan(0)
    expect(rows.getByText(zh['status.running'])).toBeTruthy()
    expect(rows.getAllByText('2/3').length).toBeGreaterThan(0)
    expect(rows.getByText(zh['list.updated.minutes'].replace('{count}', '12'))).toBeTruthy()
    expect(rows.getByText(`v0.2 ${zh['detail.plan.draft']}`)).toBeTruthy()
  })

  it('keeps the filter and the search query in the rows', () => {
    const { props } = bench()
    render(<MeetingRoomPanel {...props} />)

    fireEvent.click(screen.getByRole('tab', { name: zh['list.filter.running'] }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('会议室 v1 方案评审')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: zh['list.filter.awaiting'] }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('任务验收流程设计')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: zh['list.filter.completed'] }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('产物与证据规范')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: zh['list.filter.all'] }))
    const search = screen.getByPlaceholderText(zh['list.search'])
    fireEvent.change(search, { target: { value: '平台能力' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    fireEvent.change(search, { target: { value: '不存在' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(zh['list.empty.filtered'])).toBeTruthy()
  })

  it('offers the empty state when no meeting exists yet', () => {
    const { props } = bench({ meetings: [] })
    render(<MeetingRoomPanel {...props} />)

    expect(screen.getByText(zh['list.empty.title'])).toBeTruthy()
    expect(screen.getByText(zh['list.empty.hint'])).toBeTruthy()
  })

  it('shows the meeting of the opened row, with hidden first-round drafts', () => {
    const { props } = bench()
    render(<MeetingRoomPanel {...props} />)

    fireEvent.click(screen.getByText('会议室 v1 方案评审'))

    expect(screen.getByRole('heading', { name: '会议室 v1 方案评审' })).toBeTruthy()
    expect(screen.getByText(`${zh['detail.round'].replace('{index}', '1')} · ${zh['detail.stage.independent']}`)).toBeTruthy()
    expect(screen.getAllByText(zh['detail.masked']).length).toBe(2)
    expect(screen.getByText('针对：架构师 · 第 1 轮')).toBeTruthy()
    expect(screen.getByText(zh['detail.objections'])).toBeTruthy()
    expect(screen.getByText('会议室-v1-方案.pdf')).toBeTruthy()
  })

  it('returns to the list from the detail page', () => {
    const { props } = bench()
    render(<MeetingRoomPanel {...props} />)

    fireEvent.click(screen.getByText('会议室 v1 方案评审'))
    fireEvent.click(screen.getByRole('button', { name: zh['detail.back'] }))

    expect(screen.getAllByRole('listitem')).toHaveLength(MEETINGS.length)
  })

  it('shows the summary alone for a meeting without a full record', () => {
    const { props } = bench()
    render(<MeetingRoomPanel {...props} />)

    fireEvent.click(screen.getByText('Agent 权限模型'))

    expect(screen.getByRole('heading', { name: 'Agent 权限模型' })).toBeTruthy()
    expect(screen.queryByText(zh['detail.objections'])).toBeNull()
  })

  it('shows an empty detail page for a meeting that no longer exists', () => {
    const { props } = bench()
    render(<MeetingDetailPage {...props} meetingId="gone" />)

    expect(screen.getByRole('heading', { name: '' })).toBeTruthy()
    expect(screen.queryByText(zh['detail.objections'])).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('draws the sidebar glyph at the requested size', () => {
    const iconProps = { size: 16, active: false } as MeetingPanelIconProps
    const { container } = render(<MeetingPanelIcon {...iconProps} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
  })
})
