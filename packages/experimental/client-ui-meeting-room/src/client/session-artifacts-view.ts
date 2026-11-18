/** Register the file-only conversation view using the shared project source and file actions. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { SessionArtifacts, type SessionArtifactsInjected } from './SessionArtifacts.tsx'
import { NS } from './locales.ts'

/**
 * Add a conversation tab backed by project records rather than Session transcript projections.
 * @param ctx - Client owner with conversation and menu services available.
 * @param actions - Shared project read source and exact-revision confirmation.
 */
export function mountSessionArtifacts(ctx: Context, actions: SessionArtifactsInjected): void {
  const t = ctx.locale.bind(NS)
  ctx.uiConversation.views.register({
    target: 'project-artifacts',
    create: () => ({ empty: null, replace: () => null, apply: () => null }),
    isActive: () => false,
  })
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'project-artifacts', order: 20, locale: NS, label: () => t('artifacts.title'),
    inject: (): SessionArtifactsInjected => actions,
  }, SessionArtifacts))
}
