/** Team planning defaults as a conversation-scoped composer control. */
import { useEffect, useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectTeam } from '@deepseek-ai/dsh-meeting-room/types'
import { Button, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-agent-team/client'
import type { TeamPickerState } from './team-picker.ts'
import type { NS } from './locales.ts'
import css from './TeamPicker.module.css'

/** Conversation-bound reads and explicit preference actions. */
export interface TeamPickerInjected {
  hooks: { teamPicker: HostObservable<TeamPickerState> }
  load: () => Promise<void>
  open: () => void
  close: () => void
  choose: (team: ProjectTeam | null) => Promise<void>
  configure: () => void
}

type LabelProps = PropsRuntime<'conversation.hero.agentPreset.suffix'>
  & PropsLocale<typeof NS> & InjectFace<TeamPickerInjected>
type OptionProps = PropsRuntime<'conversation.hero.agentPreset.options'>
  & PropsLocale<typeof NS> & InjectFace<TeamPickerInjected>

/**
 * Open a conversation-specific picker; an unbound new conversation first needs a workspace.
 * @param props - Parent menu dismissal, exact conversation, live selection and localized actions.
 * @returns One component-owned menu row with the current team reflected.
 */
export function TeamPickerOption({ sessionId, useSessions, open, closeMenu, t }: OptionProps) {
  const child = useSessions(value => sessionId !== undefined && value.byId[sessionId]?.origin === 'subagent')
  if (child) return null
  return <MenuItemButton separatorBefore disabled={sessionId === undefined}
    disabledReason={sessionId === undefined ? t('team-mode.workspace') : undefined}
    onSelect={() => { closeMenu(); open() }}>
    <span className={css.option}>
      <span className={css.optionName}>{t('team-mode.title')}</span>
      <span className={css.optionDesc}>{t('team-mode.optionDescription')}</span>
    </span>
  </MenuItemButton>
}

/**
 * Show the captured team as the composer's own control and retain its picker outside the menu lifetime.
 * @param props - Framework-bound preference source and conversation projection.
 * @returns Selected-team trigger and body-portaled picker, or nothing before a conversation exists.
 */
export function TeamPickerLabel(props: LabelProps) {
  const child = props.useSessions(value => props.sessionId !== undefined && value.byId[props.sessionId]?.origin === 'subagent')
  if (props.sessionId === undefined || child) return null
  return <BoundTeamPicker {...props} useTeamPicker={props.useTeamPicker} />
}

/**
 * Keep team defaults accessible after the first turn, using the same conversation-owned picker.
 * @param props - Header conversation and preference source.
 * @returns Team action for an established main conversation.
 */
export function TeamPickerHeader(props: PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS> & InjectFace<TeamPickerInjected>) {
  const hidden = props.useSessions((value) => {
    const summary = value.byId[props.sessionId]
    return summary === undefined || summary.blank || summary.origin === 'subagent'
  })
  if (hidden) return null
  return <BoundTeamPicker {...props} header />
}

function BoundTeamPicker({ useTeamPicker, useProjection, load, open, close, choose, configure, t, header = false }:
  LabelProps & { header?: boolean }) {
  const state = useTeamPicker(value => value)
  const enabled = useProjection('agentTeam')?.enabled === true
  const [pending, setPending] = useState<ProjectTeam | null | undefined>(undefined)
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (state.open) setPending(state.selection.team)
  }, [state.open, state.selection.team])
  const current = state.selection.team
  const selected = pending === undefined ? current : pending
  const triggerLabel = current
    ? `${t('team-mode.selected', { name: current.name })}${!enabled ? ` · ${t('team-mode.board-off')}` : ''}`
    : t('team-mode.title')
  return <>
    {header
      ? <Button onClick={open} aria-expanded={state.open}>{triggerLabel}<IconChevronDownOutlineRegular size={14} /></Button>
      : current && <Button className={css.trigger} onClick={open} aria-expanded={state.open} title={triggerLabel}>
        {triggerLabel}<IconChevronDownOutlineRegular size={14} />
      </Button>}
    <Modal open={state.open} title={t('team-mode.title')} closeLabel={t('roster.cancel')} onClose={close}
      description={t('team-mode.hint')} footer={<div className={css.actions}>
        <Button icon={<IconRefreshOutlineRegular size={16} />} aria-label={t('project.refresh')}
          disabled={state.loading || state.saving} onClick={() => { void load() }} />
        <Button variant="primary" disabled={state.loading || state.saving || state.failed}
          onClick={() => { void choose(selected ?? null) }}>
          {selected ? t('team-mode.use', { name: selected.name }) : t('team-mode.clear')}
        </Button>
      </div>}>
      {state.loading && <p role="status">{t('project.loading')}</p>}
      {state.failed && <p role="alert">{t('team-mode.failed')}{state.failure && ` (${state.failure})`}</p>}
      {state.boardFailed && <p role="alert">{t('team-mode.board-failed')}</p>}
      {!state.loading && state.teams.length === 0 && <p>{t('roster.no-teams')}</p>}
      <div className={css.configure}>
        <Button disabled={state.saving} onClick={configure}>{t('team-mode.configure')}</Button>
      </div>
      <div role="radiogroup" aria-label={t('team-mode.title')} className={css.teams}>
        {state.teams.map(team => <button key={team.id} type="button" role="radio"
          aria-checked={selected?.id === team.id} className={css.teamRow} onClick={() => { setPending(team) }}>
          <span className={css.check}>{selected?.id === team.id && <IconCheckOutlineRegular size={14} />}</span>
          <span className={css.teamBody}>
            <strong>{team.name}</strong>
            <span className={css.members}>{t('roster.members')} · {team.memberIds.map(id =>
              state.employees.find(item => item.id === id)?.name ?? id).join(' · ')}</span>
          </span>
        </button>)}
        <button type="button" role="radio" aria-checked={selected === null} className={css.teamRow}
          onClick={() => { setPending(null) }}>
          <span className={css.check}>{selected === null && <IconCheckOutlineRegular size={14} />}</span>
          <span className={css.teamBody}>
            <strong>{t('team-mode.no-team')}</strong>
            <span className={css.members}>{t('team-mode.no-team-hint')}</span>
          </span>
        </button>
      </div>
    </Modal>
  </>
}
