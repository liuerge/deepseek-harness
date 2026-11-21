/** Employee reasoning-effort discovery stays advisory: a failing catalog never blocks a save. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { employeeReasoningEfforts } from '../src/employee-route.ts'

/** Minimal Context surface used by catalog discovery (subset fake, matching employee-route.spec.ts). */
function fakeCtx(providers: readonly { id: string }[], resolveModelInfo?: () => Promise<unknown>): Context {
  return { llm: { listProviders: () => providers, resolveModelInfo } } as unknown as Context
}

const signal = new AbortController().signal

it('returns no efforts for an unregistered provider', async () => {
  await expect(employeeReasoningEfforts(fakeCtx([{ id: 'other' }]), 'missing', 'model', signal)).resolves.toEqual([])
  await expect(employeeReasoningEfforts(fakeCtx([]), 'missing', 'model', signal)).resolves.toEqual([])
})

it('maps declared reasoning efforts, keeping descriptions only when the catalog publishes them', async () => {
  const resolveModelInfo = vi.fn(async () => ({ reasoning: { efforts: [
    { id: 'high', name: 'High', description: 'Deep reasoning' },
    { id: 'low', name: 'Low' },
  ] } }))
  await expect(employeeReasoningEfforts(fakeCtx([{ id: 'vendor' }], resolveModelInfo), 'vendor', 'model', signal))
    .resolves.toEqual([
      { id: 'high', name: 'High', description: 'Deep reasoning' },
      { id: 'low', name: 'Low' },
    ])
})

it('omits efforts when the model publishes none', async () => {
  const resolveModelInfo = vi.fn(async () => ({}))
  await expect(employeeReasoningEfforts(fakeCtx([{ id: 'vendor' }], resolveModelInfo), 'vendor', 'model', signal))
    .resolves.toEqual([])
})

it('returns no efforts when the catalog lookup fails', async () => {
  const resolveModelInfo = vi.fn(async () => { throw new Error('catalog unavailable') })
  await expect(employeeReasoningEfforts(fakeCtx([{ id: 'vendor' }], resolveModelInfo), 'vendor', 'model', signal))
    .resolves.toEqual([])
})
