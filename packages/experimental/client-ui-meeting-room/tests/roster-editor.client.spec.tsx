// @vitest-environment jsdom

/** Editor tests cover independent routing, retained drafts and explicit reusable membership. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { Employee } from '@deepseek-ai/dsh-meeting-room/types'
import { RosterEditor } from '../src/client/RosterEditor.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

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
