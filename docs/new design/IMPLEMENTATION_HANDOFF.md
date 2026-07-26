# TB-Screen — Implementation Handoff (Claude Code)

**For:** Claude Code, working against the connected `tb-screen-system` repo.
**From:** the approved Claude Design mockups in this project.
**Scope:** implement all web spaces + the mobile parity pass into the real codebase.

---

## 0. Read this first — the mockups are a *look* reference, not a *contents* spec

The `.dc.html` files in this project are **approved visual references**. They show the
target palette, layout, spacing, states, and the specific branding/UX changes below.

They were hand-built and are **known to be incomplete on field-level detail.** They win
on *how it looks*; they do **not** win on *what fields/records exist*.

> **Rule: the repo wins on contents. The mockup wins on appearance.**
> "Make it look like this" — never "make it contain exactly this."

If a screen in the repo has fields, records, validation, consents, or states the mockup
doesn't show, **keep them.** Do not delete or rebuild anything to match a mockup's field
list. Apply the visual/UX changes on top of the real code.

**Known omissions to correct against the repo (not exhaustive):**
- **Patient registration (mobile, mockup screen 8):** the mockup omits *middle name*,
  several *address components*, and the **two consent checkboxes** at the bottom. The real
  registration form is the source of truth — keep every field and both consents.
- Assume other forms may be similarly abbreviated. When the mockup and the real form
  disagree on which fields exist, **the real form wins.**

---

## 1. Non-negotiable constraints (do not violate — a change that breaks these is rejected)

1. **Never diagnostic.** Approved vocabulary only: *pre-screening, supports, flags for
   referral, presumptive*. Never diagnosis / TB probability / detection / risk score.
2. **No scoring anywhere.** No gauges, risk meters, percentage rings, severity scores, or
   confidence indicators. PGI-S is supplementary context only — it never feeds a score.
3. **Lab outcomes are human-entered, never computed.** Positive/negative is data entry.
4. **Hotspot view is surveillance, not contact tracing.** Barangay-level counts only — no
   household/sitio/address/per-patient drill-down. Never label it contact tracing.
5. **Hard role boundaries.** Captains and Admins see **zero patient data**. BHWs never see
   lab outcomes (facility-only). Enforced by RLS server-side; the UI must not leak scope.
6. **Trilingual (en / tl / ceb).** Language switcher always present. Tagalog/Cebuano run
   30–40% longer than English — layouts must tolerate expansion, no fixed-width labels.

---

## 2. Design artifacts → repo mapping

| Approved mockup (this project) | Implements in repo |
|---|---|
| `TB-Screen - Login.dc.html` | shared login shell (facility + captain + admin) |
| `TB-Screen - Facility.dc.html` | `/facility` space (was `index.html` facility role) |
| `TB-Screen - Admin.dc.html` | `/admin` space (was `admin.html`) |
| `TB-Screen - Captain.dc.html` | `/captain` space (was captain role inside facility) |
| `TB-Screen - Mobile Parity.dc.html` | React Native app — parity pass only (see §6) |
| `assets/icons/` + `assets/icons/BRANDING.md` | app icons / favicons / splash (see §5) |

---

## 3. Shared web direction (all three spaces)

- **Layout:** persistent **left sidebar** — logo at top, nav items, user/facility context
  pinned at bottom — plus a content area. Replaces today's white top bar.
- **Palette (Teal Trust):** primary `#028090`, hover `#016575`, deep `#014b57`, tonal chip
  bg `#d9eeef`, seafoam accent `#00a896`, **nav/header navy `#0B2E33` (new token)**, page
  bg `#f7f5f1`, paper `#ffffff`, line `#e3ded6`, ink `#20302e`, mid `#4a5754`, muted
  `#8a968f`, red `#96362e`/`#fbe7e5`, amber `#8a5e00`/`#f7ecd8`. Reuse the existing status
  chip colors so a status reads identically on web and mobile.
- **Typography:** clean web sans (Inter or system-ui) for dashboards.
- **States:** design **idle / loading / empty / error** for *every* table, list, and card —
  this is the single biggest gap in the current build. Not just the happy path.
- **Contrast:** body text ≥ 4.5:1 (WCAG AA). Check teal-on-white specifically.
- **Responsive:** desktop/tablet first. These are staff tools — don't build phone layouts.
- **Tab title per route:** "TB-Screen — Admin" / "— Facility Portal" / "— Captain Portal".

Recommended architecture: **one deployed app, three role-scoped routes** (`/admin`,
`/facility`, `/captain`) behind one login, sharing the design system and Supabase client.
(Confirm with the team before restructuring the build if they prefer separate deployments.)

---

## 4. Per-space work

### Login (shared shell)
- Restyle to the mockup: centered card, logo mark, staff/captain role toggle, pill CTA.
- **Remove fake example-email placeholders** (`staff@rhu.ph`, `captain@barangay.ph`, etc.)
  — use floating labels; fallback is the neutral placeholder "Email address" (§5).
- **Add show/hide password toggle** (§4 shared component).
- Wire favicon links (§5).

### Facility space
- Sidebar + navy header treatment.
- **Dashboard:** 6 stat tiles from the single aggregate query — Screened today / Referred
  today / Tested positive / Tested negative / Attended (of N) / Missed.
- **Referral inbox** (master–detail): search, status filter, refresh, 4-col table
  (Patient / Barangay / Referred on / Status); selected row stays highlighted.
- **Referral detail:** patient header; read-only screening summary (one row per DOH-NTP
  symptom + PGI-S tagged *patient-reported*); actions stack (Mark received → lab outcome
  Positive/Negative + notes + Save → Presented/No-show → Close); check-up appointments;
  did-not-present footer note.
- **Barangay hotspots:** 30/60/90 range pills, ranked list, bars colored by rank. Counts
  only — no drill-down.
- All four states per table/list/card.

### Admin space (zero patient data)
- Sidebar; **Dashboard** read-only tiles (facility / captain / BHW counts, system-wide open
  referrals).
- **Manage Captains:** list + create/edit/deactivate; form has cascading
  region→province→municipality→barangay picker.
- **Manage Facilities:** both the **facility records** (create/edit a TB-DOTS facility) and
  their **staff accounts** (list with facility filter). Confirm records CRUD is in scope.

### Captain space (zero patient data)
- Sidebar; **BHW management** table (Name / Barangay / 30-day activity / Status / Actions);
  add/edit form; **credentials screen** shown once after create or reset (email + temp
  password); **deactivation-handoff dialog** — confirm what it should summarize before
  building (likely BHW's patient reassignment on deactivation).

---

## 5. Branding / app identity (§3)

Assets are generated in `assets/icons/` — see `assets/icons/BRANDING.md` for the full table.
Brand navy `#0B2E33`.

- **Web `<head>`** (each space) — already wired in the mockups; replicate in the repo:
  ```html
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon-180.png">
  ```
- **Expo `app.json` / `app.config`:**
  ```json
  {
    "expo": {
      "icon": "./assets/icons/icon-1024.png",
      "splash": { "image": "./assets/icons/splash-1024.png", "resizeMode": "contain", "backgroundColor": "#0B2E33" },
      "android": { "adaptiveIcon": { "foregroundImage": "./assets/icons/adaptive-foreground-1024.png", "backgroundColor": "#0B2E33" } },
      "web": { "favicon": "./assets/icons/favicon-32.png" }
    }
  }
  ```
- Sidebar nav header + mobile login/first-launch use the lung mark.

---

## 6. Mobile app — parity pass only (NOT a redesign)

The app is already on the Teal Trust system. These are the **only** changes; leave
everything else intact. Reference: `TB-Screen - Mobile Parity.dc.html`.

1. **Background token** `#FBF9F6` → `#F7F5F1` (align with web `--bg`).
2. **Icon swap:** generic hospital icon → the **navy lung mark** on Splash / Welcome /
   Sign-in.
3. **Show/hide password** on Sign-in (and any Settings password-change field) — RN Paper:
   ```jsx
   <TextInput
     secureTextEntry={!showPassword}
     right={<TextInput.Icon icon={showPassword ? "eye-off" : "eye"} onPress={() => setShowPassword(v => !v)} />}
   />
   ```
4. **`app.json`** → navy branded adaptive assets (§5).
5. **Full-pill CTA radii** + the helper text "access provisioned by your administrator"
   under the Sign-in form.

> Reminder for the registration form specifically: the mockup omits middle name, address
> parts, and the two consents (§0). Keep the real form's fields — only apply token/radii
> changes.

---

## 7. Global, build once and reuse (§4, §5)

- **`<PasswordField>` (web):** label, input whose `type` toggles password/text, trailing
  eye/eye-off icon-button (`type="button"` so it never submits), `aria-label` that changes
  with state. Use on every login and every "set initial password" field.
- **Email placeholders:** audit every email input (web + mobile); remove fake example
  addresses. Prefer floating labels; fallback neutral "Email address". Don't touch
  `type="email"` / `keyboardType` / validation.

---

## 8. Recommended build order & verification

Per the addendum: **one piece at a time, explicit approval between each** — don't batch the
whole thing in one pass.

1. Branding assets + `app.json` + favicons (§5) — smallest, unblocks everything.
2. Shared `PasswordField` + email-placeholder audit (§7).
3. Facility space (§4) → approve → 4. Captain → approve → 5. Admin.
6. Mobile parity pass (§6).

**After each piece, report how to check it** — the dev server command and the exact
route/screen to open — and wait for confirmation before the next.

---

## 9. Source-of-truth recap

- **Repo code** = truth for fields, records, validation, consents, data, RLS scope.
- **These mockups** = truth for palette, layout, spacing, states, and the specific
  branding/UX changes above.
- **§1 constraints** override both.
- When in doubt, keep what the repo has and ask.
