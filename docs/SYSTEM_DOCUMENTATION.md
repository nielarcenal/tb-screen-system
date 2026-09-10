# TB-Screen BHW — System Documentation (As Built)

*Reconciled September 10, 2026. Reflects deployed server migrations 0001–0039, the mobile release candidate, and all three web portal entries.*

---

## 1. System Overview

**TB-Screen BHW** is a tuberculosis **pre-screening and referral follow-up system** connecting Barangay Health Workers (BHWs) in Bukidnon province to public TB-DOTS facilities. It consists of an offline-tolerant Android application for BHWs, a web portal for TB-DOTS facility staff and Barangay Midwives, a separate web portal for the system administrator, and a shared cloud backend.

### 1.1 Positioning statement (non-negotiable design rule)

The system is a **pre-screening support tool, not a diagnostic tool**. It never produces a diagnosis, a TB probability, a detection result, or a risk score of any kind. Its single clinical output is a **referral recommendation** ("meets / does not meet presumptive TB criteria") derived from the DOH National TB Program (NTP) symptom checklist alone. Diagnosis happens exclusively at TB-DOTS facilities through laboratory testing; facility staff *record* laboratory outcomes into the system — the system never computes them. This positioning is enforced structurally (no score column exists anywhere in the schema) and in all user-facing copy in three languages.

### 1.2 Components

| Component | Users | Technology | Connectivity |
|---|---|---|---|
| Mobile application | BHWs | Expo (React Native), TypeScript | Offline-first; syncs when online |
| Facility portal (`/`) | TB-DOTS staff | React + Vite, TypeScript | Online |
| Midwife portal (`/midwife.html`) | Barangay Midwives | React + Vite, TypeScript | Online |
| Developer portal (`/admin.html`) | System administrator | React + Vite (same build, separate entry) | Online |
| Backend | — | Supabase: PostgreSQL, Auth, Edge Functions (Deno), pg_cron | Cloud |

---

## 2. Technology Stack

- **Mobile:** Expo SDK 57 / React Native, TypeScript (strict), React Native Paper (Material Design 3), Expo Router (file-based navigation), Zustand (state; persistent app store + transient session store), expo-sqlite (offline cache), i18next (en/tl/ceb), react-native-qrcode-svg, expo-print, expo-sharing, react-native-paper-dates.
- **Web:** React 19 + Vite (facility, midwife, and developer HTML entries), TypeScript, i18next, plain CSS design system (no UI framework), supabase-js.
- **Backend:** Supabase — PostgreSQL 15 with Row-Level Security on every table; GoTrue email/password auth; two Deno Edge Functions (`manage-bhw`, `sms-reminders`); `pg_cron` + `pg_net` for the daily SMS schedule.
- **Version control:** one repository; the original mobile/web/Supabase histories remain reachable through subtree merges.

---

## 3. User Roles and Access Model

Roles live on the `users` table (`role` column) and are enforced server-side by Row-Level Security policies and by role checks inside SECURITY DEFINER functions and Edge Functions. The client UI adapts to the role but is never the security boundary.

| Role | Interface | Can see patient data? | Scope |
|---|---|---|---|
| `bhw` | Mobile app | Yes | Patients of their **assigned barangay**, plus patients they personally enrolled; exact demographic lookup can only notify about an existing out-of-scope identity |
| `tb_dots` | Facility portal | Yes | Exact demographic identity lookup is province-wide; clinical rows require a referral, walk-in, appointment, or case owned by the facility, and mutations remain facility-scoped |
| `midwife` | Facility portal | **No** — zero patient rows | BHW **accounts** of their assigned barangay only (names + activity counts) |
| `admin` | Developer portal | **No** — zero patient rows | Midwife and TB-DOTS staff **accounts** (provisioning only) |

### 3.1 Account provisioning chain

Every account except the first administrator is created through the system's own UI (no Supabase dashboard access needed):

```
admin (created once, manually)
 └─ creates MIDWIFE accounts   — assigned one barangay; facility auto-derived
 └─ creates TB-DOTS STAFF      — assigned one facility (defines their portal)
      midwives
       └─ create BHW accounts  — always in the midwife's own barangay
```

Account creation is performed by the `manage-bhw` Edge Function using the service-role key (which never reaches a browser). Emails are auto-generated as `firstname.lastname@tbscreen.ph` (suffix `.2`, `.3`… on collision); a random temporary password (`TBS-####-xxxx`) is displayed exactly once. Passwords are stored only as hashes and can never be viewed — only reset (any manager can issue a new temporary password for their scope). Deactivation sets `users.active = false` *and* bans the auth account, which is what actually blocks sign-in; reactivation lifts both.

---

## 4. BHW Mobile Application

### 4.1 Onboarding
Language picker (English / Tagalog / Cebuano, switchable app-wide at any time) → Terms & Conditions with the prominent non-diagnostic disclaimer (accepted once, re-viewable from Settings) → sign-in with the provisioned account. After the first online sign-in, the session is cached and daily work never requires the login screen.

### 4.2 Patient enrollment
Collects full name, birthdate (age computed live and stored), sex, and the PSGC address cascade Region → Province → City/Municipality → Barangay (bundled offline for all of Bukidnon: 22 LGUs, 464 barangays; pre-filled from the BHW's assigned barangay, editable per patient), optional free-text sitio, informed consent (a deliberate toggle, never pre-checked, with plain-language script read to the patient), and an optional SMS-reminder opt-in.

**Privacy invariant (database CHECK constraint):** the patient's mobile number and the consent date are stored **only** while SMS consent is true; declining SMS never blocks enrollment. The SMS opt-in can be changed later from the patient record, and disabling it deletes the stored number.

Patient codes are generated **on the device** as `PAT-<4-char device code>-<sequence>`, where the device code is random per installation — offline devices cannot collide, and the code is server-side UNIQUE as a final guard.

### 4.3 Symptom screening (DOH-NTP checklist)
One question per screen with large tri-state answer buttons (**Yes / No / Unsure**), a progress bar, and a review screen where any answer can be revised before finishing. The nine checklist items: cough ≥ 2 weeks, unexplained weight loss, night sweats, unexplained fever, hemoptysis, chest pain, fatigue, loss of appetite, close contact with a known TB case.

A tenth, visually distinct **patient-reported** step records the PGI-S (Patient Global Impression of Severity) cough-severity rating (None / Mild / Moderate / Severe) in the patient's own words. An eleventh, **entirely optional** step records vital signs — height, weight, temperature, blood pressure, pulse rate, SpO2 — every field skippable, because a BHW whose thermometer or oximeter is flat that day must still be able to finish a screening; BMI is computed from height and weight at display and print time and is deliberately not stored. Both PGI-S and vitals are **supplementary context only**: they are stored, displayed, and printed, but **never** feed the referral rule. That is enforced structurally as well as by convention — the vitals module exports no classifier of any kind, and tests assert both that absence and that the referral rule still takes the checklist and nothing else.

**Referral rule** (the only decision logic in the system; a plain boolean, no weights, no score):

> Flag for referral (presumptive TB) when **any one cardinal symptom** is answered *Yes* — cough ≥ 2 weeks, fever, night sweats, weight loss, or hemoptysis — **or** when the patient is a close contact of a known TB case **and** reports any symptom at all. "Unsure" never counts as yes.

The result screen states the recommendation, the rule that fired, and the standing "this is not a diagnosis" note. The screening is saved once, on exit.

### 4.4 Referral and referral document
For flagged screenings only, the BHW creates a referral: the receiving TB-DOTS facility is **pre-selected to the nearest center for the patient's barangay** (see §7; freely changeable), and a check-up appointment date is set. Creating and syncing that referral **is** the hand-off — it reaches the facility portal whether or not anything is ever printed.

The system can then generate a printable **referral document** — patient details, the full checklist with answers, the PGI-S rating labeled patient-reported, whichever vitals were measured, appointment, preparing BHW's name, a note that sputum collection and testing happen at the facility, the non-diagnostic footer, and a QR code (payload v2) carrying the structured referral data. **The QR payload excludes the patient's name and contact number**, because the paper can pass through several hands and anyone holding it can scan it. The document can be printed (OS print dialog / save as PDF) or shared as a PDF (expo-sharing).

**Printing is optional and the screen says so.** This is a correction of the original build, not a refinement of it: the feature was called a "specimen form" and assumed a physical sputum sample travelled with the patient from the barangay. It does not. Sputum is collected only at the TB-DOTS facility, so nothing physical passes through the BHW, and the printed sheet is informational — a courtesy copy for the patient. `referrals.lab_sample_id` (was `specimen_id`) belongs to the facility and is entered there when the sample is actually taken; the app no longer generates one. See `docs/TBScreen_Referral_Model_Correction_and_Vitals_Addendum.md`.

### 4.5 Follow-up and home dashboard
The home screen shows a calm sync-status chip (teal = synced, amber = pending, neutral = offline — never alarming red), three tonal stat cards — upcoming check-ups, missed check-ups, did-not-present — which open a filtered follow-up list, the primary "enroll & screen" action, and newly recorded results. The patient record shows a four-step referral timeline (Submitted → Received → Tested → Result recorded), screening history with flagged/not-flagged chips, check-up attendance, and an Edit-details card (name, birthdate, sex, SMS opt-in).

### 4.6 Offline-first synchronization
The on-device SQLite database is the working store; every syncable row carries a local `pending`/`synced` flag. Sync pushes pending rows then pulls server changes per table using `updated_at` high-water-mark cursors; conflicts resolve by per-record **last-write-wins** (deliberately simple and explainable — no CRDTs). Auto-sync fires on reconnect. Reference data (PSGC) is bundled; facilities and the nearest-center mapping are pulled.

**Multi-account privacy:** signing out (after a confirmation dialog and a best-effort final push) **wipes the device's clinical cache** and resets sync cursors, so an account signing in later on the same phone starts from its own RLS-scoped pull and can never read the previous user's patients.

---

## 5. Facility Portal (TB-DOTS staff)

- **Dashboard** — today's counts from a server-side aggregate function: screenings submitted (catchment-wide), new referrals to this facility, outcomes recorded (tested positive / negative), and check-up attendance. Outcome counts are **facility-visible only**.
- **Referral inbox** — master-detail: a Patient / Barangay / Date / Status list (search by name, patient code, or laboratory sample ID; status filter) with a side detail panel: patient header, the enroller's name ("Screened by … (BHW)", or "Registered at this facility by …" for a walk-in), a compact read-only screening summary with the PGI-S tagged *patient-reported* and any vital signs shown as plain measurements with units and no interpretation, and the action stack — mark received (tap again to undo; locked once tested), enter the **laboratory sample ID** (offered only once the referral is received, because before the patient arrives there is no sample to name), record the laboratory outcome (**structured Positive/Negative buttons** + optional free-text notes; recorded by staff, never computed), presented / no-show flags (no-show updates the referring BHW's follow-up list), per-appointment attended/missed, and closing the referral.
- **Register patient** — for walk-in and self-referred patients who never went through a BHW. Records the same details, the same DOH-NTP checklist, the same PGI-S and the same optional vitals the mobile app collects, then writes the whole chain — patient → screening → referral — with the referral filed as already `received`, since the patient is standing at the desk. A facility-registered patient behaves identically to a BHW-referred one everywhere downstream (hotspot counts, result recording, follow-up). Patient codes here are `PAT-DOTS-####`, issued by a server-side sequence rather than the mobile app's offline `PAT-<device>-<seq>` scheme.
- **Barangay hotspots** — presumptive-referral counts grouped **only** by barangay (PSGC code) over Last 30/60/90 days, rendered as ranked bars. Deliberately **surveillance, not contact tracing**: no household, sitio, address, or patient-level drill-down exists, and the counts come from a SECURITY DEFINER function that returns aggregates only.
- **Case registry and treatment follow-up** — explicit case enrolment, reviewed lifecycle transitions, attended/missed scheduling, retained follow-up history with correction/void flows, and a source-isolated patient timeline.
- **Attention dashboard and audit viewer** — count-only facility metrics and a keyset-paginated activity trail. The viewer inherits `audit_logs` RLS and appears only for TB-DOTS staff.

**Midwives** signing into the same portal see exactly one view — **BHW management**: their barangay's BHW accounts with 30-day activity counts (screenings/referrals attributed by enrolling BHW), add BHW (always into their own barangay), edit, reset password, deactivate/reactivate. A standing note states that no patient data appears in this view — and none can: midwives have no patient-data policies at all.

## 6. Developer Portal (`/admin.html`)

A deliberately separate page with its own login. Two tabs: **Midwife management** (create midwives — pick the barangay via the PSGC cascade; the facility is auto-derived from the nearest-DOTS mapping; reset/deactivate) and **Staff management** (create TB-DOTS staff — pick the facility, which defines that account's entire portal scope; navigate accounts with a per-facility filter showing counts). Admin accounts signing into the facility portal are redirected here; non-admin accounts here are refused.

## 7. Facility Network and Nearest-Center Mapping

Eleven real public TB-DOTS facilities in Bukidnon are registered: Bukidnon Provincial Medical Center Hospital DOTS Center (Malaybalay) and the Health DOTS Centers of Malaybalay City, Valencia City, Don Carlos, Kalilangan, Kitaotao, Manolo Fortich, Maramag, Pangantucan, San Fernando, and Talakag.

Each of the 22 LGUs is mapped to its nearest center (`ref_cities.default_facility_id`); every barangay inherits its municipality's assignment. Because the system stores no coordinates, "nearest" is a **road-corridor approximation at the municipality level**, and the mapping is a *default only* — the BHW can always select a different facility, including the provincial center (which intentionally has no LGU default). Current assignments: Malaybalay CHO ← Malaybalay, Cabanglasan, Impasug-ong, Lantapan; Don Carlos ← Don Carlos, Dangcagan, Kibawe, Damulog, Kadingilan (the Cotabato road corridor); Maramag ← Maramag, Quezon; Manolo Fortich ← Manolo Fortich, Libona, Malitbog, Sumilao; Talakag ← Talakag, Baungon; Valencia, Kitaotao, Kalilangan, Pangantucan, and San Fernando each serve their own LGU.

## 8. SMS Reminder Pipeline

A scheduled Edge Function (`sms-reminders`) runs daily at 09:00 Asia/Manila (pg_cron at 01:00 UTC invoking the function via `pg_net`, authenticated by a shared `CRON_SECRET` header on top of the platform JWT check). It selects appointments scheduled **5 days out and again on the morning of the appointment itself** whose patient opted into SMS, sends one reminder per appointment through a **swappable gateway** module, and logs every attempt to `sms_log` (idempotent per calendar day — an appointment gets at most one reminder a day, so both lead-day reminders go out but a re-run never duplicates one). The run matches `scheduled_date` **exactly** and fires only once a day, so a check-up booked less than five clear days ahead never hits the 5-day offset: the honest claim is **up to two** reminders, with the same-day one as the dependable backstop. It also sends a one-time neutral **follow-up** for check-ups recently marked missed, unless the patient has already rebooked. Each patient is messaged in their own language (`patients.preferred_language`, en/tl/ceb).

- **Gateway abstraction:** the function talks only to an `SmsGateway` interface, so the provider is a configuration choice, not a code change. `SMS_GATEWAY=stub` logs sends without texting, so the whole pipeline is exercisable without credits; `semaphore` (+ `SEMAPHORE_API_KEY` and an **approved** `SEMAPHORE_SENDER_NAME`) is the production path and has been **live since 2026-09-08**, once the sender name `HealthRmdr` was approved; `textbee` (+ `TEXTBEE_API_KEY`) relays through an Android handset on its own SIM and needs no registered sender name. Delivery was first proven end to end on the `textbee` path on 2026-09-06 — those were the first real messages the system ever sent, and TextBee served as the stand-in while sender-name approval was outstanding. It is retained only as a fallback the deployment can revert to with a single flag.
- **Accepted is not delivered:** every gateway reports `sent` when the provider *accepted* the message, never when a handset received it. The gap was widest on `textbee`, which queues to a phone that must be awake, online and in signal; on `semaphore` it narrows to a carrier hand-off but does not close. The reminder path does not retry, so a `sent` row is a hand-off record, not proof of delivery — and because the same-day reminder is the last in the sequence, a failure there is final for that appointment.
- **Privacy:** only consented patients are ever queried (the DB constraint guarantees a number exists only alongside consent), and the message text is deliberately neutral — no "TB", no patient details — because SMS can be read by anyone holding the phone. `sms_log` has no client policies at all; only the service role writes it.

## 9. Data Model (PostgreSQL)

| Table | Purpose / key columns |
|---|---|
| `ref_regions/provinces/cities/barangays` | Official PSGC reference (Bukidnon scope). `ref_cities.default_facility_id` → nearest DOTS center |
| `facilities` | Health facilities; `type` ∈ barangay_health_station, tb_dots |
| `users` | One row per account: `role` (bhw/tb_dots/midwife/admin), `full_name`, `facility_id`, `assigned_barangay_code`, `active` |
| `patients` | `display_code` (unique), `full_name`, `birthdate`, `age`, `sex`, `barangay_code`, `sitio`, `contact_number`, `sms_consent`, `consent_date`, `enrolled_by`. CHECK: number/consent-date only with consent |
| `screenings` | `symptom_flags` (jsonb tri-state answers), `pgis_severity`, seven nullable vital-sign columns (`height_cm`, `weight_kg`, `temperature_c`, `systolic_bp`, `diastolic_bp`, `pulse_rate`, `spo2_percent`), `referred` (boolean — **no score column by design**; BMI is computed at display time, never stored) |
| `referrals` | `facility_id` (receiving), `lab_sample_id` (**owned by TB-DOTS**, entered when the sample is collected on-site), `status` (submitted/received/tested/closed), `result_outcome` (positive/negative, staff-recorded), `result` (free-text notes), `result_date`, `presented` (no-show flag) |
| `appointments` | Facility-owned scheduler; referral or case link, `scheduled_date`, `attended_date`, status (scheduled/attended/missed/cancelled) |
| `tb_cases` | One treatment episode per patient at a time; facility owner, lifecycle, treatment start and accepted outcome vocabulary |
| `treatment_followups` | Retained visit record linked to a case and optional case appointment; correction/void metadata |
| `audit_logs` | Server-written, fail-closed whitelisted change history; facility/admin SELECT policies only |
| `sms_log` | One row per reminder attempt; `delivery_status` (queued/sent/failed/stubbed) |

Every table has RLS enabled (default-deny). Aggregate reads that must cross row boundaries (`hotspot_counts`, `dashboard_counts`, `bhw_activity`) and policy helper lookups (`current_user_role/facility/barangay`, `bhw_visible_patient_ids`, `referred_patient_ids/screening_ids`) are SECURITY DEFINER functions with explicit role gates — a pattern that also eliminated a policy-recursion bug (patients ⇄ referrals cycle) found in live testing.

### 9.1 Migration history

| Migration | Contents |
|---|---|
| 0001 | Schema: reference tables, facilities, users, patients (consent CHECK), screenings, referrals, appointments, sms_log |
| 0002 | RLS everywhere; role/facility policy helpers; BHW facility-scoped and TB-DOTS referral-scoped policies |
| 0003 | pg_cron daily schedule for `sms-reminders` |
| 0004 | `hotspot_counts()` — barangay-level aggregate counts, TB-DOTS only |
| 0005 | Fix RLS recursion (patients ⇄ referrals) via SECURITY DEFINER id-set helpers |
| 0006 | Patient `full_name` + `birthdate`; `result_outcome`; `midwife` role + `users.active`; `dashboard_counts()`, `bhw_activity()` |
| 0007 | BHW scope = assigned barangay (+ own enrollments); TB-DOTS reads all patients; TB-DOTS may read BHW names |
| 0008 | `admin` role; midwife scope tightened from facility to barangay |
| 0009 | 11 Bukidnon TB-DOTS facilities; nearest-center default per LGU |
| 0010–0023 | Patient name parts; TB-DOTS appointment insert; admin overview and facility writes; BHW profile fields; SMS language and kinds; RLS hardening (column-scoped `users` update, narrow BHW referral update); Manila business calendar; password-change gate; immutable identity columns; `patients_tbdots_read` narrowed back to referred-only; admin BHW management |
| 0024 | Referral-model correction: `referrals.specimen_id` → `lab_sample_id` (ownership moves to TB-DOTS); seven optional vital-sign columns on `screenings` |
| 0025 | TB-DOTS may register walk-in patients directly: insert policies on `patients`/`screenings`/`referrals`, `own_enrolled_patient_ids()`, `next_facility_patient_code()` |
| 0026–0030 | Midwife rename; barangay report; null-safe role gates; active-aware RLS; Manila report boundaries |
| 0031 | Case registry, treatment follow-ups, appointment ownership, idempotent RPCs, whitelisted audit foundation |
| 0032–0034 | Atomic walk-in registration; old-client appointment compatibility; non-mutating overdue detection |
| 0035–0038 | Referral audit, source-isolated timeline, facility attention dashboard, authoritative appointment audit and facility viewer |
| 0039 | Exact-match shared Bukidnon patient identity registry, atomic existing-identity walk-in, and Barangay Report v2 case/outcome aggregates |

## 10. Internationalization

All user-facing text in both apps goes through i18next keys in English, Tagalog, and Cebuano — including consent scripts, the symptom checklist, and the printed form. Native-speaker review of the pre-0039 Tagalog/Cebuano copy passed on 2026-09-10; the new shared-registry warning strings still need the same human check. Language is switchable at runtime everywhere (mobile onboarding + settings; portal top bar).

## 11. Design System

Both apps implement a shared visual language from the project's hi-fi design canvas: deep teal `#028090` primary, seafoam `#00A896` accent, warm off-white surfaces, fully-rounded pill buttons, large touch targets (≥ 52 px), and tonal status chips. Semantic color rules: **amber is reserved for the patient's own voice** (PGI-S) and did-not-present states, red only for missed check-ups, and **offline is a calm neutral, never red**. Design tokens live in `mobile/src/ui/tokens.ts` and the `:root` of `web/src/index.css`.

## 12. Security & Privacy Summary

1. Default-deny RLS on every table; the UI is never the security boundary.
2. Midwives and admins can read **zero** patient rows — account management is fully separated from clinical data.
3. BHW visibility is barangay-scoped; facility staff act only on referrals addressed to them.
4. BHW devices receive the structured positive/negative referral outcome needed for follow-up, but never the facility's free-text result notes.
5. Contact numbers exist only alongside recorded SMS consent (database-enforced); the QR payload and SMS text carry no identifying clinical detail.
6. Hotspot surveillance is aggregate-only by barangay — structurally incapable of contact tracing.
7. Sign-out wipes the device's clinical cache (multi-account safety); sessions are the only thing Supabase persists on-device.
8. Service-role credentials exist only inside Edge Functions; account mutations are role-gated and scope-checked server-side; deactivation = auth ban, not just a flag.
9. All secrets (`.env`, service keys, cron secret) are excluded from version control.
10. Province-wide sharing is an exact-match identity service, not a patient browser. It returns minimal demographics and a masked phone; clinical records still require an existing facility relationship under RLS.

## 13. Known Limitations and Future Work

- **Proximity is approximate:** nearest-facility mapping is municipality-level road-corridor judgment, not geodesic; per-barangay overrides or coordinates would refine it.
- **Translations pending native review** (`TODO i18n verify` markers).
- **Free-text result vs. outcome (settled 2026-09-06):** BHWs see the structured positive/negative outcome; the facility's free-text `result` notes never reach a BHW device at all. D-05 blocked them at three layers — the sync pulls referrals by explicit column list rather than `*` (RLS cannot restrict columns, and a column GRANT cannot separate BHWs from TB-DOTS staff since both authenticate as `authenticated`), local migration v9 NULLs the column before dropping it so cached values are not left recoverable in freed pages, and no screen renders it. Showing the outcome is deliberate: a BHW's follow-up job is getting a positive patient back to the facility to start treatment, which they cannot prioritise without it. An earlier revision of this note described the situation exactly backwards.
- **Referral model corrected (2026-09-06):** the build had assumed a sputum sample travels from the BHW to TB-DOTS, and shipped a "specimen form" and a BHW-generated `specimen_id` on that assumption. Confirmed with the TB-DOTS head nurse that collection and testing happen **only** at the facility. The concept is now an optional printed **referral document**, and `lab_sample_id` is entered by facility staff. Full account, including what was verified against the live database: `docs/TBScreen_Referral_Model_Correction_and_Vitals_Addendum.md`.
- **Walk-in registration is transactional.** Migration 0032's idempotent `register_walkin()` RPC writes patient, screening, referral, and replay record together or rolls them all back.
- **Existing-patient reuse is transactional.** Migration 0039's exact lookup lets TB-DOTS attach a new screening/referral episode to the canonical patient without copying the patient row; offline-created mobile patients are checked before reconnect upload.
- **Barangay Report v2 is not ITIS.** It reports TB-Screen counts and only explicit staff-recorded treatment outcomes. Overdue/missed appointments are not inferred as lost to follow-up.
- **Vitals are recorded but not yet used anywhere except display and print.** No trend view, no comparison across a patient's screenings. Any such feature must stay descriptive — vitals must never acquire a threshold, a category, or a colour that reads as a verdict (§1, §5).
- Appointments carry patient/facility-agreeing composite links to either a referral or a TB case; the links are mutually exclusive.
- Attribution of screenings to BHWs uses the enrolling BHW (screenings carry no creator column) — accurate for the normal workflow.
- The portals are not yet publicly hosted (local/dev serving); the mobile app is installed via direct APK, not a store.
- Offline sign-out cannot push pending work (the dialog warns).
- SMS reminders send for real (verified 2026-09-06), but `sms_log.delivery_status` records provider *acceptance*, not handset delivery — there is no delivery-receipt callback. The reminder path does not retry, so a reminder lost after acceptance is lost silently. The system now runs on `semaphore`; on the `textbee` fallback the pipeline would additionally depend on one physical Android phone staying awake and in signal.
- **Mobile data at rest:** the clinical cache is ordinary app-sandboxed SQLite and the Supabase session uses AsyncStorage; neither is application-level encrypted. Managed devices should require a device PIN/biometric and remote-wipe process. An encrypted cache/session design is required before a higher-risk production deployment.
- **Database grants:** legacy Supabase table grants are broader than least privilege, although every public table has RLS and clients contain only the anon key. Narrow them in a dedicated reviewed migration; do not rewrite them casually during release.
- **Audit retention:** no automatic purge is configured. That conservative release-candidate choice avoids destroying a health-record trail; real production needs a health-office-approved retention/archive and capacity policy.
