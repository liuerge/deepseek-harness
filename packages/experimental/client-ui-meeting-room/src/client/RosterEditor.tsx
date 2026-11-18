/** Direct employee model routing and reusable team membership editors. */
import { useId, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Employee, ProjectTeam, EmployeeSaveInput, TeamSaveInput, RosterConnection } from '@deepseek-ai/dsh-meeting-room/types'
import type { MeetingRoomKey } from './locales.ts'
import css from './RosterEditor.module.css'

/** Roster editor data and Host-backed mutations. */
export interface RosterEditorProps {
  employees: Employee[]
  teams: ProjectTeam[]
  connections: RosterConnection[]
  connectionsLoading: boolean
  connectionsFailed: boolean
  loading: boolean
  openModelSettings?: (() => void) | undefined
  saveEmployee: (input: EmployeeSaveInput) => Promise<boolean>
  saveTeam: (input: TeamSaveInput) => Promise<boolean>
  delegateTeam: (id: string) => void
  t: (key: MeetingRoomKey) => string
}

/**
 * Edit an explicit employee route and team template before delegation.
 * @param props - Current roster, advisory model catalog and version-checked actions.
 * @returns Forms that retain user input on failure and do not start model work when saving.
 */
export function RosterEditor({ employees, teams, connections, connectionsLoading, connectionsFailed,
  loading, openModelSettings, saveEmployee, saveTeam, delegateTeam, t }: RosterEditorProps) {
  const [employee, setEmployee] = useState<EmployeeSaveInput | undefined>()
  const [team, setTeam] = useState<TeamSaveInput | undefined>()
  const [pending, setPending] = useState<'employee' | 'team' | undefined>()
  const [error, setError] = useState<'employee' | 'team' | undefined>()
  const modelList = useId()
  const connection = connections.find(item => item.id === employee?.provider)
  const editEmployee = (value?: Employee): void => {
    setError(undefined)
    setEmployee(value === undefined
      ? { expectedRevision: 0, name: '', responsibility: '', provider: '', model: '' }
      : { ...value, expectedRevision: value.revision })
    setTeam(undefined)
  }
  const editTeam = (value?: ProjectTeam): void => {
    setError(undefined)
    setTeam(value === undefined ? { expectedRevision: 0, name: '', memberIds: [] } : { ...value, expectedRevision: value.revision })
    setEmployee(undefined)
  }
  const save = async (kind: 'employee' | 'team'): Promise<void> => {
    if (pending) return
    setPending(kind)
    setError(undefined)
    try {
      const saved = kind === 'employee' && employee !== undefined ? await saveEmployee(employee)
        : kind === 'team' && team !== undefined ? await saveTeam(team) : false
      if (saved) { setEmployee(undefined); setTeam(undefined) }
      else setError(kind)
    } catch (_error) { setError(kind) }
    finally { setPending(undefined) }
  }
  const employeeValid = employee !== undefined && [employee.name, employee.responsibility, employee.provider, employee.model]
    .every(value => value.trim()) && connection !== undefined
  return <section className={css.section}>
    <header className={css.header}>
      <h2>{t('roster.title')}</h2>
      <div className={css.actions}>
        <Button disabled={!!pending || loading} onClick={() => { editEmployee() }}>{t('roster.employee')}</Button>
        <Button disabled={!!pending || loading || employees.length === 0} onClick={() => { editTeam() }}>{t('roster.team')}</Button>
      </div>
    </header>
    <p className={css.hint}>{t('roster.route-hint')}</p>
    {connectionsLoading && <p role="status">{t('roster.connections-loading')}</p>}
    {connectionsFailed && <p role="alert">{t('roster.catalog-failed')}</p>}
    {employee && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void save('employee') }}>
      <h3>{t(employee.id === undefined ? 'roster.employee' : 'roster.edit-employee')}</h3>
      <label>{t('roster.name')}<Input required value={employee.name} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, name: event.target.value }) }} /></label>
      <label>{t('roster.responsibility')}<textarea required value={employee.responsibility} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, responsibility: event.target.value }) }} /></label>
      <div className={css.fields}>
        <label>{t('roster.connection')}<select required value={employee.provider} disabled={!!pending}
          onChange={(event) => { setEmployee({ ...employee, provider: event.target.value, model: '' }) }}>
          <option value="">{t('roster.choose-connection')}</option>
          {employee.provider && !connection && <option value={employee.provider}>{employee.provider}</option>}
          {connections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}
        </select></label>
        <label>{t('roster.model')}<Input required list={modelList} value={employee.model} disabled={!!pending || !connection}
          onChange={(event) => { setEmployee({ ...employee, model: event.target.value }) }} />
        <datalist id={modelList}>{connection?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
        </label>
      </div>
      {openModelSettings && <div className={css.actions}>
        <Button disabled={!!pending} onClick={openModelSettings}>{t('roster.model-settings')}</Button>
      </div>}
      {!connectionsLoading && connections.length === 0
        && <p role="alert">{t('roster.no-connections')}</p>}
      {!connectionsLoading && connections.length > 0 && employee.provider && !connection
        && <p role="alert">{t('roster.connection-missing')}</p>}
      {connection?.failed && <p role="alert">{t('roster.catalog-failed')}</p>}
      <p className={css.hint}>{t('roster.model-hint')}</p>
      <label>{t('roster.preset')}<Input value={employee.preset ?? ''} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, preset: event.target.value.trim() || undefined }) }} /></label>
      {error === 'employee' && <p role="alert">{t('roster.save-failed')}</p>}
      <div className={css.actions}>
        <Button type="submit" disabled={!!pending || loading || !employeeValid}>{t(pending ? 'roster.saving' : 'roster.save')}</Button>
        <Button disabled={!!pending} onClick={() => { setEmployee(undefined) }}>{t('roster.cancel')}</Button>
      </div>
    </form>}
    {team && <form className={css.form} onSubmit={(event) => { event.preventDefault(); void save('team') }}>
      <h3>{t(team.id === undefined ? 'roster.team' : 'roster.edit-team')}</h3>
      <label>{t('roster.name')}<Input required value={team.name} disabled={!!pending}
        onChange={(event) => { setTeam({ ...team, name: event.target.value }) }} /></label>
      <fieldset disabled={!!pending}><legend>{t('roster.members')}</legend>
        {employees.map(item => <label key={item.id} className={css.member}>
          <input type="checkbox" checked={team.memberIds.includes(item.id)} onChange={(event) => {
            setTeam({ ...team,
              memberIds: event.target.checked ? [...team.memberIds, item.id] : team.memberIds.filter(id => id !== item.id) })
          }} /><span>{item.name}<small>{item.provider} / {item.model}</small></span>
        </label>)}
      </fieldset>
      {error === 'team' && <p role="alert">{t('roster.save-failed')}</p>}
      <p className={css.hint}>{t('roster.confirm-hint')}</p>
      <div className={css.actions}>
        <Button type="submit" disabled={!!pending || loading || !team.name.trim() || team.memberIds.length === 0}>
          {t(pending ? 'roster.saving' : 'roster.save')}</Button>
        <Button disabled={!!pending} onClick={() => { setTeam(undefined) }}>{t('roster.cancel')}</Button>
      </div>
    </form>}
    {!loading && employees.length === 0 && <p>{t('roster.empty')}</p>}
    <ul className={css.list}>{employees.map(item => <li key={item.id}>
      <div><strong>{item.name}</strong><p>{item.provider} / {item.model}</p><p>{item.responsibility}</p></div>
      <Button disabled={!!pending} onClick={() => { editEmployee(item) }}>{t('roster.edit-employee')}</Button>
    </li>)}</ul>
    <h3>{t('roster.saved-teams')}</h3>
    {teams.length === 0 && <p>{t('roster.no-teams')}</p>}
    <ul className={css.list}>{teams.map(item => <li key={item.id}>
      <div><strong>{item.name}</strong><p>{item.memberIds.map(id => employees.find(value => value.id === id)?.name ?? id).join(' · ')}</p></div>
      <div className={css.actions}>
        <Button disabled={!!pending} onClick={() => { editTeam(item) }}>{t('roster.edit-team')}</Button>
        <Button disabled={!!pending} onClick={() => { delegateTeam(item.id) }}>{t('roster.delegate')}</Button>
      </div>
    </li>)}</ul>
  </section>
}
