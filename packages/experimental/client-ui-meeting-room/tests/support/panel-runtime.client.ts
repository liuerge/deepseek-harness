// @vitest-environment jsdom

/** Shared browser-plugin mount used by the registration and session-view specs. */
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { vi, type Mock } from 'vitest'
import * as browserPlugin from '../../src/client/index.ts'
import type { ProjectInjected } from '../../src/client/ProjectPage.tsx'
import type { RosterInjected } from '../../src/client/RosterPanel.tsx'
import type { SessionMeetingsInjected } from '../../src/client/SessionMeetings.tsx'
import type { MenuContribution } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { RosterConnection } from '@deepseek-ai/dsh-experimental-meeting-room/types'

/** Overridable remote handlers and services for one mounted panel runtime. */
export interface PanelOptions {
  timeline?: Mock
  plans?: Mock
  roster?: Mock
  meetings?: Mock
  connections?: Mock
  confirmPlan?: Mock
  readProjectArtifact?: Mock
  saveEmployee?: Mock
  saveTeam?: Mock
  initialize?: Mock
}

/** One mounted panel runtime with its project, roster and meeting injections. */
export interface MountedPanel {
  runtime: SlotTestRuntime
  handle: { dispose(): Promise<void> }
  project: Record<string, unknown> & ProjectInjected
  rosterFace: Record<string, unknown> & RosterInjected
  meetingFace: Record<string, unknown> & SessionMeetingsInjected
  openSession: Mock
  initialize: Mock
  selectPanel: Mock
  notify: Mock
  startSession: Mock
  menus: MenuContribution<'sessionHeader'>[]
  timeline: Mock
  meetings: Mock
}

/** Mount the browser plugin with the remote namespaces and services the panels need. */
export async function mountPanel(options: PanelOptions = {}): Promise<MountedPanel> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  const openSession = vi.fn()
  const initialize = options.initialize ?? vi.fn(() => 'applied' as const)
  const selectPanel = vi.fn()
  const notify = vi.fn()
  const startSession = vi.fn()
  runtime.ctx.provide('uiWorkspace', { startSession, openSession } as never)
  runtime.ctx.provide('conversation', { input: { requestDraftInitialization: initialize } } as never)
  runtime.ctx.provide('layout', { selectPanel } as never)
  runtime.ctx.provide('uiConversation', { views: { register: vi.fn() } } as never)
  const menus: MenuContribution<'sessionHeader'>[] = []
  runtime.ctx.provide('contextMenus', { notify, register: (menu: MenuContribution<'sessionHeader'>) => {
    menus.push(menu)
    return () => { menus.splice(menus.indexOf(menu), 1) }
  } } as never)
  vi.spyOn(runtime.ctx.sessions, 'binding').mockReturnValue({ sessionId: 'main-root' } as never)
  const timeline = options.timeline ?? vi.fn(async () => ({ ok: true as const, value: [
    { sessionId: 'main-root', projectId: 'run-1', state: 'running', checkpoint: 2, index: 0, goal: 'Delivery goal' },
  ] }))
  const meetings = options.meetings ?? vi.fn(async () => ({ ok: true as const, value: [] }))
  const roster = options.roster ?? vi.fn(async () => ({ ok: true as const, value: { employees: [], teams: [] } }))
  const plans = options.plans ?? vi.fn(async () => ({ ok: true as const, value: [{
    id: 'plan-1', revision: 3, goal: 'Delivery goal', executionId: 'run-1', confirmed: true,
    background: [], team: { id: 'team', revision: 1, name: 'Team', memberIds: [] }, employees: [], tasks: [],
  }] }))
  runtime.remote.provideNamespaces({
    projectRoster: {
      connections: options.connections ?? vi.fn(async () => ({ ok: true as const, value: [] as RosterConnection[] })),
      saveEmployee: options.saveEmployee ?? vi.fn(async () => ({ ok: true as const, value: {} })),
      saveTeam: options.saveTeam ?? vi.fn(async () => ({ ok: true as const, value: {} })),
    },
    projectDashboard: {
      timeline, follow: async function* (signal: AbortSignal) {
        yield true
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      },
      plans, roster, meetings,
      confirmPlan: options.confirmPlan ?? vi.fn(async () => ({ ok: true as const, value: {} })),
      confirmAcceptance: vi.fn(async () => ({ ok: true as const, value: { projectId: 'run-1' } })),
      readProjectArtifact: options.readProjectArtifact ?? vi.fn(async () => ({ ok: true as const, value: { path: 'p', content: 'text' } })),
      resolveProjectArtifact: vi.fn(async () => ({ ok: true as const, value: { path: 'p' } })),
      stopExecution: vi.fn(async () => ({ ok: true as const, value: { cancelled: true } })),
    },
    projectTeamContext: { current: vi.fn(async () => ({ ok: true as const, value: { revision: 0, team: null, employees: [] } })) },
    agentTeams: { setEnabled: vi.fn(async () => ({ ok: true as const, value: undefined })) },
    session: {
      openWorkspacePath: vi.fn(async () => ({ ok: true as const, value: { opened: true } })),
    },
  })
  vi.spyOn(runtime.ctx.remote, '$mount').mockResolvedValue(async () => {})
  await runtime.declare({
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'conversation.session.panel.section': { kind: 'list', scope: 'session' },
    'conversation.session.panel.section.actions': { kind: 'keyed', scope: 'session' },
    'conversation.view': { kind: 'list', scope: 'session' },
    'conversation.hero.options': { kind: 'list', scope: 'session' },
    'conversation.input.model.options': { kind: 'list', scope: 'session' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
  })
  const handle = await runtime.mount(browserPlugin)
  runtime.ctx.locale.setLocale('zh')
  const inject = (key: string): Record<string, unknown> | undefined =>
    runtime.slots.entries('main').find(entry => entry.options.key === key)?.inject?.()
  const project = inject('project-workspace') as (Record<string, unknown> & ProjectInjected) | undefined
  const rosterFace = inject('project-roster') as (Record<string, unknown> & RosterInjected) | undefined
  const meetingFace = inject('meeting-room') as (Record<string, unknown> & SessionMeetingsInjected) | undefined
  if (!project || !rosterFace || !meetingFace) throw new Error('Expected panel injections')
  return { runtime, handle, project, rosterFace, meetingFace, openSession, initialize, selectPanel, notify,
    startSession, menus, timeline, meetings }
}
