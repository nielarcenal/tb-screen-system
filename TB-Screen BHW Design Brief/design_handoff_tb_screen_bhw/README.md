# Handoff: TB-Screen BHW — Trilingual TB Pre-Screening System

## Overview
TB-Screen BHW is a two-surface health system for the rural Philippines:

1. **Mobile app** (Android-first, portrait) for Barangay Health Workers (BHWs) — community volunteers who enroll patients, run the DOH-NTP symptom checklist, and refer presumptive TB cases to TB-DOTS facilities. Works offline; syncs later.
2. **Web portal** for two roles: **TB-DOTS facility staff** (referral inbox, dashboard, barangay hotspot surveillance) and **Barangay Captains** (BHW account management only — zero patient data).

Trilingual: English / Tagalog / Cebuano. Every user-facing string is localized.

## About the Design Files
`TB-Screen BHW.dc.html` (plus `android-frame.jsx`, `browser-window.jsx`, `support.js`) is a **design reference built in HTML** — a clickable prototype showing intended look and behavior. It is NOT production code. Your task is to **recreate these designs in the target stack**:

- **Mobile**: React Native + **React Native Paper (Material 3)**. Do not invent exotic custom components — everything in this design maps to Paper primitives (Button, Card, Chip, TextInput, RadioButton, Switch, Menu/Dropdown, Appbar, Snackbar, Dialog).
- **Web portal**: any standard React web stack (plain React + a light component lib or hand-rolled CSS is fine — the portal is deliberately utilitarian: tables and forms, not a dashboard product).
- **Backend**: Supabase (auth = email/password; Postgres for patients, screenings, referrals, appointments, BHW accounts; offline queue on mobile with background sync).

## Fidelity
**High-fidelity.** Colors, spacing, typography, copy, and interaction flows are final intent. Recreate faithfully using Paper's theming (mobile) and the token list below.

## ⚠️ Critical positioning — non-negotiable copy rules
This is a **pre-screening support tool**. It NEVER diagnoses.
- Forbidden anywhere: "TB detected", "diagnosis", "risk score", "probability", any numeric score, score gauges, waveforms, audio recording UI, ML language.
- Required vocabulary: "pre-screening", "presumptive", "refer to TB-DOTS", "flags for referral", "Meets presumptive TB criteria — refer to TB-DOTS" / "Does not meet criteria".
- Referral recommendation logic is ONLY the DOH-NTP checklist rule (below). No scores shown ever.
- Offline is a normal state, not an error — indicators are calm, never red/alarming.

## Design Tokens

### Colors
- Primary (deep teal): `#028090`
- Accent (seafoam): `#00A896`
- Primary dark / text-on-teal-tint: `#016575`, darker `#014B57`
- Teal tint background (chips, avatars, selected states): `#D9EEEF`
- Teal border: `#7CBEC6`
- App background (warm off-white): `#FBF9F6`
- Card background: `#FFFFFF`
- Card border: `#E3DED6`; hairline divider: `#F0EDE7`; inset background: `#F3F0EA`, `#F7F5F1`, `#EDE8E0`
- Text primary: `#20302E`; secondary: `#4A5754`, `#5A6B68`; muted: `#8A968F`; disabled: `#9C948A`
- Input border: `#C9C2B6`
- Danger/missed (calm red): `#96362E`, dark `#7A2B24`, tint `#FBE7E5`, border `#E3B8B4`
- Warning/amber (did-not-present, PGI-S patient-voice): text `#8A5E00` / `#6F4C00`, tint `#FFF9EE` / `#F7ECD8`, border `#E0C98F`
- Disabled button: bg `#E3DED6`, fg `#9C948A`

### Typography
- Sans throughout (prototype uses a Material-adjacent sans; on RN Paper use the MD3 default or Noto Sans).
- Mobile: screen titles 20–22px/500, card question text 14–16px/500, body 13–14px, captions 11–13px, stat numbers 28–34px/700, buttons 14.5–15.5px/600.
- Portal: page title 18px/600, table header 11.5px/700 uppercase letterspaced, cells 12.5–13.5px, monospace (ui-monospace/Menlo) for emails/codes.
- Minimum touch target on mobile: 48px height (buttons are 48–56px, radius = half height, i.e. full pill).

### Shape
- Cards: 14–16px radius; inputs 10–12px; pills/chips fully rounded; portal tables 12px.

## Mobile App — Screens (in flow order)

### 1. Language picker (first launch)
Three large stacked option cards (≥72px tall): **English**, **Tagalog**, **Cebuano** — each labeled in its own language ("English", "Tagalog", "Sinugboanon") with a small subtitle in English. Selected card: teal border + tint. Continue button at bottom. Changeable later in Settings.

### 2. Terms & Disclaimer (first launch, accept once)
Scrollable T&C text. Above the fold, a **prominent disclaimer card** (amber-tinted `#FFF9EE`, `#E0C98F` border): plain-language statement that the app does not diagnose TB; only TB-DOTS facilities diagnose; the app only supports pre-screening and referral. Single primary action: **"I understand and accept"** (disabled until scrolled to end is acceptable but not required).

### 3. Login
Email + password (Supabase auth), teal primary Sign in button, app logo/name above. Nothing else.

### 4. Home dashboard
- Header: greeting + BHW name, barangay assignment caption, **sync status chip** top-right (see component sheet — synced/pending/offline, calm colors).
- Three stat cards in a row: **Upcoming check-ups**, **Missed check-ups**, **Did not present** (flags from TB-DOTS). Number + label; missed uses calm red tint, DNP amber tint.
- Primary FAB-style full-width button: **"New Screening"**.
- Patient search field (searches name or PAT code); result rows navigate to Patient record.
- Bottom nav or list links to Follow-up list and Settings.

### 5. Settings
- Language switch (same three options, radio style).
- **Assigned barangay**: cascading dropdowns Region → Province → City/Municipality → Barangay (set once; pre-fills every enrollment). Prototype data: Region VII – Central Visayas → Cebu → Argao → [Lamacan, Poblacion, Tulic, Canbanua, Bulasa].
- Account section (name, email, sign out).

### 6. Patient enrollment
- Full name (required), Sex (two pill toggle buttons M/F), Birthdate picker — **the moment a date is chosen, computed age appears read-only beside it ("Age: 43")**. The BHW never types an age. Age = full years as of today; invalid/future dates show "—".
- Address: cascading dropdowns Region → Province → City/Municipality → Barangay, **pre-filled from the BHW's assigned barangay**, editable; then **Sitio** free text.
- **Informed consent step**: a distinct consent card the BHW reads aloud with the patient (checkbox "Patient gave verbal consent" required to proceed). Separate **SMS reminders opt-in toggle** — the phone number field appears ONLY when the toggle is on. Declining SMS still allows enrollment.
- On save: success screen showing generated display code **PAT-0001** (sequential), with two actions: "Edit details" (returns to filled form) and "Start screening".

### 7. Screening flow (one question per card)
DOH-NTP symptom checklist, one question per card with a progress indicator ("3 of 10"), Back/Next:
1. Cough for 2 weeks or longer
2. Unintended weight loss
3. Night sweats
4. Fever
5. Blood in sputum
6. Chest pain
7. Fatigue
8. Loss of appetite
9. Close contact with a known TB case

Each answered with **tri-state chips: Yes / No / Unsure** (full-width pill row; Yes = teal fill when selected, No = neutral outline→fill, Unsure = amber-ish neutral). Next disabled until answered ("Choose an answer" hint).

Question 10 — **PGI-S item**: "How severe is your cough?" — *patient-reported*, styled visually distinct as the patient's own voice (amber card `#FFF9EE`, `record_voice_over` icon, "PATIENT'S OWN ANSWER" chip). Four options: None / Mild / Moderate / Severe.

### 7b. Review answers (before result)
After PGI-S, a **review screen** lists all 9 questions + PGI-S with inline tap-to-change chips so the BHW can correct any answer before finishing. "See recommendation" enabled only when everything is answered.

### 7c. Recommendation (end screen)
Two outcomes, NO numeric score anywhere:
- **"Meets presumptive TB criteria — refer to TB-DOTS"** (teal, primary action "Create referral")
- **"Does not meet criteria"** (neutral; action returns home)

Rule used in the prototype: cough ≥2 weeks = Yes, OR blood in sputum = Yes, OR ≥2 other symptoms Yes, OR close-contact Yes with any symptom. (Implement per current DOH-NTP guidance; the rule lives in one function.)
Also on this screen: **"Edit answers"** outline button → back to review.

### 8. Referral + specimen form
- Confirm referral to the TB-DOTS facility (facility name shown, e.g. Argao RHU TB-DOTS). Confirm button → becomes a "Referral confirmed · [sync state]" pill; **tapping it again un-confirms** (undo by re-tap, no separate undo button — this pattern is used everywhere).
- **Specimen form preview** rendered as a paper sheet: patient summary (name, code, age/sex, address), symptom answers table, PGI-S answer, appointment date, **QR code** (encodes referral ID), facility header. Print/Share action.

### 9. Patient record
- Profile card (avatar initials, name, code, age/sex, address) with an **"Edit details"** button → inline edit card: name, sex, birthdate (age recomputes read-only), Save/Cancel. Edits propagate everywhere.
- Screening history list (date + outcome label).
- **Referral status timeline**: submitted → received → tested → result (BHWs see progress steps only, never the result outcome).
- Appointments with attended/missed status chips.

### 10. Follow-up list
Filter chips: **Upcoming / Missed / Did-not-present**. Each row: patient name, barangay, date, status chip. Rows open the patient record.

## Web Portal

### Login
Email + password + **role selector** (two pills: "TB-DOTS staff" / "Barangay Captain" — in production, role comes from the account, not a picker; the picker is a prototype affordance).

Header (all roles): product name, org label, tabs, user name + avatar, **Sign out** button.

### Staff — Dashboard (landing tab)
Five stat cards for **today**: Screened today, Tested positive (red tint), Tested negative, Attended check-up, Missed check-up. Caption noting result outcomes are facility-only; BHWs see referral progress, never outcomes.

### Staff — Referral inbox
Table: patient, barangay, referral date, status chip (New / Received / Tested / Result recorded). Row click opens a detail panel:
- Screening summary (all checklist answers) + PGI-S (visually marked as patient-reported).
- Actions: **Mark received**, **Mark tested**, **Record result** (+ result date), set next check-up appointment (date input), **mark attendance**, flag **"did not present"** (amber).
- **Undo = click the same completed action again** (each completed step is a toggle; caption: "Tap a completed action again to undo it."). Steps are strictly ordered new → received → tested → result; only the newest completed step can be reverted.

### Staff — Barangay Hotspot View
Titled **"Presumptive case counts by barangay"**. Ranked horizontal bar list: barangay name, count, teal bar scaled to max. Date-range filter (7/30/90 days). Footnote: counts are presumptive referrals only — not confirmed cases, not diagnoses. **This is surveillance, NOT contact tracing** — no household or patient-linking visuals, no patient names.

### Captain — BHW Management (only tab for this role)
- Visibility banner: "Captains see accounts and activity counts only. No patient names, records, or results appear anywhere in this view." — enforce this in API/RLS, not just UI.
- Table: name, **auto-generated email**, barangay, 30-day activity (screenings · referrals — numbers only), status chip (Active/Deactivated), actions: **Edit**, **Deactivate/Reactivate**.
- Email generation (uniform): lowercase, strip accents/non-letters, dots between name words, then barangay slug: `firstname.lastname.barangay@tbscreen.ph` (e.g. `rosario.dizon.lamacan@tbscreen.ph`). Shown live in the Add form as the name is typed.
- **Add BHW**: full name + assigned barangay via the same Region→Province→City→Barangay cascade → "Create account" → confirmation card with the generated email + **temporary password** and instruction to share in person; BHW sets own password on first login (Supabase invite flow).
- **Deactivate** requires a confirm dialog ("They will no longer be able to sign in… Past records stay intact. You can reactivate anytime."). Reactivate is one click. Deactivated rows are greyed.

## Interactions & Behavior
- **Undo pattern (global)**: no undo buttons. Completed actions are toggles — click/tap again to revert (referral confirmation on mobile; received/tested/result/DNP in portal).
- **Offline/sync**: app queues writes locally; sync chip states: `synced` (teal tint, check icon), `pending` (neutral, sync icon, "3 pending"), `offline` (grey, cloud_off, calm). Never a red error for offline.
- Screening Next disabled until answered; review screen gates the recommendation on completeness.
- Age is always computed from birthdate, read-only, everywhere (enrollment + record edit).
- Phone field mounts/unmounts with the SMS toggle; validation only when visible.
- Portal detail panel state is per-referral; sign out clears selection.

## State Management (suggested)
- Mobile: local store (Zustand/Redux) + SQLite/MMKV offline queue; entities: patients, screenings (answers[9] + pgis), referrals (status), appointments; sync worker reconciles with Supabase.
- Portal: server state via Supabase queries; row-level security: staff scoped to facility catchment; captains scoped to BHW accounts of their barangay set, with **no grant on patient tables**.

## Localization
- All strings via i18n keys (en/tl/ceb). Tagalog/Cebuano run ~20–30% longer than English — layouts must tolerate expansion (buttons wrap or shrink font, never truncate consent/disclaimer text). No text baked into images.
- Reference strings for all three languages are in the prototype's `STR` object inside `TB-Screen BHW.dc.html` — use them as the seed translation files.

## Sample data used in the prototype
Patients: Maria Santos (PAT-0001, F 43, b. 1983-02-14, Brgy. Lamacan), Jose Ramirez (PAT-0002, M 58), Ana Villanueva (PAT-0003, F 36, Tulic), Ricardo Bautista (PAT-0004, M 61, Lamacan), Luzviminda Cruz (PAT-0005, F 49, Canbanua), Domingo Reyes (PAT-0006, M 52, Bulasa). BHWs: Rosario Dizon (Lamacan), Carmela Abella (Poblacion), Felix Bacalso (Tulic), Nida Alcoseba (Canbanua, deactivated), Marites Sumalinog (Bulasa). Facility: Argao RHU TB-DOTS, Cebu.

## Component sheet (all mappable to RN Paper)
- **Buttons**: primary filled pill (teal), outline pill (teal border), disabled (grey fill), destructive outline (calm red) — Paper `Button` modes.
- **Tri-state chips**: Yes/No/Unsure pill row — Paper `SegmentedButtons` or three `Chip`s.
- **PGI-S severity chips**: None/Mild/Moderate/Severe, amber selected state.
- **Consent card**: bordered card + checkbox + toggle + conditional phone input.
- **Status chips**: synced/pending/offline; upcoming (teal tint) / missed (red tint) / did-not-present (amber tint); portal referral statuses.
- **Stat cards**: big number + label + optional sub-caption; tinted variants.

## Assets
- Icons: Material Symbols Outlined (arrow_back, check_circle, edit, undo, sync, cloud_off, person_add, visibility_off, record_voice_over, logout, print/share). Use `@expo/vector-icons` MaterialCommunityIcons equivalents in RN.
- QR code: generate per referral (e.g. `react-native-qrcode-svg`).
- No photography/illustration required.

## Files in this bundle
- `TB-Screen BHW.dc.html` — the full clickable prototype (mobile app in Android frame, portal in browser frame, trilingual enrollment demo, specimen form paper preview, component sheet). All strings, colors, flows, and logic (age computation, referral rule, email slug) are readable in its source.
- `android-frame.jsx`, `browser-window.jsx` — device/browser chrome used by the prototype (presentation only; do not port).
- `support.js` — prototype runtime (do not port).
