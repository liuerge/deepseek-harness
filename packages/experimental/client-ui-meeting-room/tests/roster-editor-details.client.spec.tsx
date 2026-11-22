// @vitest-environment jsdom

/** Roster editor details: fallback parsing, effort selection, saved-team cards and membership edits. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Employee, ProjectTeam } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import { RosterEditor } from '../src/client/RosterEditor.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const author: Employee = { id: 'author' as Employee['id'], revision: 3, name: 'Author',
  responsibility: 'Develop.', provider: 'vendor-a', model: 'm1' }
const reviewer: Employee = { id: 'reviewer' as Employee['id'], revision: 2, name: 'Reviewer',
  responsibility: 'Verify.', provider: 'vendor-b', model: 'm2' }

const connections = [
  { id: 'vendor-a', name: 'Vendor A', models: [{ id: 'm1', name: 'M one', efforts: [{ id: 'high', name: 'High' }] }], failed: false },
  { id: 'vendor-b', name: 'Vendor B', models: [{ id: 'm2', name: 'M two' }], failed: false },
]

const savedTeam: ProjectTeam = { id: 'team' as ProjectTeam['id'], revision: 2, name: 'Delivery',
  memberIds: [author.id, reviewer.id], description: 'Team description', collaborationInstructions: '协作指令',
  ownerEmployeeId: author.id, allowAssignment: false }

it('parses multiline fallbacks, selects a declared effort and retains a rejected save', async () => {
  const saveEmployee = vi.fn().mockRejectedValueOnce(new Error('stale'))
    .mockImplementationOnce(async () => true)
  render(<RosterEditor employees={[author]} teams={[]} connections={connections}
    connectionsLoading={false} connectionsFailed={false} loading={false}
    saveEmployee={saveEmployee} saveTeam={vi.fn(async () => true)} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.employee'] }))
  fireEvent.change(screen.getByLabelText(zh['roster.name']), { target: { value: 'Builder' } })
  fireEvent.change(screen.getByLabelText(zh['roster.description']), { target: { value: '说明文字' } })
  fireEvent.change(screen.getByLabelText(zh['roster.responsibility']), { target: { value: '开发并交付' } })
  fireEvent.change(screen.getByLabelText(zh['roster.connection']), { target: { value: 'vendor-a' } })
  fireEvent.change(screen.getByLabelText(new RegExp(zh['roster.model'])), { target: { value: 'm1' } })
  // The catalog declares one reasoning effort for this model.
  const effort = screen.getByLabelText('M one')
  fireEvent.change(effort, { target: { value: 'high' } })
  fireEvent.change(screen.getByLabelText(zh['roster.fallbacks']), { target: { value: 'vendor-b/m2\nplain' } })
  fireEvent.change(screen.getByLabelText(zh['roster.preset']), { target: { value: '预置' } })
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await screen.findByRole('alert')
  expect(screen.getByText(zh['roster.save-failed'])).toBeTruthy()
  // The draft survives the failure and saves with parsed routes.
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await waitFor(() => { expect(screen.queryByLabelText(new RegExp(zh['roster.model']))).toBeNull() })
  expect(saveEmployee).toHaveBeenLastCalledWith(expect.objectContaining({
    name: 'Builder', description: '说明文字', reasoningEffort: 'high', preset: '预置',
    fallbacks: [{ provider: 'vendor-b', model: 'm2' }, { provider: 'plain', model: '' }],
  }))
})

it('cancels an employee draft without saving', async () => {
  const saveEmployee = vi.fn(async () => true)
  render(<RosterEditor employees={[author]} teams={[]} connections={connections}
    connectionsLoading={false} connectionsFailed={false} loading={false}
    saveEmployee={saveEmployee} saveTeam={vi.fn(async () => true)} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.employee'] }))
  fireEvent.click(screen.getByRole('button', { name: zh['roster.cancel'] }))
  await waitFor(() => { expect(screen.queryByLabelText(zh['roster.model'])).toBeNull() })
  expect(saveEmployee).not.toHaveBeenCalled()
})

it('renders saved teams with owner chips, model chains, membership edits and delegation', async () => {
  const delegateTeam = vi.fn()
  const saveTeam = vi.fn(async () => true)
  render(<RosterEditor employees={[author, reviewer]} teams={[savedTeam]} connections={connections}
    connectionsLoading={false} connectionsFailed={false} loading={false}
    saveEmployee={vi.fn(async () => true)} saveTeam={saveTeam} delegateTeam={delegateTeam} t={makeTranslate(zh)} />)
  // Card body carries the saved notes, owner marker, disabled assignment and route chain.
  expect(screen.getByText('Team description')).toBeTruthy()
  expect(screen.getByText('协作指令')).toBeTruthy()
  expect(screen.getByText(zh['roster.assignment-disabled'])).toBeTruthy()
  expect(screen.getAllByText(zh['roster.owner']).length).toBeGreaterThan(0)
  expect(screen.getByText('m2')).toBeTruthy()
  // Collapse and re-expand the member list.
  fireEvent.click(screen.getByRole('button', { name: zh['roster.collapse-team'] }))
  expect(screen.getByRole('button', { name: zh['roster.expand-team'] })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh['roster.expand-team'] }))
  expect(screen.getByRole('button', { name: zh['roster.collapse-team'] })).toBeTruthy()
  // Delegate and edit actions target the exact team.
  fireEvent.click(screen.getByRole('button', { name: zh['roster.delegate'] }))
  expect(delegateTeam).toHaveBeenCalledWith('team')
  fireEvent.click(screen.getByRole('button', { name: zh['roster.edit-team'] }))
  expect(screen.getByLabelText(zh['roster.name'])).toBeTruthy()
  fireEvent.change(screen.getByLabelText(zh['roster.team-description']), { target: { value: '新描述' } })
  fireEvent.change(screen.getByLabelText(zh['roster.collaboration']), { target: { value: '新协作' } })
  const owner = screen.getByLabelText(zh['roster.owner']) as HTMLSelectElement
  fireEvent.change(owner, { target: { value: reviewer.id } })
  fireEvent.click(screen.getByRole('switch', { name: zh['roster.allow-assignment'] }))
  const checkboxes = screen.getAllByRole('checkbox')
  fireEvent.click(checkboxes[0]!)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await waitFor(() => { expect(saveTeam).toHaveBeenCalledWith(expect.objectContaining({
    ownerEmployeeId: reviewer.id, allowAssignment: true, memberIds: [reviewer.id],
    description: '新描述', collaborationInstructions: '新协作' })) })
})

it('cancels a team draft without saving', async () => {
  const saveTeam = vi.fn(async () => true)
  render(<RosterEditor employees={[author]} teams={[savedTeam]} connections={connections}
    connectionsLoading={false} connectionsFailed={false} loading={false}
    saveEmployee={vi.fn(async () => true)} saveTeam={saveTeam} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.edit-team'] }))
  fireEvent.click(screen.getByRole('button', { name: zh['roster.cancel'] }))
  await waitFor(() => { expect(screen.queryByLabelText(zh['roster.owner'])).toBeNull() })
  expect(saveTeam).not.toHaveBeenCalled()
})
