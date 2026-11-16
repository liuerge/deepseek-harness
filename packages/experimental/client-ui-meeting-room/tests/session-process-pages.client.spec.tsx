// @vitest-environment jsdom

/** Process views render actual injected records and keep user actions on the main conversation. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Employee, ProjectPlan, AcceptanceReport } from '@deepseek-ai/dsh-meeting-room/types'
import { SessionMeetings, type MeetingCatalog } from '../src/client/SessionMeetings.tsx'
import { ProjectPage, type ProjectCheckpoint } from '../src/client/ProjectPage.tsx'
import { SessionProjects } from '../src/client/SessionProjects.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it.each([0, 1])('keeps both review generations and routes only authorized repair attempts through the main assistant: %s', (attempt) => {
  const report: AcceptanceReport = { planId: 'plan' as AcceptanceReport['planId'], planRevision: 1, index: 0,
    artifacts: [], passed: false, reviewers: [{ employeeId: 'reviewer' as Employee['id'], sessionId: 'first-review',
      criteria: [{ id: 'AC-1', status: 'fail', notes: 'Initial failure', evidencePaths: [] }] }] }
  const records: ProjectCheckpoint[] = [
    { sessionId: 'main', projectId: 'project', checkpoint: 1, state: 'started', goal: 'Repair delivery',
      tasks: [{ role: 'Author', instruction: 'Repair', acceptance: 'Independent review' }] },
    { sessionId: 'main', projectId: 'project', checkpoint: 1, state: 'task-produced', index: 0,
      childSessionId: 'first-worker', parentSessionId: 'main' },
    { sessionId: 'main', projectId: 'project', checkpoint: 2, state: 'running', index: 0,
      childSessionId: 'repair-worker', parentSessionId: 'main' },
    { sessionId: 'main', projectId: 'project', checkpoint: 2, state: 'acceptance-blocked', index: 0, report },
    { sessionId: 'main', projectId: 'project', checkpoint: 3, state: 'acceptance-blocked', index: 0,
      rework: { attempt, maxAttempts: 1 }, report: { ...report, reviewers: [{ ...report.reviewers[0]!, sessionId: 'second-review',
        criteria: [{ id: 'AC-1', status: 'fail', notes: 'Repair needs another check', evidencePaths: [] }] }] } },
  ]
  const catalog = { records, employees: [], teams: [], plans: [], loading: false, failed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  const continueProject = vi.fn()
  const openWorker = vi.fn()
  const noop = vi.fn()
  render(<ProjectPage {...{ useCatalog, t: makeTranslate(zh), refresh: noop, newProject: noop, configureEmployee: noop,
    configureTeam: noop, delegateTeam: noop, preparePlan: noop, confirmPlan: noop, runPlan: noop, editPlan: noop,
    approveAcceptance: noop, continueProject, openMain: noop, openWorker, adoptPlan: noop } as Parameters<typeof ProjectPage>[0]} />)
  expect(screen.getByText('Initial failure')).toBeTruthy()
  expect(screen.getByText('Repair needs another check')).toBeTruthy()
  const button = screen.getByRole('button', { name: zh['review.rework'] })
  expect(button.hasAttribute('disabled')).toBe(attempt === 1)
  fireEvent.click(button)
  expect(continueProject.mock.calls).toEqual(attempt === 0 ? [['project', 3]] : [])
  fireEvent.click(screen.getByRole('button', { name: zh['project.open-worker'] }))
  expect(openWorker).toHaveBeenCalledWith('main', 'repair-worker')
})

it('separates participant opinions from recorded main-assistant conclusions and opens the exact participant conversation', () => {
  const catalog: MeetingCatalog = { sessionId: 'main', loading: false, failed: false, meetings: [{
    id: 'meeting' as MeetingCatalog['meetings'][number]['id'], sessionId: 'main', originSessionId: 'main',
    requirement: 'Review the delivery requirement', state: 'decided', createdAt: 0,
    rounds: [{ index: 0, role: 'Reviewer', childSessionId: 'participant', stopReason: 'completed', output: 'A participant proposal' }],
    decisions: [{ revision: 1, summary: 'Main assistant conclusion awaiting a project plan', actions: ['Prepare plan draft'] }],
  }] }
  const useMeetings = <S,>(select: (value: MeetingCatalog) => S): S => select(catalog)
  const openParticipant = vi.fn()
  render(<SessionMeetings {...{ useMeetings, t: makeTranslate(zh), refresh: vi.fn(), openMain: vi.fn(),
    prepareMeeting: vi.fn(), openParticipant } as Parameters<typeof SessionMeetings>[0]} />)
  expect(screen.getByText('A participant proposal')).toBeTruthy()
  expect(screen.getByText('Main assistant conclusion awaiting a project plan')).toBeTruthy()
  expect(screen.getByText(zh['meeting.opinions'])).toBeTruthy()
  expect(screen.getByText(zh['meeting.conclusions'])).toBeTruthy()
  fireEvent.click(screen.getByText('Reviewer'))
  fireEvent.click(screen.getByRole('button', { name: zh['project.open-worker'] }))
  expect(openParticipant).toHaveBeenCalledWith('main', 'participant')
})

it('offers an explicit handoff for legacy plans rather than enabling actions with no main-conversation destination', () => {
  const employee: Employee = { id: 'employee' as Employee['id'], revision: 1, name: 'Employee',
    responsibility: 'Deliver', provider: 'mock', model: 'mock' }
  const plan: ProjectPlan = { id: 'legacy-plan' as ProjectPlan['id'], revision: 1, goal: 'Legacy goal', background: [],
    team: { id: 'team' as ProjectPlan['team']['id'], revision: 1, name: 'Team', memberIds: [employee.id] }, employees: [employee],
    tasks: [{ role: 'Author', employeeId: employee.id, instruction: 'Produce artifact', acceptance: 'Read the artifact' }], confirmed: true }
  const catalog = { records: [] as ProjectCheckpoint[], employees: [employee], teams: [plan.team], plans: [plan],
    loading: false, failed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  const adoptPlan = vi.fn()
  const noop = vi.fn()
  render(<ProjectPage {...{ useCatalog, t: makeTranslate(zh), refresh: noop, newProject: noop, configureEmployee: noop,
    configureTeam: noop, delegateTeam: noop, preparePlan: noop, confirmPlan: noop, runPlan: noop, editPlan: noop,
    approveAcceptance: noop, continueProject: noop, openMain: noop, openWorker: noop, adoptPlan } as Parameters<typeof ProjectPage>[0]} />)
  expect(screen.getByRole('button', { name: zh['plan.edit'] }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: zh['plan.run'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh['plan.adopt'] }))
  expect(adoptPlan).toHaveBeenCalledWith('legacy-plan', 1)
})

it('filters existing-catalog project tasks by the exact main conversation and labels production separately from acceptance', () => {
  const records: ProjectCheckpoint[] = [
    { sessionId: 'main', projectId: 'project', checkpoint: 1, state: 'started', goal: 'Main project', tasks: [{ role: 'Writer', instruction: 'Write', acceptance: 'Check' }] },
    { sessionId: 'main', projectId: 'project', checkpoint: 2, state: 'task-produced', index: 0 },
    { sessionId: 'other', projectId: 'other-project', checkpoint: 3, state: 'started', goal: 'Unrelated project' },
  ]
  const catalog = { records, employees: [], teams: [], plans: [], loading: false, failed: false }
  const useCatalog = <S,>(select: (value: typeof catalog) => S): S => select(catalog)
  render(<SessionProjects {...{ sessionId: 'main', useCatalog, t: makeTranslate(zh), refresh: vi.fn(), openWorkspace: vi.fn() } as Parameters<typeof SessionProjects>[0]} />)
  expect(screen.getByText('Main project')).toBeTruthy()
  expect(screen.queryByText('Unrelated project')).toBeNull()
  expect(screen.getByText('已产出 1 / 1 项，产出仍需按约定验收')).toBeTruthy()
})
