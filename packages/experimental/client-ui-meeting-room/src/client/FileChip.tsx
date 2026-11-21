/** Feature-local file reference: a basename with its full path on hover, plus an optional short hash. */
import type { ContextMenuTriggerProps } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import css from './FileChip.module.css'

/**
 * Render a compact file reference and, when supplied, its leading hash characters.
 * @param props.path - full file path; the chip shows its basename and keeps the path in `title`.
 * @param props.hash - full content hash; the chip shows its first eight characters and keeps the hash in `title`.
 * @param props.triggerProps - optional right-click and keyboard menu bindings for the file target.
 * @param props.onOpen - optional left-click handler (e.g. an in-panel content viewer); right-click keeps the file menu.
 * @returns an inline file chip.
 */
export function FileChip({ path, hash, triggerProps, onOpen }: {
  path: string
  hash?: string | undefined
  triggerProps?: ContextMenuTriggerProps | undefined
  onOpen?: (() => void) | undefined
}) {
  const basename = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  const trigger: ContextMenuTriggerProps = triggerProps ?? {}
  const openMenu = trigger.onContextMenu
  return <span className={css.chip} title={path} {...trigger}
    onClick={onOpen === undefined ? openMenu === undefined ? undefined
      : (event) => { event.stopPropagation(); openMenu(event) }
      : (event) => { event.stopPropagation(); onOpen() }}>
    <span className={css.name}>{basename}</span>
    {hash !== undefined && <span className={css.hash} title={hash}>{hash.slice(0, 8)}</span>}
  </span>
}
