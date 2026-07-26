# TB-Screen — Web Portal Design Handoff

**Purpose:** everything Claude Design needs to redesign the web surfaces, without access to the codebase. Describes what exists today, then the proposed target.

**Companion documents:** the original Design Brief, and `TBScreen_Web_Redesign_and_Branding_Addendum_1.md` (which this implements).

---

## 1. What the product is

TB-Screen BHW is a **TB pre-screening and referral follow-up tool** for the Philippines (Bukidnon province). Barangay Health Workers (BHWs) screen patients on an offline-tolerant Android app; TB-DOTS facilities receive those referrals and record laboratory outcomes on the web portal.

The web portal is the **staff-facing half**. It is an internal tool, not a public product.

### Non-negotiable constraints — read before designing anything

These are enforced project rules. A design that violates them gets rejected, so they shape the visual language:

1. **Never diagnostic.** Nothing may be labelled diagnosis, TB probability, TB detection, or risk score. Approved vocabulary: *pre-screening*, *supports*, *flags for referral*, *presumptive*. Only TB-DOTS facilities diagnose.
2. **No scoring, anywhere.** Referral is decided by the DOH-NTP symptom checklist alone. There is deliberately no score column in the database. Do **not** design gauges, risk meters, percentage rings, severity scores, or "confidence" indicators. PGI-S (a patient-reported severity item) is displayed as supplementary context only — it never feeds a score and never triggers a referral.
3. **Laboratory outcomes are recorded by humans, never computed.** Positive/negative comes from a staff member typing it in after testing. Design it as data entry, not as a system verdict.
4. **The hotspot view is surveillance, not contact tracing.** Counts aggregate by barangay only. No household, sitio, address, or per-patient drill-down may be designed into it. Never label it contact tracing.
5. **Role data boundaries are hard.** Captains can see **no patient data of any kind**. Admins have no patient-data access at all — nothing clinical can render in their space. BHWs never see laboratory outcomes; those are facility-only.
6. **Trilingual: English / Tagalog / Cebuano.** A language switcher is always present. Filipino and Cebuano strings run visibly longer than English — layouts must tolerate roughly 30–40% text expansion without breaking. Don't design to fixed-width labels.

### Scale — design for small numbers

Real volumes: 12 facilities, ~5 staff accounts, single-digit to low-double-digit referrals. Tables hold tens of rows, not thousands. Don't design for pagination, virtualization, or dense data-grid tooling. Empty states will be seen often and matter more than dense states.

---

## 2. Roles and access

| Role | Where they work | What they can see |
|---|---|---|
| **BHW** | Mobile app only — never the web portal | Their own barangay's patients, screenings, referral progress. Not lab outcomes. |
| **TB-DOTS staff** | Facility space | Referrals addressed to their facility, patient + screening detail, lab outcome entry, barangay hotspots |
| **Barangay Captain** | Captain space | BHW **accounts** only, plus 30-day activity counts. Zero patient data. |
| **Admin / developer** | Admin space | Provisioning only: captain and facility-staff accounts. Zero patient data. |

Everything is scoped server-side by row-level security — the UI never filters by facility itself. Design accordingly: a user simply sees their own scope, with no "switch facility" control.

---

## 3. Current state

### Architecture as built

Two separate pages in one build:

- **`index.html`** — the facility portal. Serves **both** TB-DOTS staff *and* captains; role is read from the signed-in account and swaps the navigation. A captain signing in here sees only BHW management.
- **`admin.html`** — a deliberately separate developer portal with its own login. Non-admin accounts get a polite refusal and a link back.

There is no router library — navigation is a small piece of React state (`page`), and the referral inbox uses a master-detail split.

### Current visual language

Established palette ("Teal Trust"), already used by the mobile app:

| Token | Value | Use |
|---|---|---|
| `--teal` | `#028090` | Primary actions |
| `--teal-dark` | `#016575` | Hover/active |
| `--teal-deep` | `#014b57` | Deep accents |
| `--teal-container` | `#d9eeef` | Tonal chip background |
| `--seafoam` | `#00a896` | Secondary accent |
| `--bg` | `#f7f5f1` | Warm off-white page background |
| `--paper` | `#ffffff` | Card surfaces |
| `--line` | `#e3ded6` | Borders |
| `--ink` | `#20302e` | Body text |
| `--ink-mid` / `--muted` | `#4a5754` / `#8a968f` | Secondary text |
| `--red` / `--red-container` | `#96362e` / `#fbe7e5` | Positive results, missed |
| `--amber` / `--amber-container` | `#8a5e00` / `#f7ecd8` | No-show, warnings |

Current typeface is Roboto at a 14px base. Layout today is a **white top bar** (app name, facility label, pill tabs, language select, account chip, sign out) over a single content column of cards. Buttons are pills; statuses are tonal chips.

> **Note for the redesign:** the addendum specifies a deep teal-navy `#0B2E33` for nav/headers, which does **not** exist in the current token set. It is new, and it is the main structural color change — today's top bar is white.

### Screen inventory as built

**Login** *(shared shell, two variants)*
Centered card, app mark, staff/captain role toggle, email + password, pill CTA.
*Known issues to fix in redesign:* placeholder text uses fake example addresses (`staff@rhu.ph`, `captain@barangay.ph`) — must go, floating labels preferred. Password field has no show/hide toggle.

**Facility — Dashboard**
Card titled with today's date, a refresh button, and a grid of six stat tiles from a single aggregate query:
`Screened today` (teal), `Referred today`, `Tested positive` (red), `Tested negative` (neutral), `Attended` (of N scheduled), `Missed`.
Each tile: big number, label, small sub-caption. Closes with a note that outcomes are staff-recorded.

**Facility — Referral inbox** *(master–detail)*
*Left:* card with title, live result count, a toolbar (text search over patient name / code / specimen ID, a status dropdown, refresh), then a 4-column table — **Patient** (name in bold with patient code beneath), **Barangay**, **Referred on**, **Status**. Rows are clickable; the selected row stays highlighted.
*Right:* the detail panel, or a placeholder prompt when nothing is selected.
Status chips: `submitted`, `received`, `tested`, `closed`, plus a distinct **no-show** chip that overrides the status chip when the patient did not present.

**Facility — Referral detail** *(right panel)*
- Patient header: name, then `code · sex · age · barangay · sitio`, who screened them, status chips, and a close (×) button.
- **Screening summary** — read-only. One row per DOH-NTP symptom with a colour-coded answer (`yes` / `no` / `unsure`), then a PGI-S row tagged as *patient-reported*.
- **Actions stack**, in order: Mark received (toggles back to submitted; locked once tested/closed) → laboratory outcome (Positive / Negative pair + free-text notes + Save) → Presented / No-show pair → Close referral.
- **Check-up appointments**: compact rows with date and status; scheduled ones offer Mark attended / Mark missed.
- Footer note about did-not-present handling.

**Facility — Barangay hotspots**
Card, intro line, three range pills (Last 30 / 60 / 90 days), then a ranked list. Each row: 2-digit rank, barangay name with municipality beneath, a horizontal bar sized relative to the period's maximum, and the count. Bar colour by rank — 1st deep teal, 2nd–3rd seafoam, rest light teal. Closes with a note that these are counts only.

**Captain — BHW management**
Toolbar (title, count, "Add BHW"), a privacy note, then a table: **Name**, **Barangay**, **30-day activity** ("N screenings, M referrals"), **Status** chip, **Actions** (Edit / Reset password / Deactivate or Reactivate). Deactivated rows render at 60% opacity.
Sub-views replace the whole card: add/edit form (first + last name side by side), a **credentials screen** shown once after create or password reset (email + temporary password in a key-value table), and a deactivation confirm.

**Admin — Manage Captains**
Same pattern; form adds a **barangay picker** (cascading region → province → municipality → barangay). Table: Name, Barangay, Status, Actions.

**Admin — Manage Facility Staff**
Same pattern; form adds a **facility dropdown**. List has a facility filter above it. Table: Name, Facility, Status, Actions.

### What every screen currently lacks

Loading, empty, and error states all render as a single line of plain text. This is the single biggest gap the redesign should close — the addendum calls for all four states (idle / loading / empty / error) designed per table, list, and card.

---

## 4. Proposed target

### Architecture

**One deployed app, three role-scoped spaces** behind one login: `/admin`, `/facility`, `/captain`. Shared design system and backend client; each space gets its own nav rail, accent, and landing dashboard so it reads as a dedicated destination. `document.title` per route ("TB-Screen — Admin", "TB-Screen — Facility Portal", "TB-Screen — Captain Portal").

The main structural change from today: **captain moves out of the facility portal into its own space**, and admin becomes a peer space rather than a bolted-on separate page.

### Shared direction — all three spaces

- **Layout:** persistent **left sidebar** (logo at top, nav items, user/facility context pinned at bottom) plus content area. Replaces today's top bar. Standard legible admin-dashboard pattern — not a marketing site.
- **Palette:** keep Teal Trust. Teal `#028090` for primary actions, deep teal-navy `#0B2E33` for nav/headers *(new)*, seafoam `#00A896` accents, neutral grays for structure. Reuse the existing status chip colours so a status reads identically here and on mobile.
- **Typography:** a clean web sans (Inter or system-ui) for the dashboards — a different register from the Georgia display face used in the slide deck, which was chosen for editorial feel rather than utility screens. *Open question: keep one typeface across everything instead?*
- **States:** idle, loading, empty, and error designed for every table, list, and card.
- **Contrast:** body text ≥ 4.5:1 (WCAG AA). Check the teal/navy combinations specifically — saturated teal on white reads lower-contrast than it appears.
- **Responsive:** desktop and tablet first. These are internal staff tools, not the BHW's phone. Don't spend effort on phone layouts.
- **Language switcher** must remain reachable in every space.

### Admin space

Keep it minimal — tables and forms, not a product.

- **Dashboard** *(new)* — a few read-only stat tiles: facility count, captain count, BHW count, system-wide open referrals. No drill-down.
- **Manage Captains** — as built, restyled.
- **Manage Facilities** *(partly new)* — today only facility **staff accounts** are manageable; the addendum also asks for the **facility records** themselves (create/edit a TB-DOTS facility). Design both: the facility list and its accounts.

### Facility space

Referral inbox, result/attendance/no-show actions, and the hotspot view as described above — now with the sidebar, palette, and full state treatment instead of bare tables.

### Captain space

BHW list, create/edit/deactivate, and the deactivation-handoff summary dialog, same visual treatment.

> **Flag:** today's deactivation dialog is a plain confirm ("deactivate this BHW?"). The addendum refers to a *deactivation-handoff summary* dialog, which implies showing what happens to that BHW's patients on deactivation. That appears to be a new or expanded requirement — likely defined in the Care Continuity addendum. Worth confirming its content before designing it.

### Branding

A logo exists (`TB-Screen Logo.png`: white circle with a teal lung mark on navy). It needs to appear in the sidebar header of all three spaces and as the favicon. The source is a flattened PNG with rounded corners baked into the pixels, so it is not directly usable as an app icon — production icon work needs a flat full-bleed master plus a separate transparent foreground layer.

---

## 5. Build order

Per the addendum: **one space at a time, with explicit approval between each.** Approve a space's mockup here before any code is written, and don't batch all three into a single pass.

---

## 6. Open questions

1. **Architecture** — one app with three spaces (as proposed), or three genuinely separate deployments?
2. **Typography** — separate web sans for dashboards, or one typeface across the deck and the tools?
3. **Deactivation-handoff dialog** — what should it actually summarise?
4. **Facility records CRUD** — confirm this is in scope, since only staff accounts exist today.
