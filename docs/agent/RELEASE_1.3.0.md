# TB-Screen BHW 1.3.0 — PIN lock

Android package `com.tbscreen.bhw`, version 1.3.0 / version code 4.

- Required six-digit device PIN after account sign-in.
- PIN required on app restart and return from the background, including offline.
- Change PIN and Lock now in Settings; online recovery requires the original PIN owner's account password.
- Persistent failed-attempt cooldown; encrypted PIN verifier storage; Android screenshots and Recent Apps previews protected.
- Existing TB-Screen Android logo included.

Install the APK as an update. **Do not uninstall or clear app data:** doing so can erase unsynced records. This PIN is separate from your account password.

Capstone/demo build, debug-signed like previous releases. The PIN is an app access lock, not encryption of the local patient database. Physical-device acceptance of the new PIN workflows is still pending; see BHW_PIN_LOCK.md.

APK size: 102,663,582 bytes.

SHA-256: `2cdf8c936e0bad745f934cfc464a3c9b3df9f1858d43c78b70daf5c6891565ac`.

Companion portal release adds the Facility Patient List and demographic correction workflow, backed by migration 0042. Mobile: 236 tests and TypeScript check passed on 2026-09-20.
