/** Feature-local file reference: a basename with its full path on hover, plus an optional short hash. */
import type { ContextMenuTriggerProps } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import css from './FileChip.module.css'

/**
 * Render a compact file reference and, when supplied, its leading hash characters.
 * @param props.path - full file path; the chip shows its basename and keeps the path in `title`.
 * @param props.hash - full content hash; the chip shows its first eight characters and keeps the hash in `title`.
 * @param props.triggerProps - optional right-click and keyboard menu bindings for the file target.
 * @returns an inline file chip.
 */
export function FileChip({ path, hash, triggerProps }: {
  path: string
  hash?: string | undefined
  triggerProps?: ContextMenuTriggerProps | undefined
}) {
  const basename = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  const trigger: ContextMenuTriggerProps = triggerProps ?? {}
  return <span className={css.chip} title={path} {...trigger}>
    <span className={css.name}>{basename}</span>
    {hash !== undefined && <span className={css.hash} title={hash}>{hash.slice(0, 8)}</span>}
  </span>
}
