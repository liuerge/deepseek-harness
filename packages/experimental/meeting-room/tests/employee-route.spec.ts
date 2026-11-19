/** Employee model-route resolution: Host allowlist and explicit effort. */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import {
  assertEmployeeRouteConfig, resolveEmployeeFallback, resolveEmployeeRoute,
} from '../src/employee-route.ts'
import type { Employee, EmployeeId } from '../src/types.ts'

/** Minimal Context surface used by the resolver. */
function ctx(allowed?: readonly { provider: string; model: string }[]): Context {
  return {
    subagentModelSelection: allowed === undefined
      ? undefined
      : { allowedRoutes: () => allowed },
  } as unknown as Context
}

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: brandString<EmployeeId>('employee-1'), revision: 1, name: 'Reviewer',
    responsibility: 'Review the artifact.', provider: 'spawn', model: 'mock',
    fallbacks: [], ...overrides,
  }
}

const signal = new AbortController().signal

describe('employee route resolution', () => {
  it('uses the configured route and carries an explicit reasoning effort', () => {
    const route = resolveEmployeeRoute(ctx(), employee({ reasoningEffort: 'high' }), signal)
    expect(route).toMatchObject({ provider: 'spawn', model: 'mock', reasoningEffort: 'high' })
  })

  it('omits the effort when the employee has none configured', () => {
    const route = resolveEmployeeRoute(ctx(), employee(), signal)
    expect(route.reasoningEffort).toBeUndefined()
  })

  it('rejects a primary route outside the Host allowlist', () => {
    expect(() => resolveEmployeeRoute(ctx([{ provider: 'deepseek', model: 'chat' }]),
      employee(), signal)).toThrow(/not in the Host subagent model allowlist/)
  })

  it('accepts a primary route inside the Host allowlist', () => {
    expect(() => { resolveEmployeeRoute(ctx([{ provider: 'spawn', model: 'mock' }]),
      employee(), signal) }).not.toThrow()
  })

  it('treats a disabled Host setting as unrestricted', () => {
    expect(() => { assertEmployeeRouteConfig(ctx(), 'any', 'model') }).not.toThrow()
  })

  it('does not adopt the Host error when the setting is enabled but invalid', () => {
    const host = ctx()
    ;(host as unknown as { subagentModelSelection: { allowedRoutes: () => never } }).subagentModelSelection = {
      allowedRoutes: () => { throw new Error('INVALID_MODEL_SELECTION_SETTINGS') },
    }
    expect(() => { assertEmployeeRouteConfig(host, 'any', 'model') }).not.toThrow()
  })

  it('resolves a fallback candidate by attempt number and preserves the effort', () => {
    const source = employee({
      reasoningEffort: 'low',
      fallbacks: [{ provider: 'spawn', model: 'backup' }, { provider: 'spawn', model: 'last' }],
    })
    expect(resolveEmployeeFallback(ctx(), source, 1, signal))
      .toMatchObject({ provider: 'spawn', model: 'backup', reasoningEffort: 'low' })
    expect(resolveEmployeeFallback(ctx(), source, 2, signal)?.model).toBe('last')
  })

  it('returns undefined when the repair attempt has no configured fallback', () => {
    expect(resolveEmployeeFallback(ctx(), employee(), 1, signal)).toBeUndefined()
  })

  it('rejects a fallback outside the Host allowlist', () => {
    const source = employee({ fallbacks: [{ provider: 'spawn', model: 'backup' }] })
    expect(() => resolveEmployeeFallback(ctx([{ provider: 'spawn', model: 'mock' }]),
      source, 1, signal)).toThrow(/not in the Host subagent model allowlist/)
  })
})
