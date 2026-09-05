/**
 * A yes/no confirmation the app draws itself, for the paths where the wrong
 * button being read first would destroy a BHW's work.
 *
 * WHY NOT `Alert.alert`. Android's AlertDialog maps `buttons[0]` to the
 * NEGATIVE slot and `buttons[1]` to the POSITIVE one. Side by side that renders
 * negative-left / positive-right, which is why the English unsynced-records
 * question reads "Stay signed in · Sign out and delete". But when the labels are
 * too long to sit on one line, AlertDialog STACKS them — and a stacked
 * AlertDialog puts the POSITIVE button on TOP. The Tagalog and Cebuano labels
 * ("Mag-sign out at burahin" / "Mag-sign out ug papason") are long enough to
 * trigger stacking, so on the one dialog whose entire job is to stop a BHW
 * deleting unsynced records, the delete action was rendered in the first-read
 * position — in the two languages the BHWs in Bukidnon actually use. Confirmed
 * by screenshot on the A54, all three languages, 2026-08-25.
 *
 * No ordering of Alert's array fixes both layouts at once: swapping the entries
 * makes the stacked case safe and the side-by-side case unsafe. Shortening the
 * translations until they happen to fit was rejected too — it would make the
 * safety of an irreversible dialog depend on a string length, the user's font
 * scale and the screen width, and these labels have to stay unambiguous
 * precisely because the action cannot be undone.
 *
 * So the app renders the buttons itself, always stacked, always safe-first.
 *
 * This module is the imperative half and imports no React Native, so it stays
 * loadable under the node-env vitest config (see vitest.config.mts).
 * `ConfirmDialogHost` is the half that draws it.
 */
import { create } from 'zustand';

/** What a caller asks; all four strings arrive already translated. */
export interface ConfirmRequest {
  title: string;
  body: string;
  /** The answer that changes nothing. Always rendered FIRST. */
  cancelLabel: string;
  /** The answer that acts. Rendered second, in the danger colour. */
  confirmLabel: string;
}

/** A request with the identity and continuation the host needs. */
export interface PendingConfirm extends ConfirmRequest {
  /** Distinguishes this question from the one that may replace it. */
  id: number;
  resolve: (confirmed: boolean) => void;
}

interface ConfirmDialogState {
  pending: PendingConfirm | null;
}

export const useConfirmDialogStore = create<ConfirmDialogState>()(() => ({
  pending: null,
}));

let nextId = 1;

/**
 * Ask the question and resolve with the BHW's answer.
 *
 * Resolving `false` is the safe default everywhere: dismissing the dialog with
 * the Android back button or a tap outside answers `false`, and so does being
 * displaced by a later question. A caller may therefore treat `false` as "do
 * nothing" without checking why.
 */
export function showConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Only one question is ever on screen. If another is somehow asked first,
    // the older one is answered "no" rather than left hanging — a promise that
    // never settles would strand whatever `await`s it, and in this flow that
    // await sits between the BHW and their session.
    const displaced = useConfirmDialogStore.getState().pending;
    displaced?.resolve(false);
    useConfirmDialogStore.setState({
      pending: { ...request, id: nextId++, resolve },
    });
  });
}

/**
 * Answer the dialog identified by `id`.
 *
 * The id is checked because a tap that lands after the dialog was replaced or
 * already answered must not resolve whatever question took its place — on this
 * flow that mis-delivered "yes" would wipe the offline cache.
 */
export function answerConfirm(id: number, confirmed: boolean): void {
  const pending = useConfirmDialogStore.getState().pending;
  if (!pending || pending.id !== id) return;
  useConfirmDialogStore.setState({ pending: null });
  pending.resolve(confirmed);
}
