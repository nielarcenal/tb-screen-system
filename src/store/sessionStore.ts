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
  setSession: (userId: string, email: string | null) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  userId: null,
  email: null,
  setSession: (userId, email) => set({ userId, email }),
  clearSession: () => set({ userId: null, email: null }),
}));
