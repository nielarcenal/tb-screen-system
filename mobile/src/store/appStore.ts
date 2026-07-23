/**
 * PERSISTENT store — safe, NON-personal app state only (persisted to disk via
 * AsyncStorage). Never put patient/personal data here (§3). Personal/session
 * data lives in the transient sessionStore, which is not persisted.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppLanguage } from '../i18n/languages';

interface AppState {
  /** ISO timestamp of the last successful sync, for display. Non-personal. */
  lastSyncAt: string | null;
  setLastSyncAt: (iso: string) => void;

  /** Chosen UI language (en/tl/ceb). Non-personal. */
  language: AppLanguage;
  setLanguage: (lng: AppLanguage) => void;

  /**
   * When the user accepted the T&C + non-diagnostic disclaimer (ISO string), or
   * null if never. Drives the first-launch gate; accepted once, viewable later.
   */
  termsAcceptedAt: string | null;
  acceptTerms: () => void;
  resetTerms: () => void; // developer helper to re-show the welcome flow

  /**
   * BHW's assigned barangay (brief §6): set once in Settings, used to pre-fill
   * the enrollment address cascade. The BHW's own work setting — not patient
   * data — so persisting it is fine. `assignedBarangayDirty` marks a local
   * change not yet pushed to the server users row (pushed after each sync).
   */
  assignedBarangayCode: string | null;
  assignedBarangayDirty: boolean;
  setAssignedBarangay: (code: string) => void;
  markAssignedBarangayPushed: () => void;

  /**
   * Patient display-code parts (§4). display_code is UNIQUE server-wide, but
   * codes are generated offline — so each install gets a random device code
   * once, and codes are PAT-<device>-<seq> (e.g. PAT-K7Q2-0001). Devices can't
   * collide with each other's sequences. Non-personal, safe to persist.
   */
  deviceCode: string | null;
  nextPatientSeq: number;
  allocateDisplayCode: () => string;

  /** Specimen ids follow the same scheme: SPC-<device>-<seq> (Feature 6). */
  nextSpecimenSeq: number;
  allocateSpecimenId: () => string;
}

/** No 0/O/1/I — codes get read aloud and handwritten on specimen forms. */
const DEVICE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomDeviceCode(): string {
  return Array.from(
    { length: 4 },
    () => DEVICE_CODE_ALPHABET[Math.floor(Math.random() * DEVICE_CODE_ALPHABET.length)],
  ).join('');
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      lastSyncAt: null,
      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),

      language: 'en',
      setLanguage: (lng) => set({ language: lng }),

      termsAcceptedAt: null,
      acceptTerms: () => set({ termsAcceptedAt: new Date().toISOString() }),
      resetTerms: () => set({ termsAcceptedAt: null }),

      assignedBarangayCode: null,
      assignedBarangayDirty: false,
      setAssignedBarangay: (code) =>
        set({ assignedBarangayCode: code, assignedBarangayDirty: true }),
      markAssignedBarangayPushed: () => set({ assignedBarangayDirty: false }),

      deviceCode: null,
      nextPatientSeq: 1,
      allocateDisplayCode: () => {
        const deviceCode = get().deviceCode ?? randomDeviceCode();
        const seq = get().nextPatientSeq;
        set({ deviceCode, nextPatientSeq: seq + 1 });
        return `PAT-${deviceCode}-${String(seq).padStart(4, '0')}`;
      },

      nextSpecimenSeq: 1,
      allocateSpecimenId: () => {
        const deviceCode = get().deviceCode ?? randomDeviceCode();
        const seq = get().nextSpecimenSeq;
        set({ deviceCode, nextSpecimenSeq: seq + 1 });
        return `SPC-${deviceCode}-${String(seq).padStart(4, '0')}`;
      },
    }),
    {
      name: 'tbscreen-app', // AsyncStorage key
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
