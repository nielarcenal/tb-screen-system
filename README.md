# TB-Screen BHW

A tuberculosis **pre-screening and referral follow-up system** connecting Barangay Health Workers (BHWs) in Bukidnon province to public TB-DOTS facilities.

> **Positioning (non-negotiable design rule).** This is a pre-screening support tool, **not a diagnostic tool**. It never produces a diagnosis, a TB probability, a detection result, or a risk score of any kind. Its single clinical output is a referral recommendation — *"meets / does not meet presumptive TB criteria"* — derived from the DOH National TB Program (NTP) symptom checklist alone. Diagnosis happens exclusively at TB-DOTS facilities through laboratory testing; facility staff *record* outcomes into the system, which never computes them. This is enforced structurally: no score column exists anywhere in the schema.

## Components

| Path | Component | Users | Stack |
|---|---|---|---|
| `mobile/` | Android application | BHWs | Expo SDK 57 / React Native, TypeScript, offline-first |
| `web/` | Facility portal (`/`) + developer portal (`/admin.html`) | TB-DOTS staff, Barangay Captains, admin | React 18 + Vite, TypeScript |
| `supabase/` | Database, auth, Edge Functions | — | PostgreSQL 15 + RLS, GoTrue, Deno, pg_cron |
| `docs/` | System documentation and design handoffs | — | — |

## Roles

| Role | Interface | Sees patient data? | Scope |
|---|---|---|---|
| `bhw` | Mobile app | Yes | Patients of their assigned barangay, plus those they enrolled |
| `tb_dots` | Facility portal | Yes | All patients (read); referrals addressed to their facility (act) |
| `captain` | Facility portal | **No** | BHW accounts in their barangay (names + activity counts) |
| `admin` | Developer portal | **No** | Captain and TB-DOTS account provisioning only |

Row-Level Security is enforced on every table. The client UI adapts to the role but is never the security boundary.

## Getting started

Each component takes its own `.env`, copied from the adjacent `.env.example`. **Never commit a real `.env`** — the `service_role` key is server-side only and must never reach a browser or the mobile bundle.

```bash
# Backend — apply migrations 0001–0011 to your Supabase project
cd supabase && supabase db push

# Web portals
cd web && npm install && npm run dev

# Mobile app
cd mobile && npm install && npx expo start
```

Useful scripts: `web` — `npm run dev`, `npm run build`, `npm run typecheck`. `mobile` — `npm start`, `npm run android`.

## Documentation

- [`docs/SYSTEM_DOCUMENTATION.md`](docs/SYSTEM_DOCUMENTATION.md) — as-built reference: schema, roles, sync model, account provisioning
- [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md) — feature-by-feature build log
- [`docs/DESIGN_BRIEF.md`](docs/DESIGN_BRIEF.md) — product brief and constraints
- [`docs/TBScreen_Web_Design_Handoff.md`](docs/TBScreen_Web_Design_Handoff.md), [`docs/TBScreen_Web_Redesign_and_Branding_Addendum_1.md`](docs/TBScreen_Web_Redesign_and_Branding_Addendum_1.md) — web design specs
- [`docs/TBScreen_Facility_Scheduling_Handoff.md`](docs/TBScreen_Facility_Scheduling_Handoff.md) — facility scheduling spec

## Repository history

`mobile/`, `web/`, and `supabase/` were originally three separate Git repositories. Their full histories are preserved in this monorepo via subtree merges, so `git log --follow` works across the split.

## Localization

All user-facing copy ships in three languages: English, Tagalog, and Cebuano.
