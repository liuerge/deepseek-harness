/** Out-of-process subagent provider selection for digital employees. */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { externalActivation, externalConnections, isExternalSubagentProvider } from '../src/external-subagent.ts'

/** Build a context whose subagent registry exposes the given providers. */
function ctxWith(providers: Readonly<Record<string, { agentOptions: boolean; provider?: string; model?: string }>>): Context {
  return {
    subagents: {
      getProvider(name: string) {
        const spec = providers[name]
        if (spec === undefined) return undefined
        return {
          name,
          capabilities: { agentOptions: spec.agentOptions, agentPreset: spec.agentOptions, outputSchema: false, depthLimit: false },
          inheritsParentContext: false,
          ...(spec.provider === undefined ? {} : { agentRouteDefaults: { provider: spec.provider, model: spec.model ?? 'default' } }),
        }
      },
    },
  } as unknown as Context
}

describe('external subagent providers', () => {
  const ctx = ctxWith({
    codex: { agentOptions: false, provider: 'codex', model: 'gpt-5' },
    'claude-code': { agentOptions: false },
    spawn: { agentOptions: true },
  })

  it('recognizes only providers that cannot accept agentOptions', () => {
    expect(isExternalSubagentProvider(ctx, 'codex')).toBe(true)
    expect(isExternalSubagentProvider(ctx, 'claude-code')).toBe(true)
    expect(isExternalSubagentProvider(ctx, 'spawn')).toBe(false)
    expect(isExternalSubagentProvider(ctx, 'missing')).toBe(false)
  })

  it('routes an external employee to the subagent provider without model options', () => {
    expect(externalActivation(ctx, 'codex')).toEqual({ provider: 'codex', external: true })
    expect(externalActivation(ctx, 'spawn')).toEqual({ provider: '', external: false })
  })

  it('composes connection entries with the provider-owned model route', () => {
    const connections = externalConnections(ctx)
    expect(connections.map(item => item.id)).toEqual(['codex', 'claude-code'])
    expect(connections[0]?.external).toBe(true)
    expect(connections[0]?.models[0]?.id).toBe('gpt-5')
    expect(connections[1]?.models[0]?.id).toBe('default')
  })

  it('returns no entries when the host exposes no subagent service', () => {
    expect(externalConnections({} as Context)).toEqual([])
    expect(isExternalSubagentProvider({} as Context, 'codex')).toBe(false)
  })
})
