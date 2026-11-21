/** Sidebar roster panel: employee and team editors with their saved cards, under its own entry. */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Employee, ProjectTeam, ProjectPlan, EmployeeSaveInput, TeamSaveInput, RosterConnection } from '@deepseek-ai/dsh-meeting-room/types'
import { RosterEditor } from './RosterEditor.tsx'
import type { NS } from './locales.ts'
import css from './ProjectPage.module.css'
import type { ProjectCheckpoint } from './ProjectPage.tsx'

/** Roster panel data and Host-backed mutations. */
export interface RosterInjected {
  hooks: { catalog: HostObservable<{
    records: ProjectCheckpoint[]
    employees: Employee[]
    teams: ProjectTeam[]
    plans: ProjectPlan[]
    loading: boolean
    failed: boolean
    connections: RosterConnection[]
    connectionsLoading: boolean
    connectionsFailed: boolean
  }> }
  refresh: () => void
  openModelSettings: () => void
  saveEmployee: (input: EmployeeSaveInput) => Promise<boolean>
  saveTeam: (input: TeamSaveInput) => Promise<boolean>
  delegateTeam: (id: string) => void
}

type Props = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<RosterInjected>

/**
 * Render the roster editing panel under its own sidebar entry.
 * @param props - Host catalog, localized copy and version-checked roster mutations.
 * @returns the roster panel with loading and failure feedback.
 */
export function RosterPanel(props: Props) {
  const { useCatalog, t, saveEmployee, saveTeam, delegateTeam, openModelSettings } = props
  const catalog = useCatalog(value => value)
  return <section className={css.page}>
    {catalog.loading && <p role="status">{t('project.loading')}</p>}
    {catalog.failed && <p role="alert">{t('project.error')}</p>}
    <RosterEditor employees={catalog.employees} teams={catalog.teams} connections={catalog.connections}
      connectionsLoading={catalog.connectionsLoading} connectionsFailed={catalog.connectionsFailed}
      loading={catalog.loading} saveEmployee={saveEmployee} saveTeam={saveTeam} delegateTeam={delegateTeam}
      openModelSettings={openModelSettings} t={t} />
  </section>
}
