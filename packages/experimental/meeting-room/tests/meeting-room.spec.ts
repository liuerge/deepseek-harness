import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingStore } from '../src/store.ts'
import ApprovalService from '../../../interaction/user-approval/src/index.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
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
const directories: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

/** Meeting service over the real Agent loop, subagent runtime, and JSONL persistence. */
async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  contexts.push(ctx)
  const adapter = new MockAdapter(script)
  const directory = await mkdtemp(join(tmpdir(), 'meeting-room-'))
  directories.push(directory)
  const databasePath = join(directory, 'meetings.sqlite')
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'meeting-test-spawn' })
  await ctx.plugin(MeetingRoom, { provider: 'meeting-test-spawn', agentOptions: { provider: 'mock', model: 'mock' }, databasePath })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, databasePath }
}

/** Concatenate the text blocks of one logged user message. */
function userText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('meeting room', () => {
  it('runs each role in its own child Session and keeps first rounds independent', async () => {
    const { ctx, databasePath } = await setup([textResponse('产品初稿：先做会议列表'), textResponse('架构初稿：先定会话模型')])
    const recordRound = Object.getOwnPropertyDescriptor(MeetingStore.prototype, 'recordRound')?.value as
      | ((this: MeetingStore, ...args: Parameters<MeetingStore['recordRound']>) => void)
      | undefined
    if (recordRound === undefined) throw new Error('expected MeetingStore.recordRound')
    const writes = vi.spyOn(MeetingStore.prototype, 'recordRound').mockImplementation(function (this: MeetingStore, meetingId, round) {
      recordRound.call(this, meetingId, round)
      expect(this.roundsOf(meetingId)).toContainEqual(round)
    })

    const meeting = await ctx.meetingRoom.startMeeting({
      requirement: '设计会议室 v1',
      roles: [
        { name: '产品经理', brief: '从用户价值出发给出第一版方案' },
        { name: '架构师', brief: '从系统结构出发给出第一版方案' },
      ],
    })

    expect(meeting.rounds.map(round => round.role)).toEqual(['产品经理', '架构师'])
    expect(writes).toHaveBeenCalledTimes(2)
    const reopened = new MeetingStore(databasePath)
    try {
      expect(reopened.roundsOf(meeting.sessionId).map(round => round.childSessionId)).toEqual(meeting.rounds.map(round => round.sessionId))
    } finally {
      reopened.close()
    }
    expect(ctx.tools.get('meeting_start')?.name).toBe('meeting_start')
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
    await ctx.fiber.dispose()
    const afterUnload = new MeetingStore(databasePath)
    try {
      expect(afterUnload.roundsOf(meeting.sessionId)).toHaveLength(2)
    } finally {
      afterUnload.close()
    }
  })

  it.each(['rejected', 'allowed-once'] as const)('pairs approval events and honors %s through the tool executor', async (outcome) => {
    const { ctx, databasePath } = await setup([textResponse('approved draft')])
    await ctx.plugin(ApprovalService)
    ctx.on('approval/request', () => Promise.resolve(outcome))
    const caller = await ctx.agents.create({ sessionId: brandString<SessionId>('approval-caller'), agentOptions: { provider: 'mock', model: 'mock' } })
    const writes = vi.spyOn(MeetingStore.prototype, 'recordMeeting')
    const starts = vi.spyOn(ctx.subagents, 'startActivation')
    try {
      caller.agent.session.append('turn/start', { turn: 1 })
      const callId = brandString<ToolCallId>('meeting-approval')
      const batch = await ctx.tools.execute({
        agent: caller.agent,
        signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: callId, name: 'meeting_start', arguments: JSON.stringify({
          requirement: 'Plan a meeting', roles: [{ name: 'Reviewer', brief: 'Review the plan' }],
        }) }],
      })
      const events = caller.agent.session.snapshotEvents()
      const asked = events.find(event => event.type === 'approval/asked')
      const decided = events.find(event => event.type === 'approval/decided')
      expect(asked?.data).toMatchObject({ callId, toolName: 'meeting_start' })
      expect(decided?.data).toMatchObject({ id: asked?.data.id, outcome })
      expect(batch.results[0]?.result.isError).toBe(outcome === 'rejected')
      expect(writes).toHaveBeenCalledTimes(outcome === 'rejected' ? 0 : 1)
      expect(starts).toHaveBeenCalledTimes(outcome === 'rejected' ? 0 : 1)
      if (outcome === 'allowed-once') {
        const meetingId = writes.mock.calls[0]?.[0]
        if (meetingId === undefined) throw new Error('expected a persisted meeting')
        const stored = new MeetingStore(databasePath)
        try {
          expect(stored.roundsOf(meetingId)).toHaveLength(1)
        } finally {
          stored.close()
        }
      }
    } finally {
      await caller.dispose()
    }
  })
})
