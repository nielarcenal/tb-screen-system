# TB Case Registry UI and return-after-LTFU review

## UI changes

- Separate screening/referral, treatment/visits, laboratory/vitals, and patient history sections. Switching sections preserves unsaved form state.
- Wider detail pane; search occupies its own row; long case lists scroll; mobile sections wrap.
- Keep case identity, key dates, and recorded outcome visible. Move technical identifiers into expandable audit details.
- Require explicit outcome selection instead of defaulting to Cured.
- Explain that a closed lost-to-follow-up episode remains closed when the patient returns.
- English, Tagalog, and Cebuano strings added. New translations still need native-speaker review.

## Teacher's scenario

A missed appointment alone is not enough to conclude treatment interruption. The DOH NTP Manual of Procedures, sixth edition, defines lost to follow-up as treatment interrupted for at least two consecutive months (and also covers initial LTFU). Table 16 and accompanying instructions call for tracing, Xpert MTB/RIF testing, and referral to a drug-resistant TB treatment center if needed. The clinician must reassess and determine the appropriate treatment; the software must not select or automatically restart a regimen.

Source: https://itis.doh.gov.ph/assets/img/downloads/mop/NTP_MOP_6th_Edition.pdf (Table 16, printed page 42).

The same manual identifies Treatment after lost to follow-up as a retreatment registration group. Do not label every returning patient a relapse: relapse concerns prior cure or treatment completion.

Source: https://itis2.doh.gov.ph/assets/img/downloads/mop/NTP_MOP_6th_Edition.pdf (TB Disease Registration Group definitions).

## Current system support and gaps

Supported in the existing data model:

- One patient can have multiple treatment episodes (`tb_cases.patient_id`).
- Only one active episode is allowed globally (`tb_cases_one_active_per_patient`).
- A closed episode cannot be reopened; create a new episode for the existing patient after clinical reassessment and an enrolment decision.
- Visits, results, vitals, outcomes and appointments belong to the appropriate episode; the patient timeline retains accessible history.

Not a complete end-to-end return workflow yet:

- There is no structured Treatment after lost to follow-up registration field or explicit predecessor-episode link.
- The old referral opens its linked closed case instead of presenting a new-episode action. A new eligible referral can expose manual case creation for the same patient, but there is no dedicated return action from the registry.
- No reliable treatment-interruption duration is calculated from dose adherence. Overdue appointment indicators must not automatically assign LTFU.
- Cross-facility clinical records remain governed by existing access policies; shared patient identity must not be described as unrestricted province-wide access to clinical episodes.

No migration, treatment protocol automation, production data change, or Vercel deployment is part of this UI change. Complete and validate a clinician-led return workflow before claiming full support in a demonstration.
