import { warnOnce } from './devWarnings';

/** CSS custom property defined by `@rchemist/editor/styles.css`; its presence proves the sheet loaded. */
export const STYLES_SENTINEL_PROPERTY = '--rcm-editor-styles-loaded';
/** Stable code at the start of the warning so tooling can detect it without matching prose. */
export const STYLES_MISSING_CODE = 'RCM_EDITOR_STYLES_MISSING';

/** Warn once per page (development only) when the editor root has no style token. */
export function warnIfStylesMissing(root: Element): void {
  if (typeof getComputedStyle !== 'function') return;
  const value = getComputedStyle(root).getPropertyValue(STYLES_SENTINEL_PROPERTY);
  if (value.trim() !== '') return;
  warnOnce(
    STYLES_MISSING_CODE,
    () =>
      `[${STYLES_MISSING_CODE}] @rchemist/editor styles are not loaded. ` +
      "Add `import '@rchemist/editor/styles.css'` once in your app entry.",
  );
}
