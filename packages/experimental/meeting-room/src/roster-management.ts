/** Authenticated employee and team configuration over the durable project roster. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { MeetingStore } from './store.ts'
import { assertEmployeeRouteConfig, employeeReasoningEfforts } from './employee-route.ts'
import type { Employee, EmployeeId, ProjectTeam, ProjectTeamId, EmployeeSaveInput, TeamSaveInput, RosterConnection } from './types.ts'

const text = z.string().trim().min(1)
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1)
const employeeInput = z.object({
  id: text.optional(), expectedRevision: revision, name: text, responsibility: text,
  provider: text, model: text, reasoningEffort: text.optional(),
  fallbacks: z.array(z.object({ provider: text, model: text })).default([]), preset: text.optional(),
})
const teamInput = z.object({ id: text.optional(), expectedRevision: revision, name: text, memberIds: z.array(text).min(1) })

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Version-checked roster editing and active model connection discovery. */
    projectRoster: ProjectRoster
  }
}

/** Employee configuration and team membership; independent of plan confirmation or dispatch. */
export default class ProjectRoster extends TypertRemoteService {
  static inject = ['llm']
  private readonly lifetime = new AbortController()

  /** @param ctx - Owning plugin lifetime. @param options - Shared roster and per-route catalog deadline. */
  constructor(ctx: Context, private readonly options: { store: MeetingStore; modelCatalogTimeoutMs: number }) {
    super(ctx, 'projectRoster')
    ctx.effect(() => () => { this.lifetime.abort() })
  }

  private get store(): MeetingStore { return this.options.store }

  /**
   * Read registered model connections and their advisory catalogs, without reading credentials.
   * @param signal - Cancellation before or during catalog discovery.
   * @returns Each route with its models or an explicit discovery failure; registration does not certify credentials.
   */
  @Remote
  async connections(signal: AbortSignal): Promise<RosterConnection[]> {
    const active = AbortSignal.any([signal, this.lifetime.signal])
    active.throwIfAborted()
    return Promise.all(this.ctx.llm.listProviders().map(async (provider) => {
      const deadline = AbortSignal.any([active, AbortSignal.timeout(this.options.modelCatalogTimeoutMs)])
      let abort: (() => void) | undefined
      try {
        const modelsFromCatalog = await Promise.race([
          this.ctx.llm.listModels(provider.id),
          new Promise<never>((_resolve, reject) => {
            abort = () => { reject(new HarnessError('Model catalog discovery stopped.', 'PROJECT_MODEL_CATALOG_CANCELLED')) }
            deadline.addEventListener('abort', abort, { once: true })
            if (deadline.aborted) abort()
          }),
        ])
        active.throwIfAborted()
        // Effort discovery is advisory: a catalog entry with no reasoning
        // metadata simply omits the field, and a lookup failure keeps the model.
        const efforts = await Promise.all(modelsFromCatalog.map(model =>
          employeeReasoningEfforts(this.ctx, provider.id, model.id, deadline)))
        const effortByModel = new Map(modelsFromCatalog.map((model, index) => [model.id, efforts[index] ?? []] as const))
        const models = modelsFromCatalog.map((model) => {
          const declared = effortByModel.get(model.id)
          return declared !== undefined && declared.length > 0
            ? { id: model.id, name: model.name, efforts: [...declared] }
            : { id: model.id, name: model.name }
        })
        active.throwIfAborted()
        return { ...provider, models, failed: false }
      } catch (_error) {
        active.throwIfAborted()
        return { ...provider, models: [], failed: true }
      } finally { if (abort) deadline.removeEventListener('abort', abort) }
    }))
  }

  /**
   * Save the employee revision reviewed in the editor, without changing confirmed plans.
   * @param input - Exact fields and expected prior revision; zero with no id creates an employee.
   * @param signal - Cancellation before committing the record.
   * @returns Saved employee; stale revisions or unavailable provider routes fail without changing the roster.
   */
  @Remote
  saveEmployee(input: EmployeeSaveInput, signal: AbortSignal): Promise<Employee> {
    signal.throwIfAborted()
    const parsed = employeeInput.safeParse(input)
    if (!parsed.success) throw new HarnessError('Enter all employee fields and a valid revision.', 'PROJECT_ROSTER_INPUT')
    const fields = parsed.data
    this.assertRevision(fields.id, fields.expectedRevision)
    if (!this.ctx.llm.listProviders().some(provider => provider.id === fields.provider)) {
      throw new HarnessError('The selected model connection is unavailable. Refresh connections before saving.', 'PROJECT_ROSTER_PROVIDER')
    }
    // The board dispatch path bypasses the tool-subagent allowlist, so enforce
    // the Host policy here (and again at dispatch) before a route is persisted.
    assertEmployeeRouteConfig(this.ctx, fields.provider, fields.model)
    for (const fallback of fields.fallbacks) assertEmployeeRouteConfig(this.ctx, fallback.provider, fallback.model)
    return Promise.resolve(this.store.saveEmployee({
      id: brandString<EmployeeId>(fields.id ?? randomUUID()), revision: fields.expectedRevision + 1,
      name: fields.name, responsibility: fields.responsibility, provider: fields.provider, model: fields.model,
      ...(fields.reasoningEffort === undefined ? {} : { reasoningEffort: fields.reasoningEffort }),
      ...(fields.fallbacks.length === 0 ? {} : { fallbacks: fields.fallbacks }),
      ...(fields.preset === undefined ? {} : { preset: fields.preset }),
    }, fields.expectedRevision))
  }

  /**
   * Save reusable team membership without confirming or starting a project.
   * @param input - Name, distinct existing employee ids and expected prior revision.
   * @param signal - Cancellation before committing the record.
   * @returns Saved team; invalid membership or a stale revision leaves the prior record intact.
   */
  @Remote
  saveTeam(input: TeamSaveInput, signal: AbortSignal): Promise<ProjectTeam> {
    signal.throwIfAborted()
    const parsed = teamInput.safeParse(input)
    if (!parsed.success || new Set(parsed.data.memberIds).size !== parsed.data.memberIds.length) {
      throw new HarnessError('Select distinct employees and enter a team name.', 'PROJECT_ROSTER_INPUT')
    }
    const fields = parsed.data
    this.assertRevision(fields.id, fields.expectedRevision)
    return Promise.resolve(this.store.saveTeam({
      id: brandString<ProjectTeamId>(fields.id ?? randomUUID()), revision: fields.expectedRevision + 1,
      name: fields.name, memberIds: fields.memberIds.map(id => brandString<EmployeeId>(id)),
    }, fields.expectedRevision))
  }

  private assertRevision(id: string | undefined, expectedRevision: number): void {
    if ((id === undefined) !== (expectedRevision === 0)) {
      throw new HarnessError('Create with revision zero and no id, or update with the current saved revision.', 'PROJECT_ROSTER_INPUT')
    }
  }
}
