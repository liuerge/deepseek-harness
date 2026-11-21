/** Initial-letter avatar shared by the roster editor and the workbench task rows. */
import css from './RosterAvatar.module.css'

/** Number of avatar tints; the CSS module maps each tone index to one hue. */
const AVATAR_TONES = 6

/** Maps an id to a stable avatar tone index, so one employee keeps one color everywhere. */
export function avatarTone(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return hash % AVATAR_TONES
}

/**
 * Render an initial-letter avatar with a stable per-id tint.
 * @param props.id - identity driving the tint; the same id renders the same color everywhere.
 * @param props.name - display name whose first letter fills the disc.
 * @returns a decorative circle; the adjacent text carries the name.
 */
export function RosterAvatar({ id, name }: { id: string; name: string }) {
  return <span className={css.avatar} data-tone={avatarTone(id)} aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
}
