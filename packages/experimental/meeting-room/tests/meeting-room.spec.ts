import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { loadStoredSession } from '../../../subagent/subagent/tests/persistence-helpers.ts'
import { mountLocalActivations } from '../../../subagent/subagent/tests/local-activation.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import MeetingRoom from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

/** Meeting service over the real Agent loop, subagent runtime, and JSONL persistence. */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(MeetingRoom, { provider: 'spawn', agentOptions: { provider: 'mock', model: 'mock' } })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx }
}

/** Concatenate the text blocks of one logged user message. */
function userText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('meeting room', () => {
  it('runs each role in its own child Session and keeps first rounds independent', async () => {
    const { ctx } = await setup([textResponse('产品初稿：先做会议列表'), textResponse('架构初稿：先定会话模型')])

    const meeting = await ctx.meetingRoom.startMeeting({
      requirement: '设计会议室 v1',
      roles: [
        { name: '产品经理', brief: '从用户价值出发给出第一版方案' },
        { name: '架构师', brief: '从系统结构出发给出第一版方案' },
      ],
    })

    expect(meeting.rounds.map(round => round.role)).toEqual(['产品经理', '架构师'])
    expect(meeting.rounds[0]?.output).toContain('产品初稿')
    expect(meeting.rounds[1]?.output).toContain('架构初稿')

    const storedMeeting = await loadStoredSession(ctx.sessionPersistence, meeting.sessionId)
    expect(storedMeeting.events.filter(event => event.type === 'subagent/catalog')).toHaveLength(2)

    const architectRound = meeting.rounds[1]
    if (architectRound === undefined) throw new Error('expected the architect round')
    const storedChild = await loadStoredSession(ctx.sessionPersistence, architectRound.sessionId)
    const prompt = storedChild.events.find(event => event.type === 'user/message')
    if (prompt?.type !== 'user/message') throw new Error('expected the architect prompt in its stored log')
    const architectPrompt = userText(prompt.data.content)

    expect(architectPrompt).toContain('架构师')
    expect(architectPrompt).toContain('设计会议室 v1')
    expect(architectPrompt).not.toContain('产品经理')
    expect(architectPrompt).not.toContain('产品初稿')
    expect(storedChild.meta.parentSession).toBe(meeting.sessionId)
  })
})
