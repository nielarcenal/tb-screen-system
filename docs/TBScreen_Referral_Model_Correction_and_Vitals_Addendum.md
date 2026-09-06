# TB-Screen BHW — Referral Model Correction & Vitals Addendum

**Source:** confirmed with the TB-DOTS head nurse, Valencia City.
**Confirmed / implemented:** 2026-09-06.
**Implements as:** server migrations `0024_referral_document_and_vitals.sql`,
`0025_tbdots_patient_registration.sql`; local sqlite migration v10.

This corrects a workflow assumption baked into the original build. It changes what an
existing feature *means*, not just what it does.

---

## Context: what changed and why

Sputum collection and testing happen **only** at the TB-DOTS facility, never at the
barangay level. A BHW's role ends at symptom assessment and referral. The original build
implemented a "specimen form" assuming a physical sputum sample travels from the BHW to
TB-DOTS — that assumption was wrong. Nothing physical travels through the BHW. The printed
document she can optionally give a patient is a **referral**, not a specimen form, and it
exists purely to give TB-DOTS advance, structured visibility into who is coming and why —
the same information is already in the portal the moment the BHW creates it, print or no
print.

---

## 1. Rename the concept: referral document, not specimen form — **done**

- "Specimen form" is retired everywhere: `referrals.specimen_id` → `referrals.lab_sample_id`
  (0024, applied live), `mobile/src/domain/specimenForm.ts` → `referralDocument.ts`, the
  route `/specimen/[referralId]` → `/referral-document/[referralId]`, and the whole
  `specimen.*` i18n namespace → `referralDoc.*` in all three languages.
- **Printing is optional**, and now reads that way: the referral document screen opens with
  a note stating the referral has already reached the facility and that printing is a
  courtesy to the patient. Nothing is gated on the print action, and nothing ever was.
- **`lab_sample_id` is re-scoped to TB-DOTS.** The BHW app no longer generates it — the
  `allocateSpecimenId()` allocator (`SPC-<device>-<seq>`) is gone from the persistent store,
  and `insertLocalReferral` does not accept the field. Facility staff enter it in the
  referral detail panel, and only once the referral is `received`: before the patient
  arrives there is no sample to name. Existing `SPC-*` values were preserved by the rename
  rather than cleared, since some are handwritten on paper already in circulation.
- The QR payload is now **v2**: `spc` dropped, `vit` (vitals) added. The version number is
  what lets a reader tell a slip printed before the correction from one printed after.

## 2. TB-DOTS can register a patient directly — **done**

- A **Register patient** space in the facility portal, beside the referral inbox, for
  walk-ins and self-referred patients who never went through a BHW.
- It writes the **whole chain** — `patients` → `screenings` → `referrals` — not just a
  patient row. `referrals.screening_id` is `NOT NULL`, and the inbox, the detail panel and
  `hotspot_counts()` all read the screening, so a patient row alone would be a half-record
  nothing downstream could render. The facility runs the same DOH-NTP checklist, the same
  PGI-S, and the same optional vitals; `web/src/lib/screeningRules.ts` mirrors the mobile
  rule exactly and is pinned against it by tests on both sides.
- The referral starts at **`received`**, not `submitted` — there is no "waiting to arrive"
  phase for someone already standing at the desk. Nothing else about the row differs.
- **No schema change to the tables.** `patients.enrolled_by` was always a plain foreign key
  to `users`, never `bhw`-only; what was missing was permission. 0025 adds
  `patients_tbdots_insert`, `screenings_tbdots_insert` and `referrals_tbdots_insert` (the
  last scoped to the staff member's own facility and own enrolments), plus the
  `own_enrolled_patient_ids()` helper the insert policies need — at the moment a walk-in
  screening is written the referral does not exist yet, so `referred_patient_ids()` cannot
  answer.
- `patients_tbdots_read` and `screenings_tbdots_read` are widened to cover the caller's own
  enrolments. This is clause (b) of the BHW rule in 0007 applied to facility staff: a record
  must not vanish from the account that created it, and a registration that failed part-way
  must stay visible and repairable. **0021's referred-only scope still governs every patient
  the account did not itself enrol** — 0021 is not reversed, and its header's "revisit this
  for a walk-in" note turns out not to be needed.
- Patient codes for facility registrations are `PAT-DOTS-####`, issued by the
  `next_facility_patient_code()` function off a server sequence. Mobile keeps its offline
  `PAT-<device>-<seq>` scheme; the portal is online by definition and needs no such trick.
- No `origin` column was added. The enroller's role, already embedded in the portal's
  nested select, answers "was this a walk-in?" — and the detail panel says *"Registered at
  this facility by …"* instead of *"Screened by … (BHW)"*. Everywhere else the two are
  deliberately identical.

## 3. Vital signs on the screening record — **done**

Seven nullable columns on `screenings` (0024), all optional, all supplementary:

```
height_cm, weight_kg, temperature_c,
systolic_bp, diastolic_bp, pulse_rate, spo2_percent
```

- **BMI is computed at display and print time** from height + weight — the same pattern as
  age-from-birthdate — and is deliberately not a column. A stored BMI would sit in the
  clinical record looking like a finding; a computed one is visibly arithmetic on two
  measured values.
- An optional **Vitals** step sits in the mobile screening flow after the symptom checklist
  and PGI-S, and an optional Vitals section sits in the portal's registration form. Every
  field may be left blank and the step skipped — the CTA reads *"Skip — nothing measured"*
  when nothing has been typed, because a BHW without a working thermometer that day must
  see that moving on is a supported choice, not a lapse.
- Whichever vitals were entered are printed on the referral document, so TB-DOTS has them
  on arrival, and shown read-only in the portal's referral detail.
- The `CHECK` ranges in 0024 are **data-entry guards, not clinical thresholds**: wide enough
  for any real human reading, narrow enough to catch a transposed digit or a slipped decimal
  point (1700 cm for 170, 3.68 °C for 36.8). They classify nothing.
- **Supplementary context only, exactly like PGI-S.** The DOH-NTP symptom checklist alone
  determines the referral recommendation. Vitals feed no score and touch no decision — and
  that is enforced structurally, not just by convention: `vitals.ts` on both sides exports
  no classifier (no "underweight", no "febrile", no colour-by-value), and tests assert both
  that absence and that `evaluateReferral` still takes one argument and ignores everything
  else handed to it.

---

## 4. Decision Log entry — final

> **Referral model correction:** confirmed with the TB-DOTS head nurse that sputum
> collection and testing happen only at the facility, never at the barangay level. The
> "specimen form" concept is retired and replaced with an optional printed **referral
> document** — informational only, not tied to a physical sample. `specimen_id`/
> `lab_sample_id` now belongs to TB-DOTS, entered when they collect the sample on-site, not
> generated by the BHW app at referral time. Added: TB-DOTS can register walk-in/
> self-referred patients directly, so the registry covers both pathways. Added: optional
> vital signs (height, weight, temperature, blood pressure, pulse rate, SpO2) as
> supplementary context, never inputs to the referral decision — suggested by the TB-DOTS
> head nurse.

---

## 5. Verification performed

Both migrations were applied to the live project and post-checked against it, not against
the files:

| Check | Result |
|---|---|
| `referrals` answers to `lab_sample_id` and not `specimen_id` | one row returned, `lab_sample_id` |
| Seven vitals columns exist, all nullable | 7 rows, `is_nullable = YES` on every one |
| No `%score%` / `%risk%` / `%probab%` column anywhere in `public` (§5) | zero rows |
| Five new policies present with the expected commands | `patients` INSERT+SELECT, `screenings` INSERT+SELECT, `referrals` INSERT |
| Both new functions `SECURITY DEFINER` with a pinned `search_path` | `prosecdef = true`, `proconfig = {search_path=public}` |

Test suites after the change: **web 110** (was 61), **mobile 197** (was 179), **edge
functions 47** (unchanged) — 354 total, all green, `tsc` clean in all three, `vite build`
clean. Every new positioning guard was mutation-tested and confirmed to fail before being
trusted.
