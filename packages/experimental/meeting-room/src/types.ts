/** Durable employee and team records shared by the Host and project client. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of a reusable employee. */
export type EmployeeId = Branded<'ProjectEmployeeId'>
/** Stable identity of a reusable team template. */
export type ProjectTeamId = Branded<'ProjectTeamId'>

/** Conversation-owned planning defaults; confirmed plans retain their independent snapshots. */
export interface SessionTeamSelection {
  /** Compare-and-set revision of the conversation's team preference. */
  revision: number
  /** Captured team template, or null after an explicit clear. */
  team: ProjectTeam | null
  /** Employee revisions captured with this choice; never credential material. */
  employees: Employee[]
}

/** Exact roster versions displayed when choosing a conversation's team. */
export interface SelectSessionTeamInput {
  /** Expected conversation preference revision; zero before any choice. */
  expectedRevision: number
  /** Selected template; null clears the planning defaults. */
  teamId: ProjectTeamId | null
  /** Exact template revision; null when clearing. */
  teamRevision: number | null
  /** Exact employee revisions displayed in the picker; empty when clearing. */
  employees: { id: EmployeeId; revision: number }[]
}

/** Employee fields reviewed in the editor; zero expected revision creates a record without an id. */
export interface EmployeeSaveInput {
  /** Existing identity for updates; omitted on creation. */
  id?: EmployeeId | undefined
  /** Exact prior revision, or zero for creation. */
  expectedRevision: number
  /** Employee display name. */
  name: string
  /** Persistent work instructions. */
  responsibility: string
  /** Registered model connection key. */
  provider: string
  /** Model id, including provider-supported ids absent from its advisory catalog. */
  model: string
  /** Optional reasoning effort the adapter declares for this provider/model. */
  reasoningEffort?: string | undefined
  /** Ordered backup routes, tried when the primary route is unavailable. */
  fallbacks?: { provider: string; model: string }[] | undefined
  /** Optional registered DSH capability composition. */
  preset?: string | undefined
  /** Optional short description shown where the employee is introduced, distinct from the task instruction. */
  description?: string | undefined
}

/** Team template fields reviewed in the editor; membership references existing employees. */
export interface TeamSaveInput {
  /** Existing identity for updates; omitted on creation. */
  id?: ProjectTeamId | undefined
  /** Exact prior revision, or zero for creation. */
  expectedRevision: number
  /** Team display name. */
  name: string
  /** Distinct existing employee ids. */
  memberIds: EmployeeId[]
  /** Optional short description shown at team-selection sites. */
  description?: string | undefined
  /** Optional shared instructions on ordering, priorities and acceptance ownership for the whole team. */
  collaborationInstructions?: string | undefined
  /** Optional leading member who takes tasks directly and coordinates the others; must already be a member. */
  ownerEmployeeId?: EmployeeId | undefined
  /** Whether the team may be assigned work; absence keeps the allow-by-default behavior. */
  allowAssignment?: boolean | undefined
}

/** Active model route and advisory catalog; credentials are not included or certified. */
export interface RosterConnection {
  /** Provider route key used in employee model requests. */
  id: string
  /** Provider display name. */
  name: string
  /** Advertised models with the reasoning efforts each route declares. */
  models: { id: string; name: string; efforts?: { id: string; name: string; description?: string }[] }[]
  /** Whether catalog discovery failed for this route. */
  failed: boolean
}

/** Employee configuration captured when a project run is admitted. */
export interface Employee {
  /** Stable roster identity used by team membership and task assignments. */
  id: EmployeeId
  /** Monotonically increasing configuration revision. */
  revision: number
  /** Human-readable employee name. */
  name: string
  /** Instructions included in every assigned task request. */
  responsibility: string
  /** Model provider configured on this Host. */
  provider: string
  /** Model identifier on that provider. */
  model: string
  /** Explicit adapter reasoning effort; inherited efforts are cleared when the route changes. */
  reasoningEffort?: string | undefined
  /** Ordered backup routes for the same worker, tried before abandoning the task. */
  fallbacks?: { provider: string; model: string }[] | undefined
  /** Registered DSH preset selecting persona, tools and skills. */
  preset?: string | undefined
  /** Short description shown where the employee is introduced; never sent as a task instruction. */
  description?: string | undefined
}

/** Reusable roster membership, resolved to employee revisions at execution start. */
export interface ProjectTeam {
  /** Stable identity used when delegating a project to the team. */
  id: ProjectTeamId
  /** Monotonically increasing membership revision. */
  revision: number
  /** Human-readable team name. */
  name: string
  /** Distinct saved employees eligible for tasks assigned to this team. */
  memberIds: EmployeeId[]
  /** Short description shown at team-selection sites. */
  description?: string | undefined
  /** Shared instructions on ordering, priorities and acceptance ownership for the whole team. */
  collaborationInstructions?: string | undefined
  /** Leading member who takes tasks directly and coordinates the others; always a member when present. */
  ownerEmployeeId?: EmployeeId | undefined
  /** Whether the team may be assigned work; absence keeps the allow-by-default behavior. */
  allowAssignment?: boolean | undefined
}

/** Stable identity of a versioned project plan. */
export type ProjectPlanId = Branded<'ProjectPlanId'>
/** Identity of one admitted project execution. */
export type ProjectExecutionId = Branded<'ProjectId'>

/** Stable identity of one meeting process associated with a main conversation. */
export type MeetingId = Branded<'MeetingId'>

/** Persisted meeting discussion and the main assistant's separately recorded conclusion. */
export interface MeetingRecord {
  /** Business identity, independent of the main conversation identity. */
  id: MeetingId
  /** Conversation whose subagent catalog contains the participants. */
  sessionId: string
  /** Main conversation that initiated the process. */
  originSessionId: string
  /** Shared question supplied to each participant. */
  requirement: string
  /** Discussion completion does not itself confirm a requirement or authorize delivery. */
  state: 'running' | 'awaiting-decision' | 'decided' | 'failed' | 'interrupted'
  /** Creation timestamp in milliseconds. */
  createdAt: number
  /** Participant outputs in configured order. */
  rounds: { index: number; role: string; childSessionId: string; stopReason: string; output: string }[]
  /** Main-assistant conclusion revisions in order; empty until explicitly recorded. */
  decisions: { revision: number; summary: string; actions: string[] }[]
}

/** Reference material retained with the exact plan version reviewed by the user. */
export interface PlanBackground {
  /** Human-readable material title. */
  title: string
  /** URL, file path or decision reference identifying the source. */
  source: string
  /** Relevant source content or a sourced summary to deliver to workers. */
  content: string
}

/** Preconfirmed criteria and intended release policy for one task. */
export interface TaskAcceptance {
  /** Maximum repair executions authorized by the confirmed plan; absence disables repair. */
  rework?: { maxAttempts: number } | undefined
  /** Independent employees assigned to review this task. */
  reviewerIds: EmployeeId[]
  /** Release after all reviewers pass, optionally requiring a workspace user confirmation. */
  release: 'automatic' | 'human'
  /** Explicit UTF-8 files to check within the execution directory; legacy absence requires a new plan revision. */
  artifactPaths?: string[] | undefined
  /** Required inputs that downstream work may consume only after release. */
  downstream: string[]
  /** Distinct, individually verifiable acceptance requirements. */
  criteria: {
    /** Stable reference within this task's plan revision. */
    id: string
    /** Requirement being assessed. */
    description: string
    /** Procedure the reviewers must perform. */
    method: string
    /** Observable pass condition. */
    expected: string
    /** Required files, test results or other evidence. */
    evidence: string
  }[]
}

/** Host-observed version of a UTF-8 artifact checked by reviewers. */
export interface AcceptanceArtifact {
  /** Planned file reference, resolved again to detect alias retargeting. */
  sourcePath: string
  /** Backend canonical process path. */
  path: string
  /** SHA-256 of the filesystem provider's decoded text. */
  sha256: string
}

/** Independently captured criterion results, bound to a plan and artifact versions. */
export interface AcceptanceReport {
  /** Confirmed plan identity. */
  planId: ProjectPlanId
  /** Confirmed plan content revision. */
  planRevision: number
  /** Zero-based task position. */
  index: number
  /** Files observed before and after the review. */
  artifacts: AcceptanceArtifact[]
  /** Whether all configured reviewers supplied every passing criterion with observed reads. */
  passed: boolean
  /** Results from the independent reviewers in configured order. */
  reviewers: {
    /** Captured employee identity. */
    employeeId: EmployeeId
    /** Child Session with actual tools and structured submission. */
    sessionId: string
    /** One entry per configured criterion. */
    criteria: {
      /** Plan-local criterion reference. */
      id: string
      /** Reviewer verdict, downgraded when evidence is missing. */
      status: 'pass' | 'fail' | 'unverifiable'
      /** Explanation and checks actually performed. */
      notes: string
      /** Canonical paths that this reviewer actually read using the read tool. */
      evidencePaths: string[]
    }[]
  }[]
}

/** One ordered work item in a saved plan. */
export interface PlanTask {
  /** Task responsibility within the project. */
  role: string
  /** Employee captured in the plan's employee configurations. */
  employeeId: EmployeeId
  /** Work and expected artifacts. */
  instruction: string
  /** Checks and evidence needed for subsequent acceptance. */
  acceptance: string
  /** Preconfirmed review requirements; absent on legacy plans using final manual review. */
  review?: TaskAcceptance | undefined
}

/** Team shared-task identity recorded by one project association. */
export type ProjectTeamTaskId = Branded<'ProjectTeamTaskId'>

/** Whether a plan run was mirrored onto the Team shared task board when admitted. */
export type ProjectTeamLinkState = 'linked' | 'disabled' | 'unavailable'

/** Durable association between one plan task and its Team shared task. */
export interface ProjectTeamTaskLink {
  /** Execution identity shared by project checkpoints. */
  projectId: ProjectExecutionId
  /** Zero-based task position in the confirmed plan. */
  index: number
  /** Confirmed plan identity. */
  planId: ProjectPlanId
  /** Confirmed plan content revision. */
  planRevision: number
  /** Team task mirrored from this project task. */
  taskId: ProjectTeamTaskId
  /** Latest Team task revision observed by the project. */
  revision: number
  /** Latest Team task status observed by the project. */
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
}

/** Immutable plan content, with confirmation derived from the saved user action. */
export interface ProjectPlan {
  /** Canonical real plan file and decoded-content version; absent on legacy records. */
  document?: { path: string; sha256: string; cwd: string } | undefined
  /** Main conversation that owns planning and user corrections; absent on legacy records. */
  originSessionId?: string | undefined
  /** Stable identity shared by revisions. */
  id: ProjectPlanId
  /** Content revision, advanced on each saved edit. */
  revision: number
  /** Goal reviewed by the user and delivered to workers. */
  goal: string
  /** Sources and background included in worker requests. */
  background: PlanBackground[]
  /** Tasks in execution order. */
  tasks: PlanTask[]
  /** Team identity, membership and revision captured at planning time. */
  team: ProjectTeam
  /** Exact employee configurations approved with this revision. */
  employees: Employee[]
  /** Whether the user confirmed this particular revision. */
  confirmed: boolean
  /** Admitted execution, when this plan revision has already been started. */
  executionId?: ProjectExecutionId | undefined
}
