/** Route requirement changes and workflow requests through the retained main conversation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * Prepare an unsent prompt in the exact main conversation without replacing an existing draft.
 * @param ctx - Workspace navigation, Session bindings and conversation editor.
 * @param id - Main conversation selected by the project or meeting record.
 * @param prompt - Localized process request for the user to complete and send.
 * @param unavailable - Localized recovery guidance when the retained editor cannot accept a draft.
 */
export function prepareMainPrompt(ctx: Context, id: string, prompt: string, unavailable: string): void {
  const sessionId = id as SessionId
  ctx.uiWorkspace.openSession(sessionId)
  const binding = ctx.sessions.binding(sessionId)
  if (!binding || ctx.conversation.input.requestDraftInitialization(binding, { prompt, whenDraftExists: 'append' }) === 'blocked') {
    throw new Error(unavailable)
  }
}
