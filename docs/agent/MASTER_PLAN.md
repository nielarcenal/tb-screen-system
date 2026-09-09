# Sprint master plan

2026-09-09: Codex approved and applied migrations **0028** and **0029** in order. The strengthened 0029 live preflight passed **47/47** after two test-harness corrections; the live post-check reports `app_private` present and all **28** target policies active-aware. BASE-01 and BASE-06 are closed. Case/follow-up work may proceed as migration **0030**, subject to its remaining product inputs.

2026-09-09: Final focused gate **PASSED**. Migration 0028's generated preflight ran against the configured live database and returned **73/73 PASS**, then rolled back; 0028 is approved for application but was not applied by Codex. Revision 4 architecture is **APPROVED** with M28-01..03 and R3-01..06 closed. The live database has exactly the eleven proposed TB-DOTS facility rows. Claude's next unit is BASE-06 as migration **0029**; case/follow-up implementation moves to **0030**. See CODEX_REVIEW.md and DECISIONS.md.

The authoritative plan is [TB-Screen_7-Day_Claude-Codex_Master_Plan.md](TB-Screen_7-Day_Claude-Codex_Master_Plan.md). Read that document for task ownership, architecture rules, review gates, and acceptance criteria. This entry point avoids maintaining two divergent copies.

2026-09-09: Codex performed Task 1.1 against repository HEAD `4659d65`. See CODEX_BASELINE_AUDIT.md and CODEX_REVIEW.md. No Claude checkpoint handoff was present. Tasks 1.2 and 1.3 remain for Claude; Task 1.4 requires those designs before approval.

2026-09-09: Claude completed Tasks 1.2 and 1.3 as design documents (CLAUDE_TASK_1.2_CASE_DOMAIN_MODEL.md, CLAUDE_TASK_1.3_FOLLOWUP_MODEL.md); see CLAUDE_STATUS.md. No migration, no schema, no application code. Task 1.4 is now unblocked for Codex. Migration 0028 will not be written until that gate passes.

2026-09-09: Codex completed the first Task 1.4 review with result **NOT APPROVED**. ARCH-01 through ARCH-07 and the clinical vocabulary blocker must be resolved before migration or implementation begins. See CODEX_REVIEW.md and ISSUES.md.

2026-09-09: Codex reviewed Revision 2. ARCH-02, ARCH-03, ARCH-05 and ARCH-07 are resolved, but the architecture gate remains **NOT APPROVED** due to R2-01 through R2-05. Claude may implement the independent BASE-01 authorization repair as migration 0028 now; it requires its own review. Case work moves to 0029 or the next sequential migration after that repair.

2026-09-09: Claude wrote migration 0028 and Revision 3; Codex reviewed both. The 0028 guard logic is accepted on source inspection, but application awaits corrected verification artifacts and an all-PASS real-role matrix. Revision 3 remains **NOT APPROVED** due to R3-01 through R3-04. BASE-06 (inactive accounts retain RLS access until JWT expiry) is a separate release-blocking security unit.

2026-09-09: Task 1.4 returned NOT APPROVED (7 HIGH, 2 MEDIUM). Claude revised both design documents to revision 2, addressing ARCH-01 through ARCH-09 and the seven gate decisions. Handed back for focused re-review. Migration 0028 still not written.

2026-09-09: Second gate returned NOT APPROVED (R2-01..R2-08). Claude revised both designs to revision 3 and, per Codex's decision, implemented BASE-01 as **migration 0028** with a runnable denial matrix and a transcription check. Case work moves to **0029**. The eleven TB-DOTS short-code mappings are proposed separately in CLAUDE_FACILITY_SHORT_CODES_PROPOSAL.md. 0028 needs its own Codex review before case implementation begins.

2026-09-09: Third gate returned CHANGES REQUIRED on 0028 and NOT APPROVED on Revision 3. Claude corrected the 0028 verification package (M28-01/02/03), added `scripts/build-0028-preflight.mjs`, and revised both designs to revision 4 (R3-01..R3-06). BASE-06 accepted as a release-blocking HIGH with its own unit, preferred BEFORE 0029. 0028 still needs its database matrix run before application.

2026-09-09: Claude implemented BASE-06 as migration **0029** (active-aware RLS). 28 policies rewritten onto current_user_active_role(), the four enumerating helpers moved to a non-exposed `app_private` schema, and current_user_role() closed as a trap by delegation. One deliberate carve-out: an account may always read its own users row. Ships with a policy transcription verifier and a row-access matrix. Preflight generated; **the database matrix has not been run**. Case/follow-up work remains 0030.

2026-09-09: Claude implemented BASE-04 as migration **0030** (barangay_report Manila boundaries), with a body verifier and a two-timezone boundary test carrying a negative control. Case/follow-up work therefore moves to **0031**. The preflight is generated; the boundary test has not been run.
