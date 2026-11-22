/** Preset roster seeding: the reference 软件开发专家团 team, created once per store when its fixed ids are absent. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MeetingStore } from './store.ts'
import type { Employee, EmployeeId, ProjectTeamId } from './types.ts'

/** One discovered Host route used for every preset employee. */
export interface PresetRoute {
  provider: string
  model: string
}

const PRESET_PM_ID = 'preset-pm'
const PRESET_TEAM_ID = 'preset-team-software-delivery'

/** Preset employees of the reference team; instructions follow the team charter's role split. */
const PRESET_EMPLOYEES: { id: string; name: string; description: string; responsibility: string }[] = [
  {
    id: PRESET_PM_ID,
    name: '软件开发专家团 · 项目经理',
    description: '明确目标、拆解任务、协调成员并汇总交付结果。',
    responsibility: '你是软件开发专家团的项目经理，担任团队负责人，负责把用户目标转化为端到端交付：澄清需求、规划依赖、分派专家、核验证据并整合结果。\n\n先明确目标、非目标、约束和验收标准。复用已经确认的事实；缺少关键输入时先解决缺口，不猜测代码位置、接口形状或执行结果。\n\n代码定位、资料调查、环境与依赖核验交给调研员；实现交给全栈工程师；测试与真实交互验收交给测试工程师；独立审查交给代码审查员。不要亲自重复已委派的调查、编码或验证。\n\n按任务规模把风险较高的要求写进验收口径，使验收可执行：结果与对标记录一致时才算通过；受阻时提供可独立执行的补救指引。',
  },
  {
    id: 'preset-researcher',
    name: '软件开发专家团 · 调研员',
    description: '提供事实与技术结论，支撑定位与规划。',
    responsibility: '你是软件开发专家团的调研员，负责提供事实与技术结论：代码定位、资料调查、环境与依赖核验。只陈述有证据的发现，标注来源与不确定性；不做实现改动，不猜测未验证的接口形状。产出直接可供全栈工程师实现与代码审查员判定。',
  },
  {
    id: 'preset-fullstack',
    name: '软件开发专家团 · 全栈工程师',
    description: '按已确认方案实现交付物并完成开发期自检。',
    responsibility: '你是软件开发专家团的全栈工程师，负责按已确认的技术方案实现：在指定交付路径内编写代码与配置，保持最小改动范围。实现前确认输入齐备；完成后运行既定自检并记录真实结果。不做方案外的功能，不修改历史文件，不跳过自检。',
  },
  {
    id: 'preset-tester',
    name: '软件开发专家团 · 测试工程师',
    description: '合并代码验证与真实交互验收并记录证据。',
    responsibility: '你是软件开发专家团的测试工程师，负责合并代码验证和真实交互验收：按验收标准逐项执行检查，记录真实输入、输出与退出码。发现偏差时给出复现步骤与证据；不做实现修改，不放宽验收标准。',
  },
  {
    id: 'preset-reviewer',
    name: '软件开发专家团 · 代码审查员',
    description: '独立检查需求完整性、正确性和影响。',
    responsibility: '你是软件开发专家团的代码审查员，独立检查需求完整性、正确性和影响：对照验收标准逐项核对实现与证据，指出偏差、风险与未覆盖项。不修改交付物；结论必须附检查依据。',
  },
]

/**
 * Seed the preset team and its employees when their fixed ids are absent.
 * Existing records — preset ones the user edited, or teams the user created — are never overwritten.
 * @param store - Durable roster store.
 * @param route - One available Host route applied to every preset employee.
 */
export function seedPresetRoster(store: MeetingStore, route: PresetRoute): void {
  const knownIds = new Set(store.employees().map(employee => employee.id))
  for (const preset of PRESET_EMPLOYEES) {
    if (knownIds.has(brandString<EmployeeId>(preset.id))) continue
    const employee: Employee = {
      id: brandString<EmployeeId>(preset.id), revision: 1, name: preset.name,
      responsibility: preset.responsibility, description: preset.description,
      provider: route.provider, model: route.model,
    }
    store.saveEmployee(employee, 0)
  }
  const teamIds = new Set(store.teams().map(team => team.id))
  if (teamIds.has(brandString<ProjectTeamId>(PRESET_TEAM_ID))) return
  const memberIds = PRESET_EMPLOYEES
    .map(preset => brandString<EmployeeId>(preset.id))
    .filter(id => new Set(store.employees().map(employee => employee.id)).has(id))
  const ownerId = brandString<EmployeeId>(PRESET_PM_ID)
  if (memberIds.length === 0 || !memberIds.includes(ownerId)) return
  store.saveTeam({
    id: brandString<ProjectTeamId>(PRESET_TEAM_ID), revision: 1, name: '软件开发专家团',
    memberIds,
    description: '由项目经理协调调研、全栈开发、质量验证和独立代码审查，完成从需求澄清到验收的软件开发工作。',
    collaborationInstructions: '本团队由项目经理、调研员、全栈工程师、测试工程师和代码审查员组成。项目经理理解目标、规划和协调；调研员提供事实与技术结论；全栈工程师实现；测试工程师合并代码验证和真实交互验收；代码审查员独立检查需求完整性、正确性和影响。\n\n按需求选择必要阶段：纯调查交给调研员；纯审查交给代码审查员；已定位的小改动走实现 → 定向测试；未知或复杂变更走调研 → 规划 → 实现 → 测试验收 → 按风险审查。不要为紧凑流程启动全员；跳过有实际风险的验证时说明原因和未覆盖项。UI 类任务默认沿用既有设计，重构按需而不一次性展开。',
    ownerEmployeeId: ownerId, allowAssignment: true,
  }, 0)
}

/** Minimal Host LLM surface needed to pick a usable route for the preset team. */
export interface PresetRouteSource {
  listProviders(): readonly { readonly id: string }[]
  listModels(provider: string, signal?: AbortSignal): Promise<readonly { readonly id: string }[]>
}

/**
 * Pick the first provider that actually exposes a model. Configurable providers
 * register in bundle order and the first one may be unconfigured (no API key),
 * so every provider is tried on each round until one yields a model.
 * @param llm - Host model directory.
 * @param options - Retry count, delay and cancellation.
 * @returns A usable route, or undefined when no provider exposes a model in time.
 */
export async function findPresetRoute(llm: PresetRouteSource, options: {
  attempts?: number
  delayMs?: number
  signal?: AbortSignal
} = {}): Promise<PresetRoute | undefined> {
  const attempts = options.attempts ?? 10
  const delayMs = options.delayMs ?? 2000
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) return undefined
    for (const provider of llm.listProviders()) {
      if (options.signal?.aborted) return undefined
      const models = await llm.listModels(provider.id, options.signal).catch(() => [])
      const model = models[0]
      if (model === undefined) continue
      return { provider: provider.id, model: model.id }
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
  }
  return undefined
}
