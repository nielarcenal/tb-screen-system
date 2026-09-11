# TB-Screen — Patient Journey Guide

Step by step through one patient's whole record in the system, from the first
record to the last. Use it to demo the system or to test it end to end.

Three pathways:

- **A. BHW-referred → positive → cured** (the full journey)
- **B. BHW-referred → negative**
- **C. Walk-in at the facility** (positive or negative)

Accounts: a BHW account on the mobile app and a TB-DOTS staff account on the
facility portal (see the test-account list). "Portal" means the facility portal
signed in as TB-DOTS staff.

> **Testing in one sitting:** in real life pathway A takes about 6 months. The
> system never accepts future dates, but it does accept today's date for every
> step, so you can run the whole journey today.

---

## A. BHW-referred → positive → cured

### Part 1 — Barangay (BHW mobile app)

| # | Where | Do this | You should see |
|---|---|---|---|
| 1 | Home | **Enroll & screen a patient** | Enrolment form |
| 2 | Enroll | Fill in the name, birthdate, sex and address. Tick consent. Optional: SMS opt-in and a phone number. **Enroll patient** | Patient saved with a `PAT-…` code |
| 3 | Screening | Answer the DOH-NTP checklist. For this pathway answer **Yes** to *cough ≥ 2 weeks*. Choose a PGI-S answer. Vitals are optional. **Save screening** | **Refer this patient** |
| 4 | Referral | Pick the receiving TB-DOTS facility. **Create referral** | Referral status **Submitted** |
| 5 | Referral document | Optional: **Print** or **Share** | Informational only; nothing needs to travel with the patient |
| 6 | Sync chip | Tap to sync (or wait for the automatic sync) | Chip reads **Synced** |

### Part 2 — Facility receives the patient (portal → Referral inbox)

| # | Where | Do this | You should see |
|---|---|---|---|
| 7 | **Referral inbox** | Open the patient's row | Detail panel: status **Submitted**, the screening answers read-only |
| 8 | Referral receipt | **Mark received** (when the patient arrives) | Status **Received** |
| 9 | Attendance | **Presented** | Attendance recorded |
| 10 | Referral receipt | Type the **Laboratory sample ID**, then **Save sample ID** | The ID is saved and can be searched in the inbox |

### Part 3 — Diagnosis (portal → Referral inbox → same referral)

| # | Where | Do this | You should see |
|---|---|---|---|
| 11 | Laboratory outcome | Choose **Positive**. Optional notes, e.g. "Xpert MTB detected, RIF not detected". **Save result (marks as tested)** | Status **Tested**, a **Positive** pill |
| 12 | TB case | **Create TB case** | You are taken to the **TB case registry** with a new case number (`TBC-…`), status **Registered** |
| 13 | Back in the inbox | **Close referral** (the referral's job is done; the case carries on) | Status **Closed** |

### Part 4 — Treatment (portal → TB case registry)

| # | Where | Do this | You should see |
|---|---|---|---|
| 14 | Case detail | Set **Treatment start date**, then **Start treatment** | Status **On treatment** |
| 15 | Vital signs during treatment | **Record vitals** → at least the weight → **Save vitals** | A dated row with the measurements and BMI |
| 16 | Laboratory results during treatment | Optional: **Add lab result** → Test *Xpert MTB/RIF*, Treatment point *Baseline (diagnosis)*, Result *Positive* → **Save lab result** | A baseline row |
| 17 | Record treatment visit | Visit date, notes (optional), **Next follow-up date** → **Record visit** | Visit listed; the next appointment shows in the case list |
| 18 | *(month 2)* Lab results | **Add lab result** → *Sputum smear (DSSM)*, *End of month 2*, **Negative** → Save | Month-2 row |
| 19 | *(month 2)* Vitals + visit | Record the weight again; record the visit with the next date | New rows |
| 20 | *(month 5)* Lab results | **Add lab result** → *Sputum smear*, *Month 5*, **Negative** → Save | Month-5 row |
| 21 | *(month 6)* Lab results | **Add lab result** → *Sputum smear*, *End of treatment*, **Negative** → Save | End-of-treatment row |

### Part 5 — Cured

| # | Where | Do this | You should see |
|---|---|---|---|
| 22 | Close case | Treatment outcome **Cured**, the outcome date → **Close case** (or record the final visit with *Case status after visit: Closed*) | Status **Closed**, outcome **Cured** |
| 23 | Barangay report | Open **Barangay report** | The patient's barangay counts +1 screened, +1 referred, +1 case, +1 cured/completed |
| 24 | Activity log | Open **Activity log** | Entries for the referral, case, lab results and vitals (dates only, never the results) |

**Rule for "Cured"** (shown under the outcome selector): bacteriologically
confirmed pulmonary TB, negative sputum in the last month of treatment **and**
on at least one earlier test. Without that evidence, choose **Treatment
completed**. The system records the nurse's decision; it never decides it.

**If things go wrong during treatment:**

- Patient stops coming → **Mark treatment interrupted** → later **Resume treatment**.
- Two months or more without treatment → close with **Lost to follow-up**.
- Sputum still positive at month 5 or later → close with **Treatment failed**.
- Wrong lab result or vitals entered → **Void record** with a reason, then enter it again.

---

## B. BHW-referred → negative

Steps 1–10 are the same as pathway A. You can answer **Yes** to any cardinal
symptom so the referral is created.

| # | Where | Do this | You should see |
|---|---|---|---|
| 11 | Laboratory outcome | Choose **Negative** → **Save result (marks as tested)** | Status **Tested**, a **Negative** pill |
| 12 | Doctor's decision | **Not TB:** go to step 13. **TB diagnosed clinically anyway** (e.g. by chest X-ray): **Create TB case** and continue from pathway A step 14. The case will close as **Treatment completed**, not **Cured**, because it was not bacteriologically confirmed. | — |
| 13 | Check-up appointments | Optional, if symptoms persist: **Schedule check-up** → pick a date → **Schedule**. On the day: **Mark attended** / **Mark missed** | Appointment listed |
| 14 | Referral | **Close referral** | Status **Closed**; no TB case |
| 15 | BHW app | Sync | The referral shows the result and status |
| 16 | Barangay report | — | +1 screened, +1 referred, no case |

---

## C. Walk-in at the facility

No BHW is involved. The patient comes to TB-DOTS directly.

| # | Where | Do this | You should see |
|---|---|---|---|
| 1 | **Register patient** | Fill in the patient details and consent | — |
| 2 | Patient registry | **Search patient registry** | "No match": continue as a new patient. A match: select them to reuse their record (no duplicates). |
| 3 | Checklist, PGI-S, vitals | Answer them the same way a BHW would | A preview of whether the answers meet presumptive criteria |
| 4 | Save | **Register patient** | A confirmation with the patient code; the referral is filed as **Received** |
| 5 | Confirmation | **Record sample & lab result** | The patient's referral opens in the inbox |
| 6 | Continue | **Positive:** pathway A from step 9 (Presented → sample ID → Positive → Create TB case → treatment → Cured). **Negative:** pathway B from step 11. | — |

A walk-in whose answers do **not** meet presumptive criteria is still
registered and can still be tested. "Does not meet criteria" is a pre-screening
answer, not a diagnosis.

---

## What must be true at the end (checklist)

- [ ] **A:** case **Closed / Cured**, with baseline, month-2, month-5 and end-of-treatment lab rows, at least two vitals rows, and every visit listed
- [ ] **B:** referral **Closed**, result **Negative**, no case
- [ ] **C:** patient enrolled by TB-DOTS staff, referral started at **Received**, then pathway A or B completed
- [ ] **Patient care timeline** (bottom of the case page) lists every step in date order, including each *Vital signs recorded* and *Laboratory result recorded (treatment)* entry. It names the test and treatment point, never the result.
- [ ] The Barangay report counts match what you did
- [ ] The Activity log shows each step with who did it and when, and no lab values
- [ ] The BHW app, after sync, shows the result for pathways A and B
