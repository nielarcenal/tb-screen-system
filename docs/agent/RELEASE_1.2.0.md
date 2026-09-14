# TB-Screen 1.2.0 - account password settings and Android branding

## Changes

- Facility, Midwife and Admin portals: Change password in the shared account sidebar.
- BHW app: Settings > account > Change password.
- Reuses the password policy and Supabase Auth password update. Ordinary changes do not clear the required-first-login flag. Forced first-login changes remain non-dismissible.
- Confirmation field, validation, server errors, cancellation and success feedback. Network exceptions warn that the result was not confirmed; passwords are not queued offline or added to patient records.
- Preserves portal work while the password screen is open and mobile data when cancelling.
- Android launcher resources regenerated from the existing TB-Screen logo configuration, replacing the stale Expo icon. Version 1.2.0 / Android versionCode 3.
- Includes the pending CSV icon spacing and Activity log styling improvements.

## Verification

- Web: 207 tests passed; production build passed.
- Mobile: 219 tests passed; TypeScript check passed.
- Browser: opened and cancelled the voluntary password screen without changing a real user's credentials.
- Full web suite passed with one worker after concurrent Android compilation caused registration-test timeouts.
- Native build environment: Windows Java socket startup required `JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=C:/Windows/Temp -Djdk.net.unixdomain.tmpdir=C:/Windows/Temp` for this local build.
- Windows CMake shortens `clang++.exe` to `CLANG_~1.EXE`, losing C++ link-driver detection. The opt-in `mobile/scripts/windows-cxx-driver.gradle` adds `--driver-mode=g++` to C++ flags; it does not modify dependencies or disable linker checks. Build from `mobile/android` with `./gradlew.bat assembleRelease --no-daemon --init-script ../scripts/windows-cxx-driver.gradle` and the Java options above.

## Distribution notes

- Release APK build passed for arm64-v8a, armeabi-v7a, x86 and x86_64; version 1.2.0 / code 3 / package `com.tbscreen.bhw`.
- Verified the packaged logo matches the generated TB-Screen launcher artwork, and the password screen and configured backend endpoint are bundled.
- Signing certificate matches v1.1.0, allowing an in-place update.
- APK size: 102,454,498 bytes. SHA-256: `f71cd3e14ac4b27ae04d61c38a5824a55e34b4ef4fd3b02ba9486378de291746`.

This is a capstone demonstration APK, using the existing debug signing configuration, not a Play Store production release. Install as an update; do not uninstall first, as uninstalling can delete unsynced local records. No real account password was changed during verification. Physical-device password-change testing is still required.
