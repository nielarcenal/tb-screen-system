# TB-Screen — Facility Check-up Scheduling (Design Handoff)

Short brief for one new capability in the **Facility space**: TB-DOTS staff scheduling a patient's follow-up check-ups. Companion to `TBScreen_Web_Design_Handoff.md` — the shared direction (sidebar, Teal Trust palette, state coverage, WCAG AA, trilingual) all applies; this only adds the new piece.

---

## The change in one line

The **BHW keeps the first check-up** (set on the mobile app at referral time); the **facility owns every one after that**. Ongoing TB treatment is a series of visits the facility manages once the patient presents, so this adds facility-side scheduling for all follow-up check-ups. Confirmed 2026-07-22 — not an open question.

## Where it lives

Inside the existing **Referral detail** panel (the right side of the facility referral inbox), in its **Check-up appointments** section. That section currently just lists appointments with Mark-attended / Mark-missed actions. It gains a way to **add** a new check-up.

## What to design

- **A "Schedule check-up" affordance** in the appointments section header — a button that reveals a small inline form: a **date picker** (future dates only) and a **Schedule** confirm. Keep it inline in the panel; don't design a separate page or a heavy modal.
- **The appointment list, redesigned as a small timeline/history.** One row per check-up, newest or next-up clearly distinguished, each showing its date and a status chip. Reuse the existing status chips: **scheduled** (upcoming), **attended**, **missed**. A patient will accumulate several of these over a treatment course, so the list should read as a sequence, not a flat table.
- **Origin is worth showing but must stay subtle** — a quiet marker distinguishing the BHW's initial referral check-up from facility-scheduled follow-ups (e.g. a small text tag, not a loud badge). Helps staff see the handoff without cluttering the row.
- **All four states** for the section: no appointments yet (empty), scheduling in progress (the form open / saving), a populated list, and an error if a write fails.

## Constraints carried over

- **Not clinical scoring.** A check-up is a calendar date and a status — nothing here computes, predicts, or scores anything. No "next due" logic that looks like a system recommendation; the staff member picks the date.
- **Facility scope only.** Staff can schedule only for patients referred to their own facility. The UI never shows a facility picker — a user only ever acts within their own scope.
- **Desktop/tablet first**, trilingual (EN/TL/CEB — allow ~30–40% text expansion), status chips must read identically to everywhere else in the system.

## Out of scope for this handoff

The SMS reminder that a scheduled check-up can trigger, and any mobile-app change, are separate. This is only the facility-side scheduling UI.
