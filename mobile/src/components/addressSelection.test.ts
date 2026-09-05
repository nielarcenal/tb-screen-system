/**
 * The auto-select rule behind the "pre-filled from your assigned barangay"
 * banner. The bug these pin was a RACE, so the cases that matter are the ones
 * where a selection is already present when the option list finally arrives.
 *
 * Testable at all only because the rule lives in a plain .ts module: the
 * vitest config is node-env and cannot load AddressCascade.tsx.
 */
import { describe, expect, it } from 'vitest';

import { AddressSelection, autoSelectSingle, emptyAddress } from './addressSelection';

const ONE_REGION = [{ code: '10' }];
const ONE_PROVINCE = [{ code: '1013' }];

/** What cascadeForBarangay() hands back for the BHW's assigned barangay. */
const PREFILLED: AddressSelection = {
  regionCode: '10',
  provinceCode: '1013',
  cityCode: '101312000',
  barangayCode: '101312012',
};

describe('autoSelectSingle', () => {
  it('fills an empty level when there is exactly one option', () => {
    expect(autoSelectSingle(emptyAddress, 'regionCode', ONE_REGION)).toEqual({
      ...emptyAddress,
      regionCode: '10',
    });
  });

  it('changes nothing when the level is already set', () => {
    expect(autoSelectSingle(PREFILLED, 'regionCode', ONE_REGION)).toBeNull();
    expect(autoSelectSingle(PREFILLED, 'provinceCode', ONE_PROVINCE)).toBeNull();
  });

  it('changes nothing when the option list is empty or ambiguous', () => {
    expect(autoSelectSingle(emptyAddress, 'regionCode', [])).toBeNull();
    expect(
      autoSelectSingle(emptyAddress, 'regionCode', [{ code: '10' }, { code: '11' }]),
    ).toBeNull();
  });

  it('keeps the levels below the one it fills', () => {
    // Region empty but the rest already chosen: filling region must not
    // discard them. Spreading emptyAddress here is what broke Enroll.
    const partial: AddressSelection = { ...PREFILLED, regionCode: null };
    expect(autoSelectSingle(partial, 'regionCode', ONE_REGION)).toEqual(PREFILLED);
  });

  it('does not wipe a pre-fill that won the race', () => {
    // The exact observed sequence on the A54: the parent's cascadeForBarangay()
    // resolves first and installs the whole address, then listRegions() lands
    // and the mount effect runs its auto-select against the CURRENT value.
    let selection: AddressSelection = emptyAddress;
    selection = PREFILLED; // pre-fill resolves

    const next = autoSelectSingle(selection, 'regionCode', ONE_REGION);
    if (next) selection = next; // listRegions resolves second

    expect(selection).toEqual(PREFILLED);
    expect(selection.barangayCode).toBe('101312012');
  });

  it('survives the pre-fill landing between the query and the merge', () => {
    // The narrower race the ref-based attempt still lost on hardware: the
    // option list resolves against the OLD selection while the pre-fill's
    // setState is queued. Applied as an updater — the way the component does
    // it — the queued value is already in `prev`, so the merge keeps it.
    const queue: ((prev: AddressSelection) => AddressSelection)[] = [];

    // 1. listRegions resolves; the merge is queued, not computed against a snapshot.
    queue.push((prev) => autoSelectSingle(prev, 'regionCode', ONE_REGION) ?? prev);

    // 2. the pre-fill's setAddress(FULL) is applied first, as React would.
    let state: AddressSelection = PREFILLED;

    // 3. the queued updater then runs against it.
    for (const update of queue) state = update(state);

    expect(state).toEqual(PREFILLED);
  });

  it('still auto-fills when the pre-fill has nothing to offer', () => {
    // A BHW with no assigned barangay: the pre-fill effect bails out, so the
    // auto-select is the only thing that fills the single region/province.
    let selection = emptyAddress;
    selection = autoSelectSingle(selection, 'regionCode', ONE_REGION) ?? selection;
    selection = autoSelectSingle(selection, 'provinceCode', ONE_PROVINCE) ?? selection;

    expect(selection).toEqual({
      regionCode: '10',
      provinceCode: '1013',
      cityCode: null,
      barangayCode: null,
    });
  });
});
