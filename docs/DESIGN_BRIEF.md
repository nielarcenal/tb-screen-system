# TB-Screen BHW — UI Redesign Brief

Paste this whole document to your designer (human or AI). It contains everything
needed to redesign the two frontends without breaking the system's medical,
legal, and technical constraints. Attach screenshots of the current UI if you
have them.

---

## 1. What this system is

**TB-Screen BHW** links Barangay Health Workers (BHWs) and TB-DOTS facilities in
the Philippines for tuberculosis **pre-screening and referral follow-up**. Two
frontends share one Supabase backend:

- **Mobile app** (BHW, Android): works fully offline in the field; syncs when a
  connection appears. Enroll patient → DOH-NTP symptom checklist → referral +
  printed QR specimen form → follow-up dashboard.
- **Web portal** (TB-DOTS clinic staff, desktop): referral inbox → record lab
  result → mark attendance / no-show → barangay hotspot counts.

It is a **graded student capstone**, built and maintained by one person.

## 2. NON-NEGOTIABLES — the design MUST respect these

Any design that violates one of these is wrong, no matter how good it looks:

1. **Not a diagnosis.** No screen, label, icon, color, or metaphor may imply the
   app detects TB, computes risk, or gives a probability. Approved vocabulary:
   "pre-screening", "supports", "flags for referral", "presumptive TB".
   Forbidden: "diagnosis", "TB detected", "risk score", "probability",
   gauges/meters/percentages applied to a patient.
2. **No scoring UI.** Referral is decided by the DOH-NTP symptom checklist
   ALONE (a plain rule, not a number). There is deliberately NO score anywhere —
   never design a score display, progress-toward-referral meter, severity dial,
   or “8/10 symptoms” style summary. The checklist outcome is binary: flagged
   for referral / not flagged, plus which rule fired.
3. **PGI-S is supplementary.** The patient-rated cough severity
   (none/mild/moderate/severe) is recorded and displayed as context only. It
   must be visually separate from the checklist and must never look like an
   input to the referral outcome.
4. **Hotspot view = surveillance, not contact tracing.** It shows aggregate
   presumptive-case COUNTS grouped by barangay only. No map pins on households,
   no drill-down to people, no language about tracing contacts. A ranked
   list/bar is correct; a person-level map is not.
5. **Privacy by design.** The system stores NO patient names (patients are
   `PAT-XXXX-0001` codes). A phone number exists only with SMS consent, and it
   NEVER appears on the printed specimen form or inside its QR code. Don't
   design any element that surfaces contact info on shareable artifacts.
6. **Consent gating.** The mobile-number field only appears after the SMS
   opt-in toggle is on; declining SMS must still allow enrollment. The
   first-launch Terms + non-diagnostic disclaimer is a blocking full-screen
   step, re-viewable from Settings.

## 3. Fixed technical frame (design within it)

- **Mobile:** React Native + Expo, **React Native Paper (Material Design 3)**.
  Designs must map to Paper components (Appbar, Card, Chip, List, FAB,
  SegmentedButtons, Banner, Searchbar, DataTable, etc.). Navigation is
  expo-router with a **bottom tab bar: Home / Patients / Settings**; forms and
  detail screens push full-screen over the tabs. System fonts only. Currently
  light theme only (`userInterfaceStyle: light`); a dark theme is optional but
  must be a deliberate second palette, not an auto-invert.
- **Web portal:** React + Vite + **plain CSS** (no Tailwind/MUI/etc.). Keep it
  a token-based stylesheet (CSS custom properties). Structure: top bar, two
  tabs (Referral inbox / Barangay hotspots), tables + forms. Deliberately
  minimal — "tables and forms, not a full facility system".
- **No new libraries** may be introduced by the design (charts, animation,
  icon packs beyond @expo/vector-icons MaterialCommunityIcons, fonts). If a
  design idea needs one, it must be flagged as a question, not assumed.
- **Trilingual:** every string is an i18next key (en / Tagalog / Cebuano).
  Tagalog/Cebuano run ~20–35% longer than English — buttons, chips, tabs and
  tiles must tolerate that. Never design text into images.
- **Offline-first is visible UI:** rows carry `pending / synced` states, the
  header has a sync status (Synced / Syncing… / Offline / Tap to sync), and a
  signed-out state shows a sign-in banner. These states must exist in the
  redesign, ideally quieter but never hidden.
- **Current brand color:** teal — MD3 slots `primary #00696D`,
  `primaryContainer #9CF1F5`, `onPrimaryContainer #002021`,
  `secondaryContainer #CCE8E9`. Portal CSS uses `--brand #4A4458` (older
  purple; the portal has NOT yet been re-themed to teal — unifying both on one
  palette is desirable). Free to propose a new accessible palette; keep it calm
  and clinical, avoid alarm-red as a theme color (red is reserved for errors).

## 4. Users and context of use

**BHW (mobile).** Community health volunteers, often 35–60 years old, mixed
tech comfort, low-to-mid-range Android phones, used outdoors in bright sunlight
and sometimes with one hand. Implications: high contrast, big touch targets
(≥48dp), one obvious primary action per screen, minimal typing (pickers over
keyboards), forgiving forms, everything readable at arm's length. Language:
Tagalog or Cebuano first, English second.

**TB-DOTS staff (web).** Nurses/med-techs at a desk, keyboard + mouse, process
a queue of referrals daily. Implications: dense-but-scannable tables, status at
a glance, few clicks per action, visible confirmation after every write.

## 5. Screen inventory — mobile (12 screens)

For each screen: purpose / key content / actions / states to design.

1. **Welcome (first launch, blocking)** — non-diagnostic disclaimer + terms;
   single accept button. States: none. Sets the tone of the product.
2. **Home (tab 1, dashboard)** — primary CTA "Enroll & screen a patient";
   sync chip in header (Synced/Syncing/Offline/Tap to sync) + last-synced line;
   sign-in banner when signed out; "Needs attention" KPI row: three tappable
   count tiles (Upcoming check-ups / Missed / No-shows) — tapping a tile lists
   its items below; "New results" list (patient code + date + result text);
   "All caught up" empty state. Counts must read as neutral ink, status carried
   by icon + label (colorblind-safe), NEVER color alone.
3. **Patients (tab 2)** — search bar (by patient code), list rows: code,
   sex/age, sync chip; FAB "Enroll patient"; empty + no-match states.
4. **Settings (tab 3)** — account (email, sign in/out), language switcher
   (en/tl/ceb), "my assigned barangay" cascade picker with pending-push hint,
   view terms, developer reset.
5. **Sign-in** — email + password, provisioned-accounts note, error state.
6. **Enroll patient** — intro ("code assigned automatically; no names
   collected"), three sections: Patient details (age*, sex*), Address*
   (Region→Province→City→Barangay cascade pickers, pre-filled from the BHW's
   assigned barangay, plus free-text Sitio), Consent (consent checkbox*, SMS
   opt-in toggle revealing phone field, non-diagnostic reminder). Save disabled
   until valid; sign-in-required banner state.
7. **Patient detail** — code as title; info block (age/sex, barangay, sitio,
   SMS consent); sync chip; "Start screening" CTA; screening history: each row
   = date, flagged/not-flagged chip, PGI-S line, and for flagged ones the
   referral status chip (Submitted/Received/Tested/Closed), no-show chip,
   result line, and a "Create referral" or "Specimen form" button.
8. **Screening** — DOH-NTP checklist: 9 numbered questions, each answered
   yes / no / unsure (unsure is a first-class answer); progress bar "n of 9";
   PGI-S in a clearly separate optional block (4 options + clear button +
   "does not affect the recommendation" note); outcome card appears only when
   all 9 answered: "⚑ Refer this patient (presumptive TB)" with the rule that
   fired, or "✓ No referral flagged" with return-if-worse advice; always the
   "this is not a diagnosis" footnote; save button.
9. **Create referral** — patient + screening summary; receiving TB-DOTS
   facility (radio list, auto-selected if only one); appointment date picker
   (min = today); blocked states: "already has a referral", "only flagged
   screenings can create a referral".
10. **Specimen form** — specimen ID prominent; QR code (~200px) with caption
    "scan at the TB-DOTS facility"; patient summary, facility, appointment
    date; "Print / save PDF" button; non-diagnostic subheading. The printed
    PDF mirrors this (A4/A5, monochrome-friendly, signature line).
11. **Terms (re-view)** — read-only disclaimer + accepted-on date.
12. **(system states everywhere)** — offline chip, pending/synced badges,
    sync error line, loading, empty lists.

## 6. Screen inventory — web portal (4 views)

1. **Login** — email/password card, staff-provisioned note, error inline,
   non-diagnostic footnote pinned at page bottom (all views).
2. **Referral inbox** — toolbar: search (patient/specimen code), status filter
   (All/Submitted/Received/Tested/Closed), refresh; table columns: specimen ID,
   patient code, barangay, referred-on, status chip, presented (Yes / No-show /
   —), result; row click opens detail; empty + error states.
3. **Referral detail** — header: patient code + specimen ID + status chip;
   patient block (age/sex, barangay, sitio); read-only screening block
   (9 checklist answers table + PGI-S supplementary line); actions block:
   "Mark received" (only when Submitted), Presented / No-show toggle buttons,
   free-text lab result + "Save result (marks as tested)" + recorded-on line,
   "Close referral"; appointments table (scheduled / attended / status) with
   "Mark attended (today)" / "Mark missed" per scheduled row; back to inbox.
4. **Barangay hotspots** — date range (from/to, default last 30 days) + Apply;
   ranked table: #, barangay, city/municipality, presumptive-case count, and a
   proportional bar relative to the period max; intro line stating it counts
   patients flagged by the checklist, once each, across all BHWs — "counts
   only; surveillance, not contact tracing"; empty state.

## 7. Core flows (design these end-to-end, not screen-by-screen)

- **Field loop (mobile):** Home → Enroll (consent!) → Screening → outcome →
  Create referral → Specimen form → print → hand form + specimen to courier.
  Target: a BHW completes it in under 4 minutes with no dead ends.
- **Clinic loop (web):** inbox row → mark received → (patient arrives →
  presented + mark attended | never arrives → no-show + mark missed) → enter
  lab result → close.
- **Follow-up loop (mobile):** sync pulls results/no-shows → Home tiles/new
  results → open patient → BHW follows up in person.
- **Offline loop:** everything in the field loop must work with zero
  connectivity; the design shows what's waiting to sync without nagging.

## 8. Voice & tone

Plain, calm, respectful; instructions to the BHW ("Ask the patient…"), never
clinical jargon at the patient. Reassuring rather than alarming — a flagged
screening is "needs referral for testing", not an emergency. Every screen that
shows screening data carries the non-diagnostic reminder in some quiet form.
All copy must be written as i18n keys with en/tl/ceb variants (tl/ceb may be
marked for native-speaker review).

## 9. What the redesign MAY and MAY NOT change

**May:** layout, visual hierarchy, spacing, palette (both apps — unifying them
is welcome), iconography (MaterialCommunityIcons set), component arrangement,
empty states, micro-copy (within the vocabulary rules), the printed form's
layout, a deliberate dark theme.

**May not:** the tech stack or component libraries; the bottom-tab structure's
three destinations (Home/Patients/Settings) without strong justification; the
checklist's 9 items, tri-state answers, or its role as sole decider; any
non-negotiable in §2; adding data the schema doesn't have (e.g., patient
names/photos — they don't exist on purpose).

## 10. Requested deliverables from the designer

1. A small **design-token sheet** shared by both apps: palette (with MD3 slot
   mapping for mobile and CSS custom properties for web), type scale, spacing,
   radius, elevation, status-chip colors (submitted/received/tested/closed,
   pending/synced, no-show) — colorblind-safe, WCAG AA on their surfaces.
2. **Screen-by-screen specs** for the 12 mobile screens naming the React
   Native Paper component per element (so a solo student can implement them
   1:1), including empty/loading/error/offline states.
3. **Portal specs** for the 4 views as annotated layouts + the CSS token
   values.
4. **Print spec** for the specimen form (monochrome, A4/A5).
5. A short **rationale** per major decision (why this reads clearer for a
   50-year-old BHW in sunlight).
