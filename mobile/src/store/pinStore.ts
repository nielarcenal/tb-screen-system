import { create } from 'zustand';
import { pinVault } from '../lib/pinVault';

interface PinState {
  ready: boolean;
  failed: boolean;
  configured: boolean;
  locked: boolean;
  changing: boolean;
  generation: number;
  initialize(): Promise<void>;
  lock(): void;
  change(): void;
  cancelChange(): void;
  complete(generation: number): void;
}

// Intentionally not persisted. Every process starts locked, even offline.
export const usePinStore = create<PinState>((set) => ({
  ready: false, failed: false, configured: false, locked: true, changing: false, generation: 0,
  initialize: async () => {
    set({ failed: false });
    try { set({ configured: !!(await pinVault.read()), ready: true }); }
    catch { set({ failed: true, ready: false, locked: true }); }
  },
  lock: () => set((s) => ({ locked: true, changing: false, generation: s.generation + 1 })),
  change: () => set((s) => ({ changing: true, generation: s.generation + 1 })),
  cancelChange: () => set((s) => ({ changing: false, generation: s.generation + 1 })),
  // Backgrounding invalidates in-flight unlock/recovery results.
  complete: (generation) => set((s) => s.generation === generation
    ? { configured: true, locked: false, changing: false } : { configured: true }),
}));
