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
import type { Employee, ProjectTeam, ProjectPlan } from '@deepseek-ai/dsh-meeting-room/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ProjectPage, type ProjectCheckpoint } from './ProjectPage.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh, type MeetingRoomKey } from './locales.ts'
import { MeetingPanelIcon } from './MeetingPanelIcon.tsx'
import { mountSessionMeetings } from './session-meetings.ts'
import { prepareMainPrompt } from './session-navigation.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionProjects } from './SessionProjects.tsx'

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
  await ctx.inject(['remote.projectDashboard'], (child) => { mountProjectPage(child); mountSessionMeetings(child) })
}

/** Mount the retained project catalog and its requirement entry action. */
function mountProjectPage(ctx: ClientContext): void {
  const lifetime = new AbortController()
  const catalog = createSnapshotStore<{
    records: ProjectCheckpoint[]
    employees: Employee[]
    teams: ProjectTeam[]
    plans: ProjectPlan[]
    loading: boolean
    failed: boolean
  }>({
    records: [], employees: [], teams: [], plans: [], loading: false, failed: false,
  })
  let pending: Promise<void> | undefined
  let confirming: Promise<void> | undefined
  ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([pending, confirming]) })
  const refresh = (): void => {
    if (pending || lifetime.signal.aborted) return
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
          catalog.set({ records: result.value, ...roster.value, plans: plans.value, loading: false, failed: false })
        }
        else catalog.update((state) => { state.loading = false; state.failed = true })
      } catch (_error) {
        if (!lifetime.signal.aborted) catalog.update((state) => { state.loading = false; state.failed = true })
      }
    })().finally(() => { pending = undefined })
  }
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
  ctx.slots.inject('conversation.session.header.actions.subagent.footer', () => ctx.slots.register({
    name: 'conversation.session.header.actions.subagent.footer', id: 'project-tasks', locale: NS, order: 30,
    inject: () => ({ hooks: { catalog }, refresh, openWorkspace: () => { ctx.layout.selectPanel(id) } }),
  }, SessionProjects))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: id, locale: NS,
    inject: () => ({ hooks: { catalog }, refresh,
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
