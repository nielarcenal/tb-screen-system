# Facility short codes — accepted project convention (R2-08)

Owner: Claude Code. Reviewer: Codex.
Date: 2026-09-09. Source of truth: `supabase/migrations/0009_bukidnon_dots_facilities.sql`, plus `supabase/seed.sql` for the pre-0009 row.
Status: **accepted project convention for migration 0031.** These are persisted identifiers, reviewed as data and never generated from names at runtime.

---

## 1. What the constraint should be (R2-08)

Revision 2 proposed `facilities.short_code text not null unique`. That is wrong for two reasons Codex named: the table already holds barangay health stations (`seed.sql` seeds Casisang BHS as `...b1`), so a NOT NULL column would fail on existing rows; and admin facility creation (0013) supports both types, so a required case-number field would block creating a BHS that will never have a case number.

Corrected shape:

```sql
alter table public.facilities
  add column short_code text;

-- Unique across all facilities that have one; NULLs do not collide in a
-- Postgres unique index, so barangay health stations are simply absent from it.
create unique index facilities_short_code_uniq
  on public.facilities (short_code)
  where short_code is not null;

-- Required for TB-DOTS, forbidden elsewhere, and shaped for a case number.
alter table public.facilities
  add constraint facilities_short_code_scope check (
    (type =  'tb_dots' and short_code is not null
                       and short_code ~ '^[A-Z0-9]{2,8}$')
    or
    (type <> 'tb_dots' and short_code is null)
  );
```

**The `short_code is not null` term is load-bearing (R3-03), not redundant.** Without it, a TB-DOTS row with a NULL code makes the regex test evaluate to NULL, so the first arm is NULL, the second is false, and `NULL or false` is NULL — and PostgreSQL accepts a CHECK that evaluates to unknown. The constraint would have looked like it required a code for TB-DOTS facilities while permitting exactly the row it was written to forbid: a DOTS facility with no case-number prefix, which then fails case creation at the worst possible moment. Three-valued logic has to be spelled out.

Required constraint tests, each asserted rather than assumed:

| Input | Expected |
| --- | --- |
| `tb_dots` + NULL | rejected |
| `tb_dots` + `'mlb'` (lowercase) | rejected |
| `tb_dots` + a code already held by another row | rejected |
| `tb_dots` + `'MLB'` | accepted |
| `barangay_health_station` + NULL | accepted |
| `barangay_health_station` + `'CAS'` | rejected |


Order of operations inside the migration matters, and the CHECK goes last:

1. Add the nullable column.
2. `UPDATE` the eleven rows in §2.
3. Verify: `select count(*) from facilities where type = 'tb_dots' and short_code is null` must be 0, and `... where type <> 'tb_dots' and short_code is not null` must be 0. Raise if either is non-zero rather than proceeding.
4. Add the unique index and the CHECK.

Adding the CHECK before the UPDATE would fail against the existing DOTS rows; adding it without step 3 would let an unseen row slip through on a live database whose contents differ from the migration files. The baseline audit warns that migrations here have been hand-applied, so the live facility list must be reconciled before this runs — if the live table holds a TB-DOTS facility not in §2, the migration must stop, not invent a code for it.

Once set, `short_code` is pinned by the `enforce_immutable_columns` trigger (0020). A case number that has been written on a patient's record cannot have its prefix redefined later.

Admin facility creation (0013, `FacilitiesAdmin`) gains a short-code field, required when type is `tb_dots` and hidden otherwise. That is a small UI addition listed in the case migration's surfaces, not part of this proposal's data.

---

## 2. The eleven mappings

All eleven `type = 'tb_dots'` rows in the schema. Facility IDs are abbreviated to their final segment; the full UUIDs are `00000000-0000-0000-0000-0000000000xx`.

| # | Facility ID | Facility name (post-0009) | Accepted `short_code` | LGU served |
| --- | --- | --- | --- | --- |
| 1 | `…d1` | Bukidnon Provincial Medical Center Hospital DOTS Center | `BPMC` | Provincial referral hospital, Malaybalay City |
| 2 | `…d2` | Malaybalay City Health DOTS Center | `MLB` | Malaybalay City, Cabanglasan, Impasug-Ong, Lantapan |
| 3 | `…d3` | Valencia City Health DOTS Center | `VAL` | Valencia City |
| 4 | `…d4` | Don Carlos Health DOTS Center | `DCL` | Don Carlos, Dangcagan, Kibawe, Damulog, Kadingilan |
| 5 | `…d5` | Kalilangan Health DOTS Center | `KLL` | Kalilangan |
| 6 | `…d6` | Kitaotao Health DOTS Center | `KTO` | Kitaotao |
| 7 | `…d7` | Manolo Fortich Health DOTS Center | `MFT` | Manolo Fortich, Libona, Malitbog, Sumilao |
| 8 | `…d8` | Maramag Health DOTS Center | `MRM` | Maramag, Quezon |
| 9 | `…d9` | Pangantucan Health DOTS Center | `PNG` | Pangantucan |
| 10 | `…da` | San Fernando Health DOTS Center | `SFD` | San Fernando |
| 11 | `…db` | Talakag Health DOTS Center | `TLK` | Talakag, Baungon |

Catchments are taken from the `default_facility_id` mapping in 0009, not invented.

A case number therefore reads `TBC-VAL-2026-00017`.

### Why these codes

- **Keyed to the LGU, not the facility name.** Staff and the health office refer to "Valencia DOTS", not to the row's full title. A code the reader has to decode is worse than no code.
- **Three letters, except `BPMC`.** The provincial hospital is not an LGU health office and shares Malaybalay City with `MLB`; giving it the initialism people already use avoids a `MLB` / `MLB2` split that would invite mis-filing.
- **Consonant skeletons, so no two are one keystroke apart.** `MLB` / `MRM` / `MFT` share a first letter but diverge immediately; there is no pair within edit distance 1.
- **Fixed at review time.** Nothing derives these from `facilities.name`, so renaming a facility — which 0009 itself did to `…d1` — cannot silently change a code that is already printed on patient records.

### The alternative I did not take

The PSGC city code is already in the schema, unique, and needs no human decision: `TBC-101321000-2026-00017`. I rejected it because the case number is read aloud and written by hand in a facility, and a nine-digit prefix is transcription-error bait. If Codex prefers the machine-derived option despite that, it is a one-line change to the proposal and no change to the design.

---

## 3. Project decision

On 2026-09-09 the user directed implementation to continue without local confirmation because of the defense deadline. The eleven codes above are accepted as TB-Screen's project convention. This does not claim the CHO uses the same abbreviations on paper.

---

## 4. Closed questions

1. Local abbreviations were not available; use the project mappings above.
2. Accept `BPMC` as the four-letter exception.
3. **Confirmed by Codex on 2026-09-09:** the live `facilities` table holds exactly these eleven `tb_dots` rows, with matching IDs and names.
