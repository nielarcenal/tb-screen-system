# BHW app PIN lock (Android 1.3.0 / code 4)

## Behavior

- After the first account sign-in (including a restored session on upgrade), the BHW must choose and confirm a six-digit PIN before using the app.
- Subsequent cold starts and returns from the background require the PIN, including offline and after account sign-out. This is a device lock; it is not the Supabase password and does not replace server access checks.
- Settings offers Change app PIN (requires the current PIN) and Lock now. There is no disable-PIN or destructive reset shortcut.
- Forgot PIN requires online password authentication of the account that originally established this device's PIN, then a new PIN. A separate non-persistent authentication client checks the owner; it does not replace the running app session or delete patient data.
- Incorrect attempts persist in encrypted storage. Five incorrect attempts impose a 30-second wait; later failures increase the delay up to 15 minutes. Closing the app does not reset the wait. Correct verification resets the counter only after a successful secure write.
- App screens remain mounted but hidden beneath a non-dismissible native PIN screen, preserving drafts. A background transition clears PIN/password inputs and invalidates any in-flight unlock result.
- Android screen capture and Recent Apps previews are protected with FLAG_SECURE. Screenshots/recordings of the app are therefore blocked. Android backups are disabled; SecureStore's backup exclusions are also configured.

## Storage and limits

The salted PIN hash, owner UUID, and attempt state live only in Expo SecureStore (Android Keystore encrypted storage), not AsyncStorage, SQLite, logs, or sync payloads. PIN unlock state exists only in memory. Storage/parse failures fail closed rather than silently creating a replacement PIN.

This is a UI access lock, **not encryption of the patient SQLite database**, protection against a rooted device, or a replacement for Android's own device lock. A PIN is established only after sign-in; the initial unconfigured welcome/sign-in experience remains available. The original PIN owner's credentials are required for recovery, even if a different account later signs in on the same phone.

Do not uninstall or clear app data to reset a PIN: that can erase unsynced records. An account-password reset must use the existing account support process if the owner also forgot their password.

## Verification

- Mobile TypeScript check passed.
- 236 automated tests passed, including 17 new PIN vault/lifecycle tests: format, setup overwrite prevention, salted storage, cooldown persistence, concurrent attempts, safe storage-write failures, current-PIN changes, owner-only recovery, and background races.
- Native release build passed for all four architectures. The final bundle was checked for the PIN modules and confirmation-dialog guard.
- APK signature verified and matches earlier releases: `com.tbscreen.bhw`, version 1.3.0 / code 4. Published to GitHub Releases on 2026-09-20; still debug-signed for capstone use.
- APK size: 102,663,582 bytes; SHA-256: `2cdf8c936e0bad745f934cfc464a3c9b3df9f1858d43c78b70daf5c6891565ac`.

## Physical-device acceptance checklist (not yet performed)

1. Install as an update without uninstalling; confirm existing offline records remain.
2. Sign in / restore the existing session, set a six-digit PIN, and confirm it.
3. Force-stop and relaunch in airplane mode: PIN must appear before patient details.
4. Try a wrong PIN five times; restart during the cooldown and verify it remains.
5. Open a patient draft, background the app, then unlock: draft should remain intact.
6. Repeat background/return with a confirmation dialog and a date picker open; verify neither can cover or bypass the PIN screen.
7. Check Android Back, Recents, notification interruptions, keyboard, and accessibility focus. No patient details should appear in Recents or screenshots.
8. Change PIN in Settings; old PIN fails, new PIN succeeds after restart.
9. Recover online using the original owner's password. Wrong credentials and another account must fail; local records must remain unchanged.
10. Verify that deliberate sign-out retains its existing sync/warning/cache-clear behavior, then restart offline and verify the device PIN remains required. Separately, session expiry (without deliberate sign-out) must not bypass the PIN protecting retained records.
11. Verify the new Tagalog and Cebuano PIN text with a native speaker.
