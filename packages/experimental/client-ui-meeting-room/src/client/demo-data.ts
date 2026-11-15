/** Sample meeting records shown by the meeting pages before real meetings arrive. */

/** Lifecycle state of one meeting. */
export type MeetingStatus = 'running' | 'awaiting' | 'pending' | 'completed' | 'blocked' | 'paused'

/** Stage of the meeting flow. */
export type MeetingStage = 'independent' | 'discussion' | 'synthesis' | 'final' | 'published'

/** Permission a member holds in one meeting. */
export type MeetingRole = 'host' | 'participant' | 'observer'

/** One member of a meeting. */
export interface MeetingMember {
  /** Display name of the member. */
  readonly name: string
  /** Short label drawn in the member's avatar. */
  readonly initials: string
  /** Permission the member holds. */
  readonly role: MeetingRole
}

/** One meeting as the list shows it. */
export interface MeetingSummary {
  /** Stable identity of the meeting. */
  readonly id: string
  /** Meeting title. */
  readonly title: string
  /** Project the meeting belongs to. */
  readonly project: string
  /** Lifecycle state of the meeting. */
  readonly status: MeetingStatus
  /** Members taking part in the meeting. */
  readonly members: readonly MeetingMember[]
  /** Rounds already run. */
  readonly roundsDone: number
  /** Rounds the meeting plans. */
  readonly roundsTotal: number
  /** Minutes since the meeting was last updated. */
  readonly updatedMinutesAgo: number
  /** Current plan version, absent while no plan exists. */
  readonly planVersion?: string
  /** Review state of the current plan version. */
  readonly planState?: 'draft' | 'pending' | 'done'
}

/** One speech inside a round. */
export interface MeetingSpeech {
  /** Role that answered. */
  readonly role: string
  /** Model that produced the answer. */
  readonly model: string
  /** Minutes before the meeting was last updated. */
  readonly minutesAgo: number
  /** Answer text. */
  readonly text: string
  /** Set when the answer stays hidden until the final review. */
  readonly masked?: boolean
  /** Round and role this answer answers. */
  readonly quote?: string
}

/** One round of a meeting. */
export interface MeetingRound {
  /** Zero-based round position. */
  readonly index: number
  /** Stage this round belongs to. */
  readonly stage: MeetingStage
  /** Answers of this round. */
  readonly speeches: readonly MeetingSpeech[]
}

/** One objection and its verdict. */
export interface MeetingObjection {
  /** The claim under dispute. */
  readonly claim: string
  /** Role that raised the objection. */
  readonly author: string
  /** Verdict recorded for the objection. */
  readonly verdict: string
  /** Evidence the verdict rests on. */
  readonly basis: string
}

/** One delivered file. */
export interface MeetingArtifact {
  /** File name. */
  readonly name: string
  /** File size as shown. */
  readonly size: string
  /** Short checksum shown for verification. */
  readonly checksum: string
}

/** The full record of one meeting. */
export interface MeetingDetail {
  /** Identity of the meeting. */
  readonly id: string
  /** Stage the meeting currently sits in. */
  readonly stage: MeetingStage
  /** Rounds of the meeting, in order. */
  readonly rounds: readonly MeetingRound[]
  /** Read-only material of the meeting. */
  readonly materials: readonly string[]
  /** Plan versions of the meeting, newest first. */
  readonly plans: readonly { readonly version: string; readonly state: 'draft' | 'pending' | 'done' }[]
  /** Members of the meeting. */
  readonly members: readonly MeetingMember[]
  /** Objections and their verdicts. */
  readonly objections: readonly MeetingObjection[]
  /** Delivered files. */
  readonly artifacts: readonly MeetingArtifact[]
  /** Model calls spent against the meeting budget. */
  readonly budget: { readonly used: number; readonly total: number }
}

const LEAD = { name: '主持人', initials: '主', role: 'host' } as const
const PRODUCT = { name: '产品经理', initials: '产', role: 'participant' } as const
const ARCHITECT = { name: '架构师', initials: '架', role: 'participant' } as const
const ENGINEER = { name: '开发工程师', initials: '开', role: 'participant' } as const
const TESTER = { name: '测试工程师', initials: '测', role: 'participant' } as const
const AUDITOR = { name: '审核人', initials: '审', role: 'observer' } as const

/** Meetings the list page shows, newest first. */
export const MEETINGS: readonly MeetingSummary[] = [
  {
    id: 'meeting-room-v1',
    title: '会议室 v1 方案评审',
    project: '会议室产品',
    status: 'running',
    members: [LEAD, PRODUCT, ARCHITECT, ENGINEER, AUDITOR],
    roundsDone: 2,
    roundsTotal: 3,
    updatedMinutesAgo: 12,
    planVersion: 'v0.2',
    planState: 'draft',
  },
  {
    id: 'acceptance-flow',
    title: '任务验收流程设计',
    project: '会议室产品',
    status: 'awaiting',
    members: [LEAD, PRODUCT, ENGINEER, TESTER, AUDITOR],
    roundsDone: 3,
    roundsTotal: 3,
    updatedMinutesAgo: 60,
    planVersion: 'v1.0',
    planState: 'pending',
  },
  {
    id: 'agent-permissions',
    title: 'Agent 权限模型',
    project: '平台能力',
    status: 'pending',
    members: [LEAD, ARCHITECT],
    roundsDone: 0,
    roundsTotal: 3,
    updatedMinutesAgo: 1440,
  },
  {
    id: 'artifact-evidence',
    title: '产物与证据规范',
    project: '平台能力',
    status: 'completed',
    members: [LEAD, PRODUCT, ARCHITECT, ENGINEER, TESTER],
    roundsDone: 3,
    roundsTotal: 3,
    updatedMinutesAgo: 2880,
    planVersion: 'v1.2',
    planState: 'done',
  },
  {
    id: 'budget-quota',
    title: '预算与额度策略',
    project: '平台能力',
    status: 'blocked',
    members: [LEAD, PRODUCT, AUDITOR],
    roundsDone: 1,
    roundsTotal: 3,
    updatedMinutesAgo: 4320,
  },
  {
    id: 'skill-routing',
    title: '技能路由评审',
    project: '会议室产品',
    status: 'paused',
    members: [LEAD, ARCHITECT],
    roundsDone: 2,
    roundsTotal: 3,
    updatedMinutesAgo: 4320,
    planVersion: 'v0.1',
    planState: 'draft',
  },
]

/** Full records of the meetings whose detail page has content. */
export const MEETING_DETAILS: Readonly<Record<string, MeetingDetail>> = {
  'meeting-room-v1': {
    id: 'meeting-room-v1',
    stage: 'discussion',
    rounds: [
      {
        index: 0,
        stage: 'independent',
        speeches: [
          {
            role: '产品经理',
            model: 'DeepSeek-V4.1',
            minutesAgo: 46,
            text: '独立首轮结论：把"一次会议"定义为独立根会话加每角色一轮子代理，首轮互相不可见，终审后才互相可见。',
          },
          {
            role: '架构师',
            model: 'DeepSeek-V4.1',
            minutesAgo: 44,
            text: '',
            masked: true,
          },
          {
            role: '主持人',
            model: 'DeepSeek-V4.1',
            minutesAgo: 42,
            text: '',
            masked: true,
          },
        ],
      },
      {
        index: 1,
        stage: 'discussion',
        speeches: [
          {
            role: '架构师',
            model: 'DeepSeek-V4.1',
            minutesAgo: 14,
            quote: '针对：架构师 · 第 1 轮',
            text: '讨论轮结论：首轮隔离由编排层保证，发言只写会话事件，插件库只存索引与领域状态，两者对得上。',
          },
        ],
      },
    ],
    materials: ['需求.md', '原型-v2.fig', '竞品访谈.txt'],
    plans: [
      { version: 'v0.2', state: 'draft' },
      { version: 'v0.1', state: 'draft' },
    ],
    members: [LEAD, PRODUCT, ARCHITECT, ENGINEER, AUDITOR],
    objections: [
      { claim: '首轮不可见是否等于全程不可见', author: '架构师', verdict: '维持隔离', basis: '终审前公开会破坏独立判断' },
      { claim: '发言落库与会话事件是否重复', author: '开发工程师', verdict: '只存索引', basis: '模型可见的内容以会话日志为准' },
      { claim: '轮次编号由谁维护', author: '测试工程师', verdict: '编排层维护', basis: '轮次顺序由会议状态机决定' },
    ],
    artifacts: [
      { name: '会议室-v1-方案.pdf', size: '412 KB', checksum: '9f2c41ab' },
      { name: '首轮对比表.xlsx', size: '86 KB', checksum: '3d7e0c55' },
    ],
    budget: { used: 12, total: 40 },
  },
  'acceptance-flow': {
    id: 'acceptance-flow',
    stage: 'final',
    rounds: [
      {
        index: 0,
        stage: 'independent',
        speeches: [
          {
            role: '产品经理',
            model: 'DeepSeek-V4.1',
            minutesAgo: 180,
            text: '独立首轮结论：验收要同时看产物指纹和验收记录，缺一不可。',
          },
          {
            role: '测试工程师',
            model: 'DeepSeek-V4.1',
            minutesAgo: 176,
            text: '独立首轮结论：失败要能返工，返工次数进预算。',
          },
        ],
      },
      {
        index: 1,
        stage: 'discussion',
        speeches: [
          {
            role: '开发工程师',
            model: 'DeepSeek-V4.1',
            minutesAgo: 120,
            quote: '针对：测试工程师 · 第 1 轮',
            text: '讨论轮结论：验收记录由插件存储，产物指纹由产物文件自身给出。',
          },
        ],
      },
    ],
    materials: ['验收规范.md', '历史验收记录.csv'],
    plans: [{ version: 'v1.0', state: 'pending' }],
    members: [LEAD, PRODUCT, ENGINEER, TESTER, AUDITOR],
    objections: [
      { claim: '返工是否必须由人确认', author: '审核人', verdict: '按预算额度', basis: '额度内自动，额度外人工' },
    ],
    artifacts: [{ name: '验收流程-v1.0.md', size: '58 KB', checksum: 'c14a77de' }],
    budget: { used: 26, total: 40 },
  },
  'artifact-evidence': {
    id: 'artifact-evidence',
    stage: 'published',
    rounds: [
      {
        index: 0,
        stage: 'independent',
        speeches: [
          {
            role: '开发工程师',
            model: 'DeepSeek-V4.1',
            minutesAgo: 2900,
            text: '独立首轮结论：产物登记要带指纹，指纹来自文件本身。',
          },
        ],
      },
    ],
    materials: ['证据规范.md'],
    plans: [{ version: 'v1.2', state: 'done' }],
    members: [LEAD, PRODUCT, ARCHITECT, ENGINEER, TESTER],
    objections: [],
    artifacts: [{ name: '证据规范-v1.2.md', size: '34 KB', checksum: 'a08b5f31' }],
    budget: { used: 31, total: 40 },
  },
}
