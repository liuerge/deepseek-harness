import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import { mountLocalActivations, startTestActivation as start } from '../../../subagent/subagent/tests/local-activation.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as spawn from '../../../subagent/subagent-spawn-in-process/src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/**
 * Meeting spike: two role rounds under one parent session, with durable session
 * logs, must not leak the first role's draft into the second round.
 */
async function setup(script: Script) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(brandString<SessionId>('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

/** Concatenate the text blocks of one logged user message. */
function userText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('meeting spike: independent first rounds', () => {
  it('gives the second role only its own prompt, and both rounds survive a log reload', async () => {
    const { ctx, parent } = await setup([textResponse('A 初稿：方案甲'), textResponse('B 初稿：方案乙')])

    const first = await start(ctx, 'spawn', { prompt: [{ type: 'text', text: '角色A：独立提出方案' }], parent })
    await first.result

    const second = await start(ctx, 'spawn', { prompt: [{ type: 'text', text: '角色B：独立提出方案' }], parent })
    await second.result

    const storedSecond = await loadStoredSession(ctx.sessionPersistence, second.id)
    const storedPrompt = storedSecond.events.find(event => event.type === 'user/message')
    if (storedPrompt?.type !== 'user/message') throw new Error('expected the second role prompt in its stored log')
    const secondPrompt = userText(storedPrompt.data.content)

    expect(secondPrompt).toContain('角色B')
    expect(secondPrompt).not.toContain('A 初稿')
    expect(secondPrompt).not.toContain('角色A')

    const storedFirst = await loadStoredSession(ctx.sessionPersistence, first.id)
    expect(storedFirst.events.some(event => event.type === 'user/message')).toBe(true)
    expect(storedSecond.meta.parentSession).toBe(parent.session.header.id)

    const catalog = parent.session.snapshotEvents().filter(event => event.type === 'subagent/catalog')
    expect(catalog).toHaveLength(2)

    await first.dispose()
    await second.dispose()
  })
})
