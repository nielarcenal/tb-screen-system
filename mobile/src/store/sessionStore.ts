/**
 * TRANSIENT store — holds the signed-in user's identity (personal data). This is
 * intentionally NOT persisted by us (§3): it is rebuilt from the Supabase auth
 * session on launch and cleared on sign-out. (Supabase itself persists only the
 * opaque auth token via AsyncStorage; we keep no personal fields on disk.)
 */
import { create } from 'zustand';

interface SessionState {
  userId: string | null;
  email: string | null;
  /**
   * The BHW's own full name (users row), fetched best-effort after the session
   * is (re)established — used to attribute the printed specimen form and the
   * "enrolled by" line. Null while offline-at-launch until a fetch succeeds.
   */
  fullName: string | null;
  /**
   * True when the session ended on its own rather than the BHW tapping Sign
   * out — the refresh token was rejected because it expired, was revoked by a
   * sign-out elsewhere, or was burned by a request whose reply never arrived.
   * Home shows a different banner for this; the local patient cache is kept
   * either way, so nothing unsynced is lost.
   */
  expired: boolean;
  /**
   * Whether this account must replace a provisioned password before it can use
   * the app (D-06 — users.must_change_password). null means NOT YET KNOWN: the
   * flag lives on the server, and a session restored while offline cannot read
   * it. Unknown deliberately does not block. The app is offline-first, an
   * account cannot have signed in without being online at least once, and
   * stranding a BHW mid-shift behind a form we cannot submit anyway would be
   * worse than letting a provisioned password live until the next connection.
   */
  mustChangePassword: boolean | null;
  /**
   * Set by Settings immediately before supabase.auth.signOut(), so the
   * SIGNED_OUT event that follows is recognised as deliberate (expired stays
   * false). A latch, not a one-shot: Settings clears the store again after
   * signOut() resolves, and that second clear must not flip the reason. Reset
   * by the next successful sign-in.
   */
  signingOut: boolean;
  setSession: (userId: string, email: string | null) => void;
  setFullName: (name: string | null) => void;
  setMustChangePassword: (value: boolean | null) => void;
  beginSignOut: () => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  email: null,
  fullName: null,
  expired: false,
  mustChangePassword: null,
  signingOut: false,
  // NOTE: mustChangePassword is deliberately NOT reset here. onAuthStateChange
  // fires setSession again on every token refresh for the SAME user, and
  // clearing the answer each time would drop the gate mid-form. Sign-out is
  // what resets it, below.
  setSession: (userId, email) => set({ userId, email, expired: false, signingOut: false }),
  setFullName: (fullName) => set({ fullName }),
  setMustChangePassword: (mustChangePassword) => set({ mustChangePassword }),
  beginSignOut: () => set({ signingOut: true }),
  clearSession: () =>
    set((s) => ({
      userId: null,
      email: null,
      fullName: null,
      mustChangePassword: null,
      // Supabase only emits SIGNED_OUT when there was a stored session to
      // lose, so "cleared without asking" always means the session ended on
      // its own — including when it dies during launch, before setSession()
      // ever ran.
      expired: !s.signingOut,
    })),
}));
