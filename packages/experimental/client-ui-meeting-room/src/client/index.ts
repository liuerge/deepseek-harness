/** Project workspace and session-scoped meeting process registrations. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import remote from '@deepseek-ai/dsh-meeting-room/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Employee, ProjectTeam, ProjectPlan } from '@deepseek-ai/dsh-meeting-room/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ProjectPage, type ProjectCheckpoint } from './ProjectPage.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh, type MeetingRoomKey } from './locales.ts'
import { MeetingPanelIcon } from './MeetingPanelIcon.tsx'
import { mountSessionMeetings } from './session-meetings.ts'
import { prepareMainPrompt } from './session-navigation.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionProjects, ProjectSectionActions } from './SessionProjects.tsx'
// The Session panel owns the panel-section SlotMap declarations this package registers into.
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { mountTeamPicker } from './team-picker.ts'
import { mountSessionArtifacts } from './session-artifacts-view.ts'
import type { EmployeeSaveInput, TeamSaveInput, RosterConnection } from '@deepseek-ai/dsh-meeting-room/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Meeting list, meeting detail and sidebar entry copy. */
    'meetingRoom': MeetingRoomKey
  }
}

/** Services the registration reads. */
export const inject = ['slots', 'locale', 'remote', 'uiWorkspace', 'contextMenus', 'layout', 'conversation', 'sessions']

/**
 * Register the meeting panel, its sidebar entry and its copy.
 * @param ctx - browser services used by these contributions.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(remote)
  ctx.effect(() => unmount)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'client-ui-meeting-room: dictionaries')
  await ctx.inject(['remote.projectDashboard', 'remote.projectRoster'], (child) => { mountProjectPage(child); mountSessionMeetings(child) })
  await ctx.inject(['remote.projectTeamContext', 'remote.projectDashboard', 'remote.agentTeams'], mountTeamPicker)
}

/** Mount the retained project catalog and its requirement entry action. */
function mountProjectPage(ctx: ClientContext): void {
  let openSettings: (() => void) | undefined
  ctx.inject(['settingsNavigation'], (scope) => {
    const open = (): void => { scope.settingsNavigation.open('models') }
    openSettings = open
    return () => { if (openSettings === open) openSettings = undefined }
  })
  const lifetime = new AbortController()
  const catalog = createSnapshotStore<{
    records: ProjectCheckpoint[]
    employees: Employee[]
    teams: ProjectTeam[]
    plans: ProjectPlan[]
    loading: boolean
    failed: boolean
    connections: RosterConnection[]
    connectionsLoading: boolean
    connectionsFailed: boolean
  }>({
    records: [], employees: [], teams: [], plans: [], connections: [], loading: false, failed: false,
    connectionsLoading: false, connectionsFailed: false,
  })
  let pending: Promise<void> | undefined
  let refreshAgain = false
  let confirming: Promise<void> | undefined
  let saving: Promise<boolean> | undefined
  let discovering: Promise<void> | undefined
  let rediscover = false
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([pending, confirming, saving, discovering]) })
  const discover = (): void => {
    if (lifetime.signal.aborted) return
    if (discovering) { rediscover = true; return }
    catalog.update((state) => { state.connectionsLoading = true; state.connectionsFailed = false })
    discovering = (async () => {
      try {
        const result = await ctx.remote.projectRoster.connections(lifetime.signal)
        lifetime.signal.throwIfAborted()
        catalog.update((state) => {
          state.connectionsLoading = false
          state.connectionsFailed = !result.ok
          if (result.ok) state.connections = result.value
        })
      } catch (_error) {
        if (!lifetime.signal.aborted) catalog.update((state) => {
          state.connectionsLoading = false; state.connectionsFailed = true
        })
      }
    })().finally(() => {
      discovering = undefined
      if (rediscover && !lifetime.signal.aborted) { rediscover = false; discover() }
    })
  }
  ctx.effect(() => ctx.remote.$on('settings/document-updated', discover))
  ctx.effect(() => ctx.on('connection/reset', discover))
  const refresh = (): void => {
    discover()
    if (lifetime.signal.aborted) return
    if (pending) { refreshAgain = true; return }
    catalog.update((state) => { state.loading = true; state.failed = false })
    pending = (async () => {
      try {
        const [result, roster, plans] = await Promise.all([
          ctx.remote.projectDashboard.timeline(lifetime.signal),
          ctx.remote.projectDashboard.roster(lifetime.signal),
          ctx.remote.projectDashboard.plans(lifetime.signal),
        ])
        lifetime.signal.throwIfAborted()
        if (result.ok && roster.ok && plans.ok) {
          catalog.update((state) => {
            state.records = result.value; state.employees = roster.value.employees; state.teams = roster.value.teams
            state.plans = plans.value; state.loading = false; state.failed = false
          })
        }
        else catalog.update((state) => { state.loading = false; state.failed = true })
      } catch (_error) {
        if (!lifetime.signal.aborted) catalog.update((state) => { state.loading = false; state.failed = true })
      }
    })().finally(() => {
      pending = undefined
      if (refreshAgain && !lifetime.signal.aborted) { refreshAgain = false; refresh() }
    })
  }
  const stream = ctx.remote.$stream<boolean>({
    name: 'project checkpoints', open: signal => ctx.remote.projectDashboard.follow(signal),
    ended: () => new Error('Project checkpoint stream ended'),
  })
  ctx.effect(() => () => stream.dispose())
  void (async () => {
    for await (const frame of stream) { refresh(); frame.accept() }
  })().catch(() => { if (!lifetime.signal.aborted) catalog.update((state) => { state.failed = true }) })
  const confirm = (action: () => Promise<{ ok: boolean }>): Promise<void> => {
    if (confirming || lifetime.signal.aborted || catalog.getSnapshot().loading) return Promise.resolve()
    const priorRead = pending
    catalog.update((state) => { state.loading = true; state.failed = false })
    confirming = (async () => {
      try {
        await priorRead
        lifetime.signal.throwIfAborted()
        const result = await action()
        lifetime.signal.throwIfAborted()
        catalog.update((state) => { state.loading = false; state.failed = !result.ok })
        if (result.ok) refresh()
      } catch (_error) {
        if (!lifetime.signal.aborted) catalog.update((state) => { state.loading = false; state.failed = true })
      }
    })().finally(() => { confirming = undefined })
    return confirming
  }
  const t = ctx.locale.bind(NS)
  const save = (action: () => Promise<{ ok: boolean }>): Promise<boolean> => {
    if (saving || lifetime.signal.aborted) return Promise.resolve(false)
    saving = (async () => {
      try {
        const result = await action()
        lifetime.signal.throwIfAborted()
        if (result.ok) { await pending; refresh(); await pending }
        return result.ok
      } catch (_error) { return false }
    })().finally(() => { saving = undefined })
    return saving
  }
  const mainPrompt = (sessionId: string | undefined, prompt: string): void => {
    if (!sessionId) { catalog.update((state) => { state.failed = true }); return }
    try { prepareMainPrompt(ctx, sessionId, prompt, t('project.error')) }
    catch (_error) { ctx.contextMenus.notify(t('project.error')) }
  }
  const planPrompt = (id: string, revision: number, prompt: string): void => {
    const plan = catalog.getSnapshot().plans.find(item => item.id === id && item.revision === revision)
    const execution = catalog.getSnapshot().records.find(record => record.projectId === plan?.executionId)
    const sessionId = plan?.originSessionId ?? execution?.sessionId
    mainPrompt(sessionId, prompt)
  }
  const id = 'project-workspace' as MainPanelId
  ctx.inject(['uiConversation'], (child) => {
    mountSessionArtifacts(child, { hooks: { catalog }, refresh,
      confirmPlan: (id, revision) => confirm(() => child.remote.projectDashboard.confirmPlan(id, revision, lifetime.signal)),
      openWorkspace: () => { child.layout.selectPanel(id) },
    })
  })
  ctx.slots.inject('conversation.session.panel.section', () => ctx.slots.register({
    name: 'conversation.session.panel.section', id: 'project-tasks', locale: NS,
    // After background jobs (300).
    order: 400,
    label: () => t('project.session-tasks'),
    inject: () => ({ hooks: { catalog } }),
  }, SessionProjects))
  ctx.slots.inject('conversation.session.panel.section.actions', () => ctx.slots.register({
    name: 'conversation.session.panel.section.actions', key: 'project-tasks', locale: NS,
    inject: () => ({ refresh, openWorkspace: () => { ctx.layout.selectPanel(id) }, hooks: { catalog } }),
  }, ProjectSectionActions))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: id, locale: NS,
    inject: () => ({ hooks: { catalog }, refresh,
      openModelSettings: () => {
        try {
          if (!openSettings) { ctx.contextMenus.notify(t('roster.settings-unavailable')); return }
          openSettings()
        }
        catch (_error) { ctx.contextMenus.notify(t('roster.settings-unavailable')) }
      },
      saveEmployee: (input: EmployeeSaveInput) => save(() => ctx.remote.projectRoster.saveEmployee(input, lifetime.signal)),
      saveTeam: (input: TeamSaveInput) => save(() => ctx.remote.projectRoster.saveTeam(input, lifetime.signal)),
      confirmPlan: (id: string, revision: number) => confirm(() => ctx.remote.projectDashboard.confirmPlan(id, revision, lifetime.signal)),
      approveAcceptance: (id: string, checkpoint: number) => confirm(() =>
        ctx.remote.projectDashboard.confirmAcceptance(id, checkpoint, lifetime.signal)),
      continueProject: (id: string, checkpoint: number) => {
        const repairing = catalog.getSnapshot().records.some(record => record.projectId === id
          && record.checkpoint === checkpoint && record.state === 'acceptance-blocked')
        mainPrompt(catalog.getSnapshot().records.find(record => record.projectId === id)?.sessionId,
          `${t(repairing ? 'review.reworkPrompt' : 'review.continuePrompt')}\n${JSON.stringify({ projectId: id, expectedCheckpoint: checkpoint })}`)
      },
      openMain: (sessionId: string, projectId: string) => { mainPrompt(sessionId, `${t('project.correct-prompt')}\n${JSON.stringify({ projectId })}`) },
      openWorker: (parent: string, child: string) => {
        ctx.uiWorkspace.openSession({ parentSessionId: parent as SessionId, childSessionId: child as SessionId, mode: 'continuable' })
      },
      adoptPlan: (id: string, revision: number) => {
        ctx.uiWorkspace.startSession(undefined, {
          prompt: `${t('plan.adoptPrompt')}\n${JSON.stringify({ id, expectedRevision: revision })}`, whenDraftExists: 'append',
        })
      },
      editPlan: (id: string, revision: number) => {
        planPrompt(id, revision, `${t('plan.editPrompt')}\n${JSON.stringify({ id, expectedRevision: revision })}`)
      },
      preparePlan: () => { ctx.uiWorkspace.startSession(undefined, { prompt: t('plan.preparePrompt'), whenDraftExists: 'append' }) },
      runPlan: (id: string, revision: number) => {
        planPrompt(id, revision, `${t('plan.runPrompt')}\n${JSON.stringify({ planId: id, planRevision: revision })}`)
      },
      configureEmployee: () => { ctx.uiWorkspace.startSession(undefined, { prompt: t('roster.employeePrompt'), whenDraftExists: 'append' }) },
      configureTeam: () => { ctx.uiWorkspace.startSession(undefined, { prompt: t('roster.teamPrompt'), whenDraftExists: 'append' }) },
      delegateTeam: (id: string) => {
        ctx.uiWorkspace.startSession(undefined, { prompt: `${t('roster.delegatePrompt')}\nteamId=${JSON.stringify(id)}`, whenDraftExists: 'append' })
      },
      newProject: () => { ctx.uiWorkspace.startSession(undefined, { prompt: t('plan.preparePrompt'), whenDraftExists: 'append' }) },
    }),
  }, ProjectPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id, order: 19, locale: NS, label: () => t('project.title'),
  }, MeetingPanelIcon))
  refresh()
}
