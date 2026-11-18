/** Conversation-bound team preferences and explicit shared-board activation. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Employee, ProjectTeam, SessionTeamSelection } from '@deepseek-ai/dsh-meeting-room/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-agent-team/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { TeamPickerHeader, TeamPickerLabel, TeamPickerOption, type TeamPickerInjected } from './TeamPicker.tsx'
import { NS } from './locales.ts'

/** One conversation's saved preference and currently inspected roster. */
export interface TeamPickerState {
  selection: SessionTeamSelection
  teams: ProjectTeam[]
  employees: Employee[]
  open: boolean
  loading: boolean
  saving: boolean
  failed: boolean
  failure: string | null
  boardFailed: boolean
}

/** Owns requests for an exact conversation; failed writes retain the last known preference. */
export class TeamPickerController {
  /** Stable preference and request state shared by this conversation's menu and label. */
  readonly store = createSnapshotStore<TeamPickerState>({
    selection: { revision: 0, team: null, employees: [] }, teams: [], employees: [],
    open: false, loading: false, saving: false, failed: false, failure: null, boardFailed: false,
  })
  private readonly lifetime = new AbortController()
  private reading: Promise<void> | undefined
  private writing: Promise<void> | undefined

  /** @param ctx - Registration context owning the Remote operations. @param sessionId - Exact main conversation. */
  constructor(private readonly ctx: Context, private readonly sessionId: SessionId | undefined) {}

  /** Load current preference and roster without invoking a model or changing a draft. */
  load(): Promise<void> {
    const sessionId = this.sessionId
    if (sessionId === undefined) return Promise.resolve()
    if (this.reading) return this.reading
    if (this.writing || this.lifetime.signal.aborted) return Promise.resolve()
    this.store.update((state) => { state.loading = true; state.failed = false; state.failure = null })
    this.reading = (async () => {
      try {
        const [selection, roster] = await Promise.all([
          this.ctx.remote.projectTeamContext.current(sessionId, this.lifetime.signal),
          this.ctx.remote.projectDashboard.roster(this.lifetime.signal),
        ])
        this.lifetime.signal.throwIfAborted()
        if (!selection.ok) throw selection.error
        if (!roster.ok) throw roster.error
        this.store.update((state) => {
          state.selection = selection.value; state.teams = roster.value.teams; state.employees = roster.value.employees
          state.loading = false
        })
      } catch (error) {
        if (!this.lifetime.signal.aborted) this.store.update((state) => {
          state.loading = false; state.failed = true; state.failure = error instanceof Error ? error.message : null
        })
      }
    })().finally(() => { this.reading = undefined })
    return this.reading
  }

  /** Open the picker and refresh the roster versions visible for this choice. */
  open(): void { this.store.update((state) => { state.open = true }); void this.load() }

  /** Close the picker; an already submitted write still belongs to this conversation. */
  close(): void { this.store.update((state) => { state.open = false }) }

  /**
   * Save the inspected versions, then enable the shared board for a selected team.
   * Clearing a planning preference preserves the board and its existing tasks.
   * @param team - Inspected team, or null to clear the default.
   * @returns Completion; partial activation remains visible and can be retried.
   */
  choose(team: ProjectTeam | null): Promise<void> {
    const sessionId = this.sessionId
    if (sessionId === undefined) return Promise.resolve()
    if (this.writing) return this.writing
    const state = this.store.getSnapshot()
    if (this.reading || state.failed || this.lifetime.signal.aborted) return Promise.resolve()
    const employees = team === null ? [] : team.memberIds.map(id => state.employees.find(employee => employee.id === id))
    if (employees.some(employee => employee === undefined)) {
      this.store.update((value) => { value.failed = true }); return Promise.resolve()
    }
    this.store.update((value) => { value.saving = true; value.failed = false; value.failure = null; value.boardFailed = false })
    this.writing = (async () => {
      try {
        const result = await this.ctx.remote.projectTeamContext.select(sessionId, {
          expectedRevision: state.selection.revision, teamId: team?.id ?? null, teamRevision: team?.revision ?? null,
          employees: employees.flatMap(employee => employee === undefined ? [] : [{ id: employee.id, revision: employee.revision }]),
        }, this.lifetime.signal)
        this.lifetime.signal.throwIfAborted()
        if (!result.ok) { this.store.update((value) => { value.failed = true }); return }
        this.store.update((value) => { value.selection = result.value })
        if (team !== null) {
          try {
            const enabled = await this.ctx.remote.agentTeams.setEnabled(sessionId, true, this.lifetime.signal)
            this.lifetime.signal.throwIfAborted()
            if (!enabled.ok) { this.store.update((value) => { value.boardFailed = true }); return }
          } catch (_error) {
            if (!this.lifetime.signal.aborted) this.store.update((value) => { value.boardFailed = true })
            return
          }
        }
        this.store.update((value) => { value.open = false })
      } catch (_error) {
        if (!this.lifetime.signal.aborted) this.store.update((value) => { value.failed = true })
      } finally {
        if (!this.lifetime.signal.aborted) this.store.update((value) => { value.saving = false })
      }
    })().finally(() => { this.writing = undefined })
    return this.writing
  }

  /** Cancel reads and wait for admitted preference and board operations before disposal. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([this.reading, this.writing])
  }
}

/**
 * Register optional mode-menu contributions without replacing the native tool preset.
 * @param ctx - Plugin scope containing the team preference and shared-board remotes.
 */
export function mountTeamPicker(ctx: Context): void {
  const controllers = new Map<SessionId, TeamPickerController>()
  const unbound = new TeamPickerController(ctx, undefined)
  const panel = 'project-workspace' as MainPanelId
  const forSession = (sessionId: SessionId | undefined): TeamPickerInjected => {
    let controller = sessionId === undefined ? unbound : controllers.get(sessionId)
    if (!controller && sessionId !== undefined) {
      controller = new TeamPickerController(ctx, sessionId); controllers.set(sessionId, controller)
    }
    controller ??= unbound
    const owned = controller
    return { hooks: { teamPicker: owned.store }, load: () => owned.load(), open: () => { owned.open() },
      close: () => { owned.close() }, choose: team => owned.choose(team),
      configure: () => { owned.close(); ctx.layout.selectPanel(panel) } }
  }
  ctx.effect(() => async () => {
    await Promise.all([...controllers.values()].map(controller => controller.dispose())); controllers.clear()
  })
  ctx.slots.inject('conversation.hero.agentPreset.suffix', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset.suffix', id: 'project-team', locale: NS, inject: forSession,
  }, TeamPickerLabel))
  ctx.slots.inject('conversation.hero.agentPreset.options', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset.options', id: 'project-team', locale: NS, inject: forSession,
  }, TeamPickerOption))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'project-team', locale: NS, inject: forSession, order: -9,
  }, TeamPickerHeader))
}
