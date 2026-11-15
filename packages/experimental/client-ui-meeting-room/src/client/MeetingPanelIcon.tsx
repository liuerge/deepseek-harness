/** Decorative occupant of the meeting sidebar entry. */
import type { ReactElement } from 'react'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Props of the meeting sidebar glyph. */
export type MeetingPanelIconProps = PropsRuntime<'sidebar.panellist'>

/**
 * Render the people glyph at the size the sidebar asks for; the sidebar owns
 * the entry's accessible navigation label.
 * @param props - the sidebar's icon share: the requested edge and whether the panel is selected.
 * @returns decorative people icon.
 */
export function MeetingPanelIcon({ size }: MeetingPanelIconProps): ReactElement {
  return <IconUsersOutlineRegular size={size} />
}
