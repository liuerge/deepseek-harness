// @vitest-environment jsdom

/** The browser registration contributes the meeting panel, its sidebar entry and its copy. */
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { en, zh } from '../src/client/locales.ts'

it('registers the meeting panel, its sidebar entry and its copy', async () => {
  expect(() => hostApply()).not.toThrow()
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('locale', new LocaleRuntime(runtime.ctx))
  await runtime.declare({
    'main': { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  })
  const handle = await runtime.mount({ inject, apply })

  expect(runtime.slots.entries('main').map(entry => entry.options.key)).toEqual(['meeting-room'])
  const mainEntry = runtime.slots.entries('main')[0]
  const resolve = mainEntry?.inject as (() => { readonly meetings: readonly unknown[] })
  expect(resolve().meetings.length).toBeGreaterThan(0)

  const panels = runtime.slots.entries('sidebar.panellist')
  expect(panels).toHaveLength(1)
  expect(panels[0]?.options.id).toBe('meeting-room')
  const label = panels[0]?.options.label
  expect([zh.panel, en.panel]).toContain(typeof label === 'function' ? label() : label)

  await handle.dispose()
  expect(runtime.slots.entries('main')).toHaveLength(0)
  expect(runtime.slots.entries('sidebar.panellist')).toHaveLength(0)
  await runtime.dispose()
})
