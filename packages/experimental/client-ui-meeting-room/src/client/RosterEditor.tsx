/** Direct employee model routing and reusable team membership editors. */
import { useEffect, useId, useRef, useState } from 'react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Button, IconChevronDownOutlineRegular, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Employee, EmployeeId, ProjectTeam, EmployeeSaveInput, TeamSaveInput, RosterConnection } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import type { MeetingRoomKey } from './locales.ts'
import css from './RosterEditor.module.css'
import { RosterAvatar } from './RosterAvatar.tsx'

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
  t: (key: MeetingRoomKey, params?: Record<string, unknown>) => string
}

/** Parses the multiline provider/model fallback editor into route records. */
function parseFallbacks(value: string): { provider: string; model: string }[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map((line) => {
    const slash = line.indexOf('/')
    return slash < 0
      ? { provider: line, model: '' }
      : { provider: line.slice(0, slash), model: line.slice(slash + 1) }
  })
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
  const [collapsedTeams, setCollapsedTeams] = useState<ReadonlySet<string>>(new Set())
  const modelList = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  // The editor forms live above the saved lists; opening one from a list row scrolls it into view so the click has a visible response.
  useEffect(() => {
    if ((employee !== undefined || team !== undefined) && typeof formRef.current?.scrollIntoView === 'function') {
      formRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [employee, team])
  const connection = connections.find(item => item.id === employee?.provider)
  const selectedModel = connection?.models.find(item => item.id === employee?.model)
  const efforts = selectedModel?.efforts ?? []
  const editEmployee = (value?: Employee): void => {
    setError(undefined)
    setEmployee(value === undefined
      ? { expectedRevision: 0, name: '', responsibility: '', provider: '', model: '', fallbacks: [] }
      : { ...value, expectedRevision: value.revision, fallbacks: value.fallbacks ?? [] })
    setTeam(undefined)
  }
  const editTeam = (value?: ProjectTeam): void => {
    setError(undefined)
    setTeam(value === undefined
      ? { expectedRevision: 0, name: '', memberIds: [] }
      : { ...value, expectedRevision: value.revision, description: value.description ?? '', collaborationInstructions: value.collaborationInstructions ?? '' })
    setEmployee(undefined)
  }
  const toggleTeam = (id: string): void => {
    setCollapsedTeams((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const save = async (kind: 'employee' | 'team'): Promise<void> => {
    if (pending) return
    setPending(kind)
    setError(undefined)
    try {
      const saved = kind === 'employee' && employee !== undefined
        ? await saveEmployee({ ...employee, description: employee.description?.trim() || undefined })
        : kind === 'team' && team !== undefined
          ? await saveTeam({
            ...team,
            description: team.description?.trim() || undefined,
            collaborationInstructions: team.collaborationInstructions?.trim() || undefined,
          })
          : false
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
        <Button variant="outline" disabled={!!pending || loading} onClick={() => { editEmployee() }}>{t('roster.employee')}</Button>
        <Button variant="outline" disabled={!!pending || loading || employees.length === 0} onClick={() => { editTeam() }}>{t('roster.team')}</Button>
      </div>
    </header>
    <p className={css.hint}>{t('roster.route-hint')}</p>
    {connectionsLoading && <p role="status">{t('roster.connections-loading')}</p>}
    {connectionsFailed && <p role="alert">{t('roster.catalog-failed')}</p>}
    {employee && <form ref={formRef} className={css.form} onSubmit={(event) => { event.preventDefault(); void save('employee') }}>
      <h3>{t(employee.id === undefined ? 'roster.employee' : 'roster.edit-employee')}</h3>
      <label>{t('roster.name')}<Input required value={employee.name} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, name: event.target.value }) }} /></label>
      <label>{t('roster.description')}<textarea value={employee.description ?? ''} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, description: event.target.value }) }} /></label>
      <label>{t('roster.responsibility')}<textarea required value={employee.responsibility} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, responsibility: event.target.value }) }} /></label>
      <div className={css.fields}>
        <label>{t('roster.connection')}<select required value={employee.provider} disabled={!!pending}
          onChange={(event) => { setEmployee({ ...employee, provider: event.target.value, model: '' }) }}>
          <option value="">{t('roster.choose-connection')}</option>
          {employee.provider && !connection && <option value={employee.provider}>{employee.provider}</option>}
          {connections.map(item => <option key={item.id} value={item.id}>{item.name === item.id ? item.name : `${item.name} · ${item.id}`}</option>)}
        </select></label>
        <label>{t('roster.model')}<Input required list={modelList} value={employee.model} disabled={!!pending || !connection}
          onChange={(event) => { setEmployee({ ...employee, model: event.target.value, reasoningEffort: undefined }) }} />
        <datalist id={modelList}>{connection?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
        </label>
      </div>
      {efforts.length > 0 && <label>{selectedModel?.name}
        <select value={employee.reasoningEffort ?? ''} disabled={!!pending}
          onChange={(event) => { setEmployee({ ...employee, reasoningEffort: event.target.value || undefined }) }}>
          <option value="">—</option>
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </label>}
      <label>{t('roster.fallbacks')}<textarea disabled={!!pending}
        value={(employee.fallbacks ?? []).map(route => `${route.provider}/${route.model}`).join('\n')}
        onChange={(event) => { setEmployee({ ...employee, fallbacks: parseFallbacks(event.target.value) }) }} /></label>
      {openModelSettings && <div className={css.actions}>
        <Button disabled={!!pending} onClick={openModelSettings}>{t('roster.model-settings')}</Button>
      </div>}
      {!connectionsLoading && connections.length === 0
        && <p role="alert">{t('roster.no-connections')}</p>}
      {!connectionsLoading && connections.length > 0 && employee.provider && !connection
        && <p role="alert">{t('roster.connection-missing')}</p>}
      {connection?.failed && <p role="alert">{t('roster.catalog-failed')}</p>}
      <p className={css.hint}>{t('roster.model-hint')}</p>
      {connection?.external === true && <p className={css.hint}>{t('roster.external-hint')}</p>}
      <label>{t('roster.preset')}<Input value={employee.preset ?? ''} disabled={!!pending}
        onChange={(event) => { setEmployee({ ...employee, preset: event.target.value.trim() || undefined }) }} /></label>
      {error === 'employee' && <p role="alert">{t('roster.save-failed')}</p>}
      <div className={css.actions}>
        <Button type="submit" variant="primary" disabled={!!pending || loading || !employeeValid}>{t(pending ? 'roster.saving' : 'roster.save')}</Button>
        <Button disabled={!!pending} onClick={() => { setEmployee(undefined) }}>{t('roster.cancel')}</Button>
      </div>
    </form>}
    {team && <form ref={formRef} className={css.form} onSubmit={(event) => { event.preventDefault(); void save('team') }}>
      <h3>{t(team.id === undefined ? 'roster.team' : 'roster.edit-team')}</h3>
      <label>{t('roster.name')}<Input required value={team.name} disabled={!!pending}
        onChange={(event) => { setTeam({ ...team, name: event.target.value }) }} /></label>
      <label>{t('roster.team-description')}<textarea value={team.description ?? ''} disabled={!!pending}
        onChange={(event) => { setTeam({ ...team, description: event.target.value }) }} /></label>
      <label>{t('roster.collaboration')}<textarea value={team.collaborationInstructions ?? ''} disabled={!!pending}
        onChange={(event) => { setTeam({ ...team, collaborationInstructions: event.target.value }) }} /></label>
      <div className={css.fields}>
        <label>{t('roster.owner')}<select value={team.ownerEmployeeId ?? ''} disabled={!!pending || team.memberIds.length === 0}
          onChange={(event) => { setTeam({ ...team, ownerEmployeeId: event.target.value === '' ? undefined : brandString<EmployeeId>(event.target.value) }) }}>
          <option value="">{t('roster.owner-none')}</option>
          {team.memberIds.map((memberId) => {
            const member = employees.find(item => item.id === memberId)
            return <option key={memberId} value={memberId}>{member?.name ?? memberId}</option>
          })}
        </select></label>
        <div className={css.switchField}>
          <span>{t('roster.allow-assignment')}</span>
          <Switch checked={team.allowAssignment ?? true} disabled={!!pending}
            label={t('roster.allow-assignment')}
            onChange={(next) => { setTeam({ ...team, allowAssignment: next }) }} />
        </div>
      </div>
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
        <Button type="submit" variant="primary" disabled={!!pending || loading || !team.name.trim() || team.memberIds.length === 0}>
          {t(pending ? 'roster.saving' : 'roster.save')}</Button>
        <Button disabled={!!pending} onClick={() => { setTeam(undefined) }}>{t('roster.cancel')}</Button>
      </div>
    </form>}
    {!loading && employees.length === 0 && <p>{t('roster.empty')}</p>}
    <h3>{t('roster.saved-teams')}</h3>
    <ul className={css.list}>{teams.map((item) => {
      const members = item.memberIds.map(id => employees.find(value => value.id === id))
      const open = !collapsedTeams.has(item.id)
      return <li key={item.id} className={css.teamCard}>
        <div className={css.teamHead}>
          <button type="button" className={css.teamToggle} aria-expanded={open}
            aria-label={t(open ? 'roster.collapse-team' : 'roster.expand-team')}
            onClick={() => { toggleTeam(item.id) }}>
            <IconChevronDownOutlineRegular className={css.teamChevron} />
          </button>
          <RosterAvatar id={item.id} name={item.name} />
          <strong className={css.teamName}>{item.name}</strong>
          <span className={css.teamCount}>{t('roster.member-count', { count: item.memberIds.length })}</span>
          {item.allowAssignment === false && <span className={css.ownerChip}>{t('roster.assignment-disabled')}</span>}
          <div className={css.actions}>
            <Button variant="outline" disabled={!!pending} onClick={() => { editTeam(item) }}>{t('roster.edit-team')}</Button>
            <Button variant="outline" disabled={!!pending} onClick={() => { delegateTeam(item.id) }}>{t('roster.delegate')}</Button>
          </div>
        </div>
        {open && <div className={css.teamBody}>
          {item.description && <p className={css.teamNote}>{item.description}</p>}
          {item.collaborationInstructions && <p className={css.teamNote}>{item.collaborationInstructions}</p>}
          {item.memberIds.map((memberId, index) => {
            const member = members[index]
            return <div key={memberId} className={css.memberRow}>
              <RosterAvatar id={memberId} name={member?.name ?? memberId} />
              <div className={css.memberInfo}>
                <strong>{member?.name ?? memberId}</strong>
                {item.ownerEmployeeId === memberId && <span className={css.ownerChip}>{t('roster.owner')}</span>}
                {member && <p>{member.provider} / {member.model}</p>}
              </div>
            </div>
          })}
          {members.some(member => member !== undefined) && <p className={css.modelChain}>
            <span className={css.chainLabel}>{t('roster.model')}</span>
            {members.map((member, index) => <span key={item.memberIds[index]} className={css.chainNode}>
              {index > 0 && <span className={css.chainArrow} aria-hidden="true">→</span>}
              <span className={css.chainModel} title={member ? `${member.provider}/${member.model}` : undefined}>
                {member?.model ?? item.memberIds[index]}
              </span>
            </span>)}
          </p>}
        </div>}
      </li>
    })}</ul>
    <h3>{t('roster.employees')}</h3>
    <ul className={css.list}>{employees.map(item => <li key={item.id}>
      <div>
        <div className={css.employeeHead}><RosterAvatar id={item.id} name={item.name} /><strong>{item.name}</strong></div>
        {item.description && <p>{item.description}</p>}
        <p>{item.provider} / {item.model}</p><p>{item.responsibility}</p>
      </div>
      <Button variant="outline" disabled={!!pending} onClick={() => { editEmployee(item) }}>{t('roster.edit-employee')}</Button>
    </li>)}</ul>
  </section>
}
