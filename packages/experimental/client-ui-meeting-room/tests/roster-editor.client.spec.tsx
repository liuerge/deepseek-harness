// @vitest-environment jsdom

/** Editor tests cover independent routing, retained drafts and explicit reusable membership. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Employee } from '@deepseek-ai/dsh-experimental-meeting-room/types'
import { RosterEditor } from '../src/client/RosterEditor.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('identifies an employee’s unavailable saved connection while retaining the available connection choices', () => {
  const employee: Employee = { id: 'removed-route-worker' as Employee['id'], revision: 2, name: 'Author',
    responsibility: 'Deliver files.', provider: 'removed-route', model: 'saved-model' }
  render(<RosterEditor employees={[employee]} teams={[]} connections={[
    { id: 'available-route', name: 'Available', models: [], failed: false },
  ]} connectionsLoading={false} connectionsFailed={false} loading={false}
  saveEmployee={vi.fn()} saveTeam={vi.fn()} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.edit-employee'] }))
  expect(screen.getByRole('alert').textContent).toBe(zh['roster.connection-missing'])
  expect(screen.queryByText(zh['roster.no-connections'])).toBeNull()
  expect(screen.getByRole('option', { name: 'Available · available-route' })).toBeTruthy()
  expect(screen.getByDisplayValue('saved-model')).toBeTruthy()
  expect(screen.getByRole('button', { name: zh['roster.save'] }).hasAttribute('disabled')).toBe(true)
})

it('retains a failed employee draft and saves its explicit connection and custom model without delegation', async () => {
  const saveEmployee = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const delegateTeam = vi.fn()
  render(<RosterEditor employees={[]} teams={[]} connections={[
    { id: 'vendor-a', name: 'Vendor A', models: [{ id: 'a-model', name: 'A model' }], failed: false },
    { id: 'vendor-b', name: 'Vendor B', models: [], failed: false },
  ]} connectionsLoading={false} connectionsFailed={false} loading={false}
  saveEmployee={saveEmployee} saveTeam={vi.fn()} delegateTeam={delegateTeam} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.employee'] }))
  fireEvent.change(screen.getByLabelText(zh['roster.name']), { target: { value: 'Reviewer' } })
  fireEvent.change(screen.getByLabelText(zh['roster.responsibility']), { target: { value: 'Inspect actual evidence.' } })
  fireEvent.change(screen.getByLabelText(zh['roster.connection']), { target: { value: 'vendor-b' } })
  fireEvent.change(screen.getByLabelText(zh['roster.model']), { target: { value: 'private-model' } })
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await screen.findByRole('alert')
  expect(screen.getByDisplayValue('private-model')).toBeTruthy()
  expect(saveEmployee).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 0,
    provider: 'vendor-b', model: 'private-model', name: 'Reviewer' }))
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await waitFor(() => { expect(screen.queryByLabelText(zh['roster.model'])).toBeNull() })
  expect(delegateTeam).not.toHaveBeenCalled()
})

it('keeps employee versions when editing and requires explicit team members', async () => {
  const employee: Employee = { id: 'employee-a' as Employee['id'], revision: 7, name: 'Author',
    responsibility: 'Deliver files.', provider: 'vendor-a', model: 'a-model' }
  const saveEmployee = vi.fn(async () => true)
  const saveTeam = vi.fn(async () => true)
  render(<RosterEditor employees={[employee]} teams={[]} connections={[
    { id: 'vendor-a', name: 'Vendor A', models: [], failed: false },
  ]} connectionsLoading={false} connectionsFailed={false} loading={false}
  saveEmployee={saveEmployee} saveTeam={saveTeam} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.edit-employee'] }))
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await waitFor(() => { expect(saveEmployee).toHaveBeenCalledWith(expect.objectContaining({ id: employee.id, expectedRevision: 7 })) })
  await waitFor(() => { expect(screen.queryByLabelText(zh['roster.model'])).toBeNull() })
  fireEvent.click(screen.getByRole('button', { name: zh['roster.team'] }))
  fireEvent.change(screen.getByLabelText(zh['roster.name']), { target: { value: 'Delivery team' } })
  expect(screen.getByRole('button', { name: zh['roster.save'] }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: zh['roster.save'] }))
  await waitFor(() => { expect(saveTeam).toHaveBeenCalledWith({ expectedRevision: 0, name: 'Delivery team', memberIds: [employee.id] }) })
})

it('shows the native-auth hint when an out-of-process subagent connection is selected', () => {
  render(<RosterEditor employees={[]} teams={[]} connections={[
    { id: 'codex', name: 'codex', models: [{ id: 'default', name: 'Provider default' }], failed: false, external: true },
  ]} connectionsLoading={false} connectionsFailed={false} loading={false}
  saveEmployee={vi.fn()} saveTeam={vi.fn()} delegateTeam={vi.fn()} t={makeTranslate(zh)} />)
  fireEvent.click(screen.getByRole('button', { name: zh['roster.employee'] }))
  fireEvent.change(screen.getByLabelText(zh['roster.connection']), { target: { value: 'codex' } })
  expect(screen.getByText(zh['roster.external-hint'])).toBeTruthy()
})
