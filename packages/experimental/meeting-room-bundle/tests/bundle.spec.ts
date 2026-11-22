/** The bundle inserts the meeting service and the meeting pages. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const patch = readFileSync(join(import.meta.dirname, '..', 'cordis.patch.yml'), 'utf8')

it('mounts the meeting service and the meeting pages', () => {
  expect(patch).toContain("name: '@deepseek-ai/dsh-experimental-meeting-room'")
  expect(patch).toContain("name: '@deepseek-ai/dsh-experimental-client-ui-meeting-room'")
})
