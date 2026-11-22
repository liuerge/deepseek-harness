/**
 * Out-of-process subagent providers (e.g. Codex and Claude Code) usable as
 * digital-employee execution engines.
 *
 * These providers are registered through `ctx.subagents`, not `ctx.llm`, and
 * declare `capabilities.agentOptions === false`: they own their model route and
 * must be started without `agentOptions` or `agentPreset`. The project board
 * normally dispatches through `ctx.subagents.startActivation({ agentOptions })`,
 * so this module centralizes the decision that switches such an employee to a
 * direct external-provider activation.
 *
 * Only public Host surfaces are used (`ctx.subagents.getProvider`). No base
 * package is modified, and no concrete provider id is hard-coded: any
 * registered provider without the `agentOptions` capability is eligible.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RosterConnection } from './types.ts'

/** Minimal shape of a registered out-of-process subagent provider we consume. */
interface ExternalProviderView {
  readonly name: string
  readonly capabilities: { readonly agentOptions: boolean }
  readonly agentRouteDefaults?: Readonly<{ provider: string; model: string }> | undefined
}

/** Read a registered subagent provider without depending on its concrete class. */
function externalProvider(ctx: Context, id: string): ExternalProviderView | undefined {
  const subagents = (ctx as Context & {
    subagents?: { getProvider(name: string): unknown }
  }).subagents
  if (subagents === undefined || typeof subagents.getProvider !== 'function') return undefined
  try {
    const provider = subagents.getProvider(id)
    if (provider === null || typeof provider !== 'object') return undefined
    const view = provider as Partial<ExternalProviderView>
    if (typeof view.name !== 'string' || view.capabilities === undefined
      || typeof view.capabilities.agentOptions !== 'boolean') return undefined
    // agentOptions === false is the defining trait: the provider owns its route.
    return view.capabilities.agentOptions === false ? view as ExternalProviderView : undefined
  } catch (_error) {
    return undefined
  }
}

/** Whether an employee provider id names a registered out-of-process subagent provider. */
export function isExternalSubagentProvider(ctx: Context, provider: string): boolean {
  return externalProvider(ctx, provider) !== undefined
}

/**
 * Build the activation overrides for one worker route.
 * @returns provider id plus whether model/preset options must be omitted.
 */
export function externalActivation(ctx: Context, provider: string): {
  provider: string
  external: boolean
} {
  const view = externalProvider(ctx, provider)
  return view === undefined
    ? { provider: '', external: false }
    : { provider: view.name, external: true }
}

/**
 * Compose connection catalog entries for registered out-of-process providers so
 * the roster editor can select them like ordinary model connections. The model
 * list is advisory: a provider with a fixed route advertises that route, others
 * expose a single editable slot.
 */
export function externalConnections(ctx: Context): RosterConnection[] {
  const subagents = (ctx as Context & {
    subagents?: { getProvider(name: string): unknown }
  }).subagents
  if (subagents === undefined || typeof subagents.getProvider !== 'function') return []
  // Known external provider ids from the official experimental bundles. Enumeration
  // uses a fixed candidate set because the public subagent service exposes lookup by
  // name only; a provider is included iff it is actually registered and external.
  const candidates = ['codex', 'claude-code']
  const result: RosterConnection[] = []
  for (const id of candidates) {
    const view = externalProvider(ctx, id)
    if (view === undefined) continue
    const fixed = view.agentRouteDefaults
    const models = fixed === undefined
      ? [{ id: 'default', name: 'Provider default' }]
      : [{ id: fixed.model, name: fixed.model }]
    result.push({ id: view.name, name: view.name, models, failed: false, external: true })
  }
  return result
}
