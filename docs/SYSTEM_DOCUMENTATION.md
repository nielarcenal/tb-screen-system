# TB-Screen BHW — System Documentation (As Built)

*Documentation date: July 8, 2026. Reflects the deployed system: server migrations 0001–0009, mobile release build, facility portal, and developer portal.*

---

## 1. System Overview

**TB-Screen BHW** is a tuberculosis **pre-screening and referral follow-up system** connecting Barangay Health Workers (BHWs) in Bukidnon province to public TB-DOTS facilities. It consists of an offline-tolerant Android application for BHWs, a web portal for TB-DOTS facility staff and Barangay Captains, a separate web portal for the system administrator, and a shared cloud backend.

### 1.1 Positioning statement (non-negotiable design rule)

The system is a **pre-screening support tool, not a diagnostic tool**. It never produces a diagnosis, a TB probability, a detection result, or a risk score of any kind. Its single clinical output is a **referral recommendation** ("meets / does not meet presumptive TB criteria") derived from the DOH National TB Program (NTP) symptom checklist alone. Diagnosis happens exclusively at TB-DOTS facilities through laboratory testing; facility staff *record* laboratory outcomes into the system — the system never computes them. This positioning is enforced structurally (no score column exists anywhere in the schema) and in all user-facing copy in three languages.

### 1.2 Components

| Component | Users | Technology | Connectivity |
|---|---|---|---|
| Mobile application | BHWs | Expo (React Native), TypeScript | Offline-first; syncs when online |
| Facility portal (`/`) | TB-DOTS staff, Barangay Captains | React + Vite, TypeScript | Online |
| Developer portal (`/admin.html`) | System administrator | React + Vite (same build, separate entry) | Online |
| Backend | — | Supabase: PostgreSQL, Auth, Edge Functions (Deno), pg_cron | Cloud |

---

## 2. Technology Stack

- **Mobile:** Expo SDK 57 / React Native, TypeScript (strict), React Native Paper (Material Design 3), Expo Router (file-based navigation), Zustand (state; persistent app store + transient session store), expo-sqlite (offline cache), i18next (en/tl/ceb), react-native-qrcode-svg, expo-print, expo-sharing, react-native-paper-dates.
- **Web:** React 18 + Vite (two HTML entries: facility portal and developer portal), TypeScript, i18next, plain CSS design system (no UI framework), supabase-js.
- **Backend:** Supabase — PostgreSQL 15 with Row-Level Security on every table; GoTrue email/password auth; two Deno Edge Functions (`manage-bhw`, `sms-reminders`); `pg_cron` + `pg_net` for the daily SMS schedule.
- **Version control:** three Git repositories (`mobile/`, `web/`, `supabase/`).

---

## 3. User Roles and Access Model

Roles live on the `users` table (`role` column) and are enforced server-side by Row-Level Security policies and by role checks inside SECURITY DEFINER functions and Edge Functions. The client UI adapts to the role but is never the security boundary.

| Role | Interface | Can see patient data? | Scope |
|---|---|---|---|
| `bhw` | Mobile app | Yes | Patients of their **assigned barangay**, plus patients they personally enrolled |
| `tb_dots` | Facility portal | Yes | All patients (read); referrals/appointments **addressed to their facility** (act) |
| `captain` | Facility portal | **No** — zero patient rows | BHW **accounts** of their assigned barangay only (names + activity counts) |
| `admin` | Developer portal | **No** — zero patient rows | Captain and TB-DOTS staff **accounts** (provisioning only) |

### 3.1 Account provisioning chain

Every account except the first administrator is created through the system's own UI (no Supabase dashboard access needed):

```
admin (created once, manually)
 └─ creates CAPTAIN accounts   — assigned one barangay; facility auto-derived
 └─ creates TB-DOTS STAFF      — assigned one facility (defines their portal)
      captains
       └─ create BHW accounts  — always in the captain's own barangay
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

A tenth, visually distinct **patient-reported** step records the PGI-S (Patient Global Impression of Severity) cough-severity rating (None / Mild / Moderate / Severe) in the patient's own words. PGI-S is **supplementary context only**: it is stored, displayed, and printed, but **never** feeds the referral rule.

**Referral rule** (the only decision logic in the system; a plain boolean, no weights, no score):

> Flag for referral (presumptive TB) when **any one cardinal symptom** is answered *Yes* — cough ≥ 2 weeks, fever, night sweats, weight loss, or hemoptysis — **or** when the patient is a close contact of a known TB case **and** reports any symptom at all. "Unsure" never counts as yes.

The result screen states the recommendation, the rule that fired, and the standing "this is not a diagnosis" note. The screening is saved once, on exit.

### 4.4 Referral and specimen form
For flagged screenings only, the BHW creates a referral: the receiving TB-DOTS facility is **pre-selected to the nearest center for the patient's barangay** (see §7; freely changeable), and a check-up appointment date is set. The system generates a printable **specimen referral form** — patient details, the full checklist with answers, the PGI-S rating labeled patient-reported, appointment, preparing BHW's name, the non-diagnostic footer, and a QR code carrying the structured referral data. **The QR payload excludes the patient's name and contact number** (the paper travels with the specimen). The form can be printed (OS print dialog / save as PDF) or shared as a PDF (expo-sharing).

### 4.5 Follow-up and home dashboard
The home screen shows a calm sync-status chip (teal = synced, amber = pending, neutral = offline — never alarming red), three tonal stat cards — upcoming check-ups, missed check-ups, did-not-present — which open a filtered follow-up list, the primary "enroll & screen" action, and newly recorded results. The patient record shows a four-step referral timeline (Submitted → Received → Tested → Result recorded), screening history with flagged/not-flagged chips, check-up attendance, and an Edit-details card (name, birthdate, sex, SMS opt-in).

### 4.6 Offline-first synchronization
The on-device SQLite database is the working store; every syncable row carries a local `pending`/`synced` flag. Sync pushes pending rows then pulls server changes per table using `updated_at` high-water-mark cursors; conflicts resolve by per-record **last-write-wins** (deliberately simple and explainable — no CRDTs). Auto-sync fires on reconnect. Reference data (PSGC) is bundled; facilities and the nearest-center mapping are pulled.

**Multi-account privacy:** signing out (after a confirmation dialog and a best-effort final push) **wipes the device's clinical cache** and resets sync cursors, so an account signing in later on the same phone starts from its own RLS-scoped pull and can never read the previous user's patients.

---

## 5. Facility Portal (TB-DOTS staff)

- **Dashboard** — today's counts from a server-side aggregate function: screenings submitted (catchment-wide), new referrals to this facility, outcomes recorded (tested positive / negative), and check-up attendance. Outcome counts are **facility-visible only**.
- **Referral inbox** — master-detail: a Patient / Barangay / Date / Status list (search by name, code, or specimen ID; status filter) with a side detail panel: patient header, the enrolling BHW's name ("Screened by …"), a compact read-only screening summary with the PGI-S tagged *patient-reported*, and the action stack — mark received (tap again to undo; locked once tested), record the laboratory outcome (**structured Positive/Negative buttons** + optional free-text notes; recorded by staff, never computed), presented / no-show flags (no-show updates the referring BHW's follow-up list), per-appointment attended/missed, and closing the referral.
- **Barangay hotspots** — presumptive-referral counts grouped **only** by barangay (PSGC code) over Last 30/60/90 days, rendered as ranked bars. Deliberately **surveillance, not contact tracing**: no household, sitio, address, or patient-level drill-down exists, and the counts come from a SECURITY DEFINER function that returns aggregates only.

**Captains** signing into the same portal see exactly one view — **BHW management**: their barangay's BHW accounts with 30-day activity counts (screenings/referrals attributed by enrolling BHW), add BHW (always into their own barangay), edit, reset password, deactivate/reactivate. A standing note states that no patient data appears in this view — and none can: captains have no patient-data policies at all.

## 6. Developer Portal (`/admin.html`)

A deliberately separate page with its own login. Two tabs: **Captain management** (create captains — pick the barangay via the PSGC cascade; the facility is auto-derived from the nearest-DOTS mapping; reset/deactivate) and **Staff management** (create TB-DOTS staff — pick the facility, which defines that account's entire portal scope; navigate accounts with a per-facility filter showing counts). Admin accounts signing into the facility portal are redirected here; non-admin accounts here are refused.

## 7. Facility Network and Nearest-Center Mapping

Eleven real public TB-DOTS facilities in Bukidnon are registered: Bukidnon Provincial Medical Center Hospital DOTS Center (Malaybalay) and the Health DOTS Centers of Malaybalay City, Valencia City, Don Carlos, Kalilangan, Kitaotao, Manolo Fortich, Maramag, Pangantucan, San Fernando, and Talakag.

Each of the 22 LGUs is mapped to its nearest center (`ref_cities.default_facility_id`); every barangay inherits its municipality's assignment. Because the system stores no coordinates, "nearest" is a **road-corridor approximation at the municipality level**, and the mapping is a *default only* — the BHW can always select a different facility, including the provincial center (which intentionally has no LGU default). Current assignments: Malaybalay CHO ← Malaybalay, Cabanglasan, Impasug-ong, Lantapan; Don Carlos ← Don Carlos, Dangcagan, Kibawe, Damulog, Kadingilan (the Cotabato road corridor); Maramag ← Maramag, Quezon; Manolo Fortich ← Manolo Fortich, Libona, Malitbog, Sumilao; Talakag ← Talakag, Baungon; Valencia, Kitaotao, Kalilangan, Pangantucan, and San Fernando each serve their own LGU.

## 8. SMS Reminder Pipeline

A scheduled Edge Function (`sms-reminders`) runs daily at 09:00 Asia/Manila (pg_cron at 01:00 UTC invoking the function via `pg_net`, authenticated by a shared `CRON_SECRET` header on top of the platform JWT check). It selects appointments scheduled **3 days out and again the day before** whose patient opted into SMS, sends one reminder per appointment through a **swappable gateway** module, and logs every attempt to `sms_log` (idempotent per calendar day — an appointment gets at most one reminder a day, so both lead-day reminders go out but a re-run never duplicates one). It also sends a one-time neutral **follow-up** for check-ups recently marked missed, unless the patient has already rebooked. Each patient is messaged in their own language (`patients.preferred_language`, en/tl/ceb).

- **Gateway abstraction:** the function talks only to an `SmsGateway` interface, so the provider is a configuration choice, not a code change. `SMS_GATEWAY=stub` logs sends without texting, so the whole pipeline is exercisable without credits; `semaphore` (+ `SEMAPHORE_API_KEY` and an **approved** `SEMAPHORE_SENDER_NAME`) is the intended production path; `textbee` (+ `TEXTBEE_API_KEY`) relays through an Android handset on its own SIM and needs no registered sender name. **Delivery was proven end to end on the `textbee` path on 2026-09-06**, the first real messages the system has sent. Semaphore remains blocked pending sender-name approval.
- **Accepted is not delivered:** every gateway reports `sent` when the provider *accepted* the message, never when a handset received it. The gap is widest on `textbee`, which queues to a phone that must be awake, online and in signal; the reminder path does not retry, so a `sent` row is a hand-off record, not proof of delivery.
- **Privacy:** only consented patients are ever queried (the DB constraint guarantees a number exists only alongside consent), and the message text is deliberately neutral — no "TB", no patient details — because SMS can be read by anyone holding the phone. `sms_log` has no client policies at all; only the service role writes it.

## 9. Data Model (PostgreSQL)

| Table | Purpose / key columns |
|---|---|
| `ref_regions/provinces/cities/barangays` | Official PSGC reference (Bukidnon scope). `ref_cities.default_facility_id` → nearest DOTS center |
| `facilities` | Health facilities; `type` ∈ barangay_health_station, tb_dots |
| `users` | One row per account: `role` (bhw/tb_dots/captain/admin), `full_name`, `facility_id`, `assigned_barangay_code`, `active` |
| `patients` | `display_code` (unique), `full_name`, `birthdate`, `age`, `sex`, `barangay_code`, `sitio`, `contact_number`, `sms_consent`, `consent_date`, `enrolled_by`. CHECK: number/consent-date only with consent |
| `screenings` | `symptom_flags` (jsonb tri-state answers), `pgis_severity`, `referred` (boolean — **no score column by design**) |
| `referrals` | `facility_id` (receiving), `specimen_id`, `status` (submitted/received/tested/closed), `result_outcome` (positive/negative, staff-recorded), `result` (free-text notes), `result_date`, `presented` (no-show flag) |
| `appointments` | `scheduled_date`, `attended_date`, `status` (scheduled/attended/missed) |
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
| 0006 | Patient `full_name` + `birthdate`; `result_outcome`; `captain` role + `users.active`; `dashboard_counts()`, `bhw_activity()` |
| 0007 | BHW scope = assigned barangay (+ own enrollments); TB-DOTS reads all patients; TB-DOTS may read BHW names |
| 0008 | `admin` role; captain scope tightened from facility to barangay |
| 0009 | 11 Bukidnon TB-DOTS facilities; nearest-center default per LGU |

## 10. Internationalization

All user-facing text in both apps goes through i18next keys in English, Tagalog, and Cebuano — including consent scripts, the symptom checklist, and the printed form. Tagalog/Cebuano strings are best-effort and flagged `TODO i18n verify` pending native-speaker review. Language is switchable at runtime everywhere (mobile onboarding + settings; portal top bar).

## 11. Design System

Both apps implement a shared visual language from the project's hi-fi design canvas: deep teal `#028090` primary, seafoam `#00A896` accent, warm off-white surfaces, fully-rounded pill buttons, large touch targets (≥ 52 px), and tonal status chips. Semantic color rules: **amber is reserved for the patient's own voice** (PGI-S) and did-not-present states, red only for missed check-ups, and **offline is a calm neutral, never red**. Design tokens live in `mobile/src/ui/tokens.ts` and the `:root` of `web/src/index.css`.

## 12. Security & Privacy Summary

1. Default-deny RLS on every table; the UI is never the security boundary.
2. Captains and admins can read **zero** patient rows — account management is fully separated from clinical data.
3. BHW visibility is barangay-scoped; facility staff act only on referrals addressed to them.
4. Laboratory outcomes are facility-visible; BHW devices do not store the structured outcome — BHWs track referral *progress*.
5. Contact numbers exist only alongside recorded SMS consent (database-enforced); the QR payload and SMS text carry no identifying clinical detail.
6. Hotspot surveillance is aggregate-only by barangay — structurally incapable of contact tracing.
7. Sign-out wipes the device's clinical cache (multi-account safety); sessions are the only thing Supabase persists on-device.
8. Service-role credentials exist only inside Edge Functions; account mutations are role-gated and scope-checked server-side; deactivation = auth ban, not just a flag.
9. All secrets (`.env`, service keys, cron secret) are excluded from version control.

## 13. Known Limitations and Future Work

- **Proximity is approximate:** nearest-facility mapping is municipality-level road-corridor judgment, not geodesic; per-barangay overrides or coordinates would refine it.
- **Translations pending native review** (`TODO i18n verify` markers).
- **Free-text result vs. outcome:** BHWs still see the legacy free-text result notes on their device (a pre-existing feature), while the structured positive/negative outcome is facility-only — a documented tension to resolve with stakeholders.
- `appointments` has no foreign key to `referrals` (the form shows the most recent scheduled appointment); flagged for a future migration.
- Attribution of screenings to BHWs uses the enrolling BHW (screenings carry no creator column) — accurate for the normal workflow.
- The portals are not yet publicly hosted (local/dev serving); the mobile app is installed via direct APK, not a store.
- Offline sign-out cannot push pending work (the dialog warns).
- SMS reminders send for real (verified 2026-09-06), but `sms_log.delivery_status` records provider *acceptance*, not handset delivery — there is no delivery-receipt callback. On the `textbee` path the pipeline also depends on one physical Android phone staying awake and in signal, and the reminder path does not retry, so a reminder missed that way is lost silently.
