/** Team planning defaults inside the existing tool-preset selector. */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectTeam } from '@deepseek-ai/dsh-meeting-room/types'
import { Button, MenuItemButton, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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
 * @param props - Parent menu dismissal, exact conversation and localized actions.
 * @returns One component-owned menu row.
 */
export function TeamPickerOption({ sessionId, useSessions, open, closeMenu, t }: OptionProps) {
  const child = useSessions(value => sessionId !== undefined && value.byId[sessionId]?.origin === 'subagent')
  if (child) return null
  return <MenuItemButton separatorBefore disabled={sessionId === undefined}
    disabledReason={sessionId === undefined ? t('team-mode.workspace') : undefined}
    onSelect={() => { closeMenu(); open() }}>{t('team-mode.title')}</MenuItemButton>
}

/**
 * Show the captured team beside the tool preset and retain its picker outside the menu lifetime.
 * @param props - Framework-bound preference source and conversation projection.
 * @returns Selected-team label and body-portaled picker, or nothing before a conversation exists.
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
  useEffect(() => { void load() }, [load])
  return <>
    {header ? <Button onClick={open}>{state.selection.team
      ? t('team-mode.selected', { name: state.selection.team.name }) : t('team-mode.title')}
    {state.selection.team && !enabled && ` · ${t('team-mode.board-off')}`}</Button>
      : state.selection.team && <span className={css.suffix}>
        {t('team-mode.selected', { name: state.selection.team.name })}{!enabled && ` · ${t('team-mode.board-off')}`}
      </span>}
    <Modal open={state.open} title={t('team-mode.title')} closeLabel={t('roster.cancel')} onClose={close}
      description={t('team-mode.hint')} footer={<div className={css.actions}>
        <Button disabled={state.saving} onClick={configure}>{t('team-mode.configure')}</Button>
        <Button disabled={state.loading || state.saving || state.failed || state.selection.team === null}
          onClick={() => { void choose(null) }}>{t('team-mode.clear')}</Button>
        <Button disabled={state.loading || state.saving} onClick={() => { void load() }}>{t('project.refresh')}</Button>
      </div>}>
      {state.loading && <p role="status">{t('project.loading')}</p>}
      {state.failed && <p role="alert">{t('team-mode.failed')}{state.failure && ` (${state.failure})`}</p>}
      {state.boardFailed && <p role="alert">{t('team-mode.board-failed')}</p>}
      {!state.loading && state.teams.length === 0 && <p>{t('roster.no-teams')}</p>}
      <ul className={css.teams}>{state.teams.map(team => <li key={team.id}>
        <strong>{team.name}</strong>
        <ul>{team.memberIds.map((id) => {
          const employee = state.employees.find(item => item.id === id)
          return <li key={id}>{employee ? `${employee.name} · ${employee.provider} / ${employee.model}` : id}</li>
        })}</ul>
        <Button disabled={state.loading || state.saving || state.failed}
          onClick={() => { void choose(team) }}>{t('team-mode.use', { name: team.name })}</Button>
      </li>)}</ul>
    </Modal>
  </>
}
