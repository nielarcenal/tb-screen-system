/**
 * The imperative half of the app's own confirmation dialog.
 *
 * What is worth pinning here is only the part that can silently destroy data:
 * that nothing but a deliberate "yes" ever resolves `true`, and that no caller
 * can be left waiting forever on a question that has gone off screen. The
 * button ORDER — the defect this replaced Alert.alert for — lives in
 * ConfirmDialogHost.tsx and cannot be covered here: this vitest config is
 * node-env and cannot load a .tsx that imports React Native (see
 * vitest.config.mts). That one is verified on the device, per language.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answerConfirm, showConfirm, useConfirmDialogStore } from './confirmDialog';

const request = {
  title: 'Not everything is uploaded',
  body: '2 records on this phone have not reached the server yet.',
  cancelLabel: 'Stay signed in',
  confirmLabel: 'Sign out and delete',
};

/** The dialog currently on screen — the host reads exactly this. */
const onScreen = () => useConfirmDialogStore.getState().pending;

beforeEach(() => {
  useConfirmDialogStore.setState({ pending: null });
});

describe('showConfirm', () => {
  it('puts the request on screen and waits', async () => {
    const answer = showConfirm(request);
    const shown = onScreen();

    expect(shown).toMatchObject(request);

    const settled = vi.fn();
    void answer.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled(); // still asking

    answerConfirm(shown!.id, true);
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false when the answer is no, and takes the dialog down', async () => {
    const answer = showConfirm(request);
    answerConfirm(onScreen()!.id, false);

    await expect(answer).resolves.toBe(false);
    expect(onScreen()).toBeNull();
  });
});

describe('answerConfirm', () => {
  it('ignores an answer aimed at a dialog that is no longer showing', async () => {
    const first = showConfirm(request);
    const staleId = onScreen()!.id;
    answerConfirm(staleId, false);
    await expect(first).resolves.toBe(false);

    const second = showConfirm({ ...request, title: 'Sign out?' });
    // A late tap from the dismissed dialog must not answer the new question:
    // delivered to the second one, this `true` would wipe the offline cache.
    answerConfirm(staleId, true);

    expect(onScreen()).not.toBeNull();
    const settled = vi.fn();
    void second.then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    answerConfirm(onScreen()!.id, false);
    await expect(second).resolves.toBe(false);
  });

  it('does nothing when no dialog is showing', () => {
    expect(() => answerConfirm(999, true)).not.toThrow();
    expect(onScreen()).toBeNull();
  });
});

describe('a displaced question', () => {
  it('is answered no rather than left hanging', async () => {
    const first = showConfirm(request);
    const second = showConfirm({ ...request, title: 'Sign out?' });

    // The first caller is awaiting between the BHW and their session; an
    // unsettled promise there would strand the flow with no way back.
    await expect(first).resolves.toBe(false);
    expect(onScreen()!.title).toBe('Sign out?');

    answerConfirm(onScreen()!.id, false);
    await expect(second).resolves.toBe(false);
  });
});
