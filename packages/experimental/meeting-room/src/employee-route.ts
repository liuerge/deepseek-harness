/**
 * Employee model-route resolution.
 *
 * The board dispatches workers through `ctx.subagents.startActivation({ agentOptions })`,
 * which intentionally bypasses the `tool-subagent` tool-argument path. That means the
 * Host's `subagentModelSelection` allowlist does not apply to employee routes unless
 * this module checks it, and a route change silently drops an inherited reasoning
 * effort inside `resolveChildAgentOptions` unless the effort is passed explicitly.
 *
 * The checks here only depend on the public `ctx.llm` surface (listProviders,
 * resolveModelInfo) and the Host-owned `subagentModelSelection` service shape, so no
 * internal `tool-subagent` source path is imported.
 */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/types'
import type { Employee } from './types.ts'

/** Minimal shape of the Host service that authorizes explicit child routes. */
interface ModelSelectionPolicy {
  /** Detached authorized route list, or undefined while Host selection is disabled. */
  allowedRoutes(): readonly AllowedRoute[] | undefined
}

/** One provider/model pair the Host permits for explicit child selection. */
interface AllowedRoute {
  provider: string
  model: string
}

/** Effective model route used for one worker activation. */
export interface EmployeeRoute {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId | undefined
}

/** Reads the Host allowlist without adopting its failure semantics. */
function hostAllowedRoutes(ctx: Context): readonly AllowedRoute[] | undefined {
  let service: ModelSelectionPolicy | undefined
  try {
    const candidate = (ctx as Context & { subagentModelSelection?: unknown }).subagentModelSelection
    // Cordis may expose an unresolved service proxy; only a real allowlist
    // reader counts as an active Host policy.
    service = candidate !== null && typeof candidate === 'object'
      && typeof (candidate as { allowedRoutes?: unknown }).allowedRoutes === 'function'
      ? candidate as ModelSelectionPolicy : undefined
  } catch (_error) {
    return undefined
  }
  if (service === undefined) return undefined
  try {
    return service.allowedRoutes()
  } catch (_error) {
    // An enabled-but-invalid Host setting is a host configuration problem. The
    // board's own policy below still applies; do not surface the Host error here.
    return undefined
  }
}

/** Checks a route against the Host allowlist; a disabled Host setting is unrestricted. */
function assertHostRoute(ctx: Context, route: EmployeeRoute): void {
  const allowed = hostAllowedRoutes(ctx)
  if (allowed === undefined) return
  if (allowed.some(item => item.provider === route.provider && item.model === route.model)) return
  throw new HarnessError(
    `Employee route "${route.provider}/${route.model}" is not in the Host subagent model allowlist.`,
    'PROJECT_EMPLOYEE_ROUTE_NOT_ALLOWED',
  )
}

/** Registered providers only; a configured-but-dormant route cannot dispatch. */
function isRegistered(ctx: Context, provider: string): boolean {
  return ctx.llm.listProviders().some(item => item.id === provider)
}

/**
 * Enumerates the reasoning efforts a concrete model route declares.
 * Returns an empty list when the adapter publishes no reasoning metadata; the
 * caller then omits the effort so the model keeps its own default.
 */
export async function employeeReasoningEfforts(
  ctx: Context, provider: string, model: string, signal: AbortSignal,
): Promise<readonly { id: string; name: string; description?: string }[]> {
  if (!isRegistered(ctx, provider)) return []
  try {
    const info = await ctx.llm.resolveModelInfo(provider, model, signal)
    return info.reasoning?.efforts.map(effort => ({
      id: effort.id, name: effort.name,
      ...(effort.description === undefined ? {} : { description: effort.description }),
    })) ?? []
  } catch (_error) {
    // Catalog lookup is advisory; saving an employee must not depend on it.
    return []
  }
}

/**
 * Resolves the configured route for one employee activation.
 *
 * Authorization is enforced against the Host allowlist; availability is left to
 * `startActivation`, which already reports an unsupported provider/capability and
 * lets the project tick record a failure. An explicit effort is carried here
 * because the subagent runtime clears an inherited effort when the route changes.
 *
 * Fallback routes are retained for the worker's own retry: the project records
 * the configured primary on the checkpoint, and a later repair assignment picks
 * up the next candidate. They are not silently swapped at dispatch, because a
 * confirmed plan captured the employee configuration it reviewed.
 */
export function resolveEmployeeRoute(
  ctx: Context, employee: Employee, signal: AbortSignal,
): EmployeeRoute {
  signal.throwIfAborted()
  const route: EmployeeRoute = {
    provider: employee.provider, model: employee.model,
    ...(employee.reasoningEffort === undefined ? {}
      : { reasoningEffort: brandString<ReasoningEffortId>(employee.reasoningEffort) }),
  }
  assertHostRoute(ctx, route)
  return route
}

/** Resolves a fallback candidate for a repair attempt, preserving the effort. */
export function resolveEmployeeFallback(
  ctx: Context, employee: Employee, attempt: number, signal: AbortSignal,
): EmployeeRoute | undefined {
  signal.throwIfAborted()
  const candidate = (employee.fallbacks ?? [])[attempt - 1]
  if (candidate === undefined) return undefined
  const route: EmployeeRoute = {
    provider: candidate.provider, model: candidate.model,
    ...(employee.reasoningEffort === undefined ? {}
      : { reasoningEffort: brandString<ReasoningEffortId>(employee.reasoningEffort) }),
  }
  assertHostRoute(ctx, route)
  return route
}

/** Validates a configured route at save time so a bad roster cannot be committed. */
export function assertEmployeeRouteConfig(ctx: Context, provider: string, model: string): void {
  assertHostRoute(ctx, { provider, model })
}
