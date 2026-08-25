/**
 * The address selection shape and the cascade's auto-select rule.
 *
 * This lives in a plain .ts module with NO React Native imports so the vitest
 * config (node env, `src/**\/*.test.ts`) can load it — the same reason
 * confirmDialog.ts is split out of ConfirmDialogHost.tsx. AddressCascade.tsx
 * re-exports the type and `emptyAddress`, so screens keep importing them from
 * the component and nothing else moved.
 */

export interface AddressSelection {
  regionCode: string | null;
  provinceCode: string | null;
  cityCode: string | null;
  barangayCode: string | null;
}

export const emptyAddress: AddressSelection = {
  regionCode: null,
  provinceCode: null,
  cityCode: null,
  barangayCode: null,
};

/** The levels that can fill themselves in: those with exactly one option. */
export type AutoLevel = 'regionCode' | 'provinceCode';

/**
 * Decide what a single-option level (region/province — the PSGC bundle is
 * scoped to Bukidnon, a documented delimitation) should do to the current
 * selection. Returns the selection to apply, or null to change nothing.
 *
 * Both rules exist because the caller runs this from an async callback that
 * RACES the parent screen's pre-fill ("pre-fill the cascade from the BHW's
 * assigned barangay"), and either promise can land first:
 *
 *  - Fill only when the level is still empty, so a selection that arrived
 *    while the option list was loading is never overwritten. The old code
 *    compared against the single option's code instead, using a `value`
 *    captured by a `[]`-deps effect — permanently the first render's empty
 *    address — so it fired even when a real selection was already in place.
 *
 *  - Preserve every other level. The old code spread `emptyAddress`, which
 *    discarded the province, city and barangay the pre-fill had just
 *    installed. That left the cascade showing "Region X" with an EMPTY
 *    Province and a disabled City, under a banner promising it was
 *    "pre-filled from your assigned barangay" — and it could not recover,
 *    because the province auto-select effect keys on `value.regionCode`,
 *    which the wipe left unchanged. Observed on the A54's Enroll screen while
 *    Settings, running identical pre-fill code, won the same race and
 *    rendered the full cascade.
 *
 * `current` must therefore be the LATEST selection, which is why the caller
 * applies this through the state updater form rather than reading a value or
 * a ref. Reading a ref is not enough and was tried on hardware: a ref is only
 * refreshed on render, so while the pre-fill's setState sits queued the
 * callback still sees the pre-pre-fill selection and writes a whole object
 * over the queued one. That produced a second, narrower version of the same
 * bug — region and province filled, city and barangay empty. Composed through
 * an updater the ordering stops mattering: whichever lands second merges into
 * the first instead of replacing it.
 *
 * Levels the BHW changes by hand still clear everything below them: that is
 * the picker's `select()` path, which is deliberately untouched here.
 */
export function autoSelectSingle(
  current: AddressSelection,
  level: AutoLevel,
  options: readonly { code: string }[],
): AddressSelection | null {
  if (options.length !== 1) return null;
  if (current[level]) return null;
  return { ...current, [level]: options[0].code };
}
