/** Roster field additions stay compatible with legacy rows and round-trip through the store. */
import { describe, expect, test } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { MeetingStore } from '../src/store.ts'
import { employeeSchema, teamSchema } from '../src/roster.ts'
import type { Employee, EmployeeId, ProjectTeam, ProjectTeamId } from '../src/types.ts'

describe('roster field additions', () => {
  test('legacy employee JSON without the new optional fields stays readable', () => {
    const legacy = JSON.stringify({
      id: 'emp-1', revision: 1, name: '开发员工', responsibility: '编写交付物',
      provider: 'opencode-go', model: 'deepseek-v4.1-flash',
    })
    const parsed = employeeSchema.parse(JSON.parse(legacy))
    expect(parsed.description).toBeUndefined()
    expect(parsed.name).toBe('开发员工')
  })

  test('legacy team JSON without description, owner or assignment switch stays readable', () => {
    const legacy = JSON.stringify({
      id: 'team-1', revision: 1, name: '交付团队', memberIds: ['emp-1', 'emp-2'],
    })
    const parsed = teamSchema.parse(JSON.parse(legacy))
    expect(parsed.description).toBeUndefined()
    expect(parsed.ownerEmployeeId).toBeUndefined()
    expect(parsed.allowAssignment).toBeUndefined()
    expect(parsed.memberIds).toHaveLength(2)
  })

  test('a team owner outside the membership is rejected', () => {
    const team = {
      id: 'team-1', revision: 1, name: '交付团队', memberIds: ['emp-1'],
      ownerEmployeeId: 'emp-2',
    }
    expect(() => teamSchema.parse(team)).toThrow(/owner/)
  })

  test('new team and employee fields round-trip through the store', () => {
    const store = new MeetingStore(':memory:')
    const employee: Employee = {
      id: brandString<EmployeeId>('emp-1'), revision: 1, name: '开发员工', responsibility: '写代码',
      provider: 'opencode-go', model: 'deepseek-v4.1-flash', description: '负责实现规则模块',
    }
    store.saveEmployee(employee, 0)
    expect(store.employees()[0]?.description).toBe('负责实现规则模块')
    const team: ProjectTeam = {
      id: brandString<ProjectTeamId>('team-1'), revision: 1, name: '交付团队',
      memberIds: [brandString<EmployeeId>('emp-1')], description: '按计划交付',
      collaborationInstructions: '开发先行，验收收尾', ownerEmployeeId: brandString<EmployeeId>('emp-1'),
      allowAssignment: false,
    }
    store.saveTeam(team, 0)
    const saved = store.teams()[0]
    expect(saved?.description).toBe('按计划交付')
    expect(saved?.collaborationInstructions).toBe('开发先行，验收收尾')
    expect(saved?.ownerEmployeeId).toBe(brandString<EmployeeId>('emp-1'))
    expect(saved?.allowAssignment).toBe(false)
  })

  test('employees saved without the new fields read back without them', () => {
    const store = new MeetingStore(':memory:')
    store.saveEmployee({
      id: brandString<EmployeeId>('emp-1'), revision: 1, name: '测试员工', responsibility: '验收',
      provider: 'opencode-go', model: 'minimax-m3',
    }, 0)
    const employee = store.employees()[0]
    expect(employee?.description).toBeUndefined()
  })
})
