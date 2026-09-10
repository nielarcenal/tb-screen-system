# TB-Screen BHW

A tuberculosis **pre-screening and referral follow-up system** connecting Barangay Health Workers (BHWs) in Bukidnon province to public TB-DOTS facilities.

> **Positioning (non-negotiable design rule).** This is a pre-screening support tool, **not a diagnostic tool**. It never produces a diagnosis, a TB probability, a detection result, or a risk score of any kind. Its single clinical output is a referral recommendation — *"meets / does not meet presumptive TB criteria"* — derived from the DOH National TB Program (NTP) symptom checklist alone. Diagnosis happens exclusively at TB-DOTS facilities through laboratory testing; facility staff *record* outcomes into the system, which never computes them. This is enforced structurally: no score column exists anywhere in the schema.

## Components

| Path | Component | Users | Stack |
|---|---|---|---|
| `mobile/` | Android application | BHWs | Expo SDK 57 / React Native, TypeScript, offline-first |
| `web/` | Facility (`/`), midwife (`/midwife.html`) and developer (`/admin.html`) portals | TB-DOTS staff, Barangay Midwives, admin | React 19 + Vite, TypeScript |
| `supabase/` | Database, auth, Edge Functions | — | PostgreSQL 15 + RLS, GoTrue, Deno, pg_cron |
| `docs/` | System documentation and design handoffs | — | — |

## Roles

| Role | Interface | Sees patient data? | Scope |
|---|---|---|---|
| `bhw` | Mobile app | Yes | Patients of their assigned barangay, plus those they enrolled |
| `tb_dots` | Facility portal | Yes | Patients referred to their facility, plus any they registered themselves (read); referrals addressed to their facility (act) |
| `midwife` | Facility portal | **No** | BHW accounts in their barangay (names + activity counts) |
| `admin` | Developer portal | **No** | Midwife and TB-DOTS account provisioning only |

Row-Level Security is enforced on every table. The client UI adapts to the role but is never the security boundary.

## Getting started

Each component takes its own `.env`, copied from the adjacent `.env.example`. **Never commit a real `.env`** — the `service_role` key is server-side only and must never reach a browser or the mobile bundle.

```bash
# Backend — apply migrations 0001–0038 to your Supabase project
cd supabase && supabase db push

# Web portals
cd web && npm install && npm run dev

# Mobile app
cd mobile && npm install && npx expo start
```

Useful scripts: `web` — `npm run dev`, `npm run build`, `npm run typecheck`. `mobile` — `npm start`, `npm run android`.

The rollback-safe Day 7 synthetic story is `supabase/seed_capstone_day7.sql`.
It ends in `ROLLBACK` by default; review its selected facility and explicit
instructions before deliberately changing that to `COMMIT` for a demo.

## Documentation

- [`docs/SYSTEM_DOCUMENTATION.md`](docs/SYSTEM_DOCUMENTATION.md) — as-built reference: schema, roles, sync model, account provisioning
- [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md) — feature-by-feature build log
- [`docs/DESIGN_BRIEF.md`](docs/DESIGN_BRIEF.md) — product brief and constraints
- [`docs/TBScreen_Web_Design_Handoff.md`](docs/TBScreen_Web_Design_Handoff.md), [`docs/TBScreen_Web_Redesign_and_Branding_Addendum_1.md`](docs/TBScreen_Web_Redesign_and_Branding_Addendum_1.md) — web design specs
- [`docs/TBScreen_Facility_Scheduling_Handoff.md`](docs/TBScreen_Facility_Scheduling_Handoff.md) — facility scheduling spec
- [`docs/TBScreen_Referral_Model_Correction_and_Vitals_Addendum.md`](docs/TBScreen_Referral_Model_Correction_and_Vitals_Addendum.md) — the specimen-form → referral-document correction, TB-DOTS walk-in registration, and optional vital signs

## Repository history

`mobile/`, `web/`, and `supabase/` were originally three separate Git repositories. Their full histories are preserved here via subtree merges — every original commit is reachable, and `git log` shows all of them.

One caveat: because the pre-merge commits recorded paths *without* the `mobile/`, `web/`, `supabase/` prefix, a path-filtered log stops at the merge:

```bash
git log -- mobile/          # only shows the merge commit onward
```

To read a component's history from before the merge, walk the merge commit's second parent:

```bash
git log <merge-commit>^2                 # full pre-merge history of that component
git log <merge-commit>^2 -- app.json     # a single file, using its original path
```

The merge commits are titled *"Merge the &lt;component&gt; repository into &lt;component&gt;/"*.

## Localization

All user-facing copy ships in three languages: English, Tagalog, and Cebuano.
