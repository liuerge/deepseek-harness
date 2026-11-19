/** Feature-local status chip: a shared state dot plus localized text, with no filled background. */
import { StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import css from './StatusChip.module.css'

/**
 * Map a project execution state or an acceptance verdict to a state-dot tone.
 * Additional aliases cover the actual checkpoint state keys and criterion verdicts.
 * @param state - raw execution state or acceptance verdict.
 * @returns the matching state-dot tone; unknown values stay idle.
 */
export function statusTone(state: string): StateDotState {
  switch (state) {
    case 'passed': case 'completed': case 'confirmed': case 'released':
    case 'acceptance-passed': case 'pass':
      return 'done'
    case 'awaiting-human': case 'awaiting-acceptance': case 'awaiting-review':
    case 'awaiting-direction': case 'draft': case 'unverifiable':
      return 'warning'
    case 'running': case 'starting': case 'started': case 'reviewing':
    case 'resuming': case 'reworking': case 'reviewer-produced':
      return 'ongoing'
    case 'blocked': case 'failed': case 'acceptance-blocked': case 'interrupted': case 'fail':
      return 'error'
    default:
      return 'idle'
  }
}

/**
 * Render a state dot beside localized status text; the chip carries no background block.
 * @param props.tone - state-dot tone, derived with {@link statusTone} from a state value.
 * @param props.children - localized status label owned by the render site.
 * @returns an inline status chip.
 */
export function StatusChip({ tone, children }: { tone: StateDotState; children: ReactNode }) {
  return <span className={css.chip}><StateDot state={tone} className={css.dot} />{children}</span>
}
