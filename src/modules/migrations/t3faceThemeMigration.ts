/**
 * Pure decision logic for the one-time "t3-face theme reset" migration.
 *
 * The t3-face program reskins the app via `t3face.css`, but a persisted
 * non-default `themeId` stamps inline CSS variables on `document.documentElement`
 * (see `applyTheme.ts`), and inline styles beat stylesheet rules — so any user
 * who ever picked a builtin/custom theme keeps overriding the whole t3-face
 * palette forever and sees zero visual change after upgrading. This migration
 * resets the SELECTED theme back to the default exactly once so the new face
 * shows, while recording the previous choice so it can be re-picked, and never
 * deleting any custom theme (only the selection changes).
 *
 * Kept separate from any I/O (the Tauri store, localStorage) so it can be
 * unit-tested as a plain function — matching `planKeyValueMigration` /
 * `planLazyStoreMigration` in this module.
 */
export type T3faceThemeMigrationPlan = {
  /** Persist the one-time flag so this migration never runs again. */
  shouldStampFlag: boolean;
  /** Reset the selected `themeId` to the default so the t3-face skin shows. */
  shouldReset: boolean;
  /** The pre-reset `themeId` to record for opt-back (only set when resetting). */
  themeIdBefore: string | null;
};

const NO_OP: T3faceThemeMigrationPlan = {
  shouldStampFlag: false,
  shouldReset: false,
  themeIdBefore: null,
};

/**
 * @param alreadyMigrated  whether the one-time flag is already set.
 * @param currentThemeId   the RESOLVED current selection (legacy default ids
 *                         already remapped to `defaultThemeId` by the caller,
 *                         so a user on the default — old or new literal —
 *                         never counts as "on a custom theme").
 * @param defaultThemeId   the built-in default theme id.
 */
export function planT3faceThemeMigration(
  alreadyMigrated: boolean,
  currentThemeId: string,
  defaultThemeId: string,
): T3faceThemeMigrationPlan {
  // Once the flag is set the selection is the user's own again — never touch
  // it, so a re-picked old theme after the migration persists permanently.
  if (alreadyMigrated) return NO_OP;
  // Already on the default: nothing to reset, but still stamp the flag so a
  // later theme change isn't mistaken for a pre-migration selection.
  if (currentThemeId === defaultThemeId) {
    return { shouldStampFlag: true, shouldReset: false, themeIdBefore: null };
  }
  // A non-default selection is suppressing the t3-face skin — reset it once,
  // remembering the old id for opt-back.
  return {
    shouldStampFlag: true,
    shouldReset: true,
    themeIdBefore: currentThemeId,
  };
}
