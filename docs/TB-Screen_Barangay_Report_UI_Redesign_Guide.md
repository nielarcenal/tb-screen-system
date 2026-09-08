# TB-Screen — Barangay Report UI/UX Redesign Guide

## Purpose

Redesign the **Barangay Report** page in the TB-Screen Facility Portal so it feels like a professional healthcare reporting dashboard: clean, calm, information-dense, easy to scan, and appropriate for a government/health-facility system.

This is primarily a **UI/UX redesign**. Preserve the existing business logic, database queries, permissions, reporting definitions, and metrics unless an existing UI bug makes a change necessary.

The redesign should make the information easier to understand, not merely prettier.

---

## 1. Core information hierarchy

The page should communicate information in this order:

1. **What is happening overall?**
   - Screened
   - Referred
   - Positive

2. **Which barangays need attention?**
   - Ranked barangay visualization

3. **What are the exact numbers?**
   - Detailed barangay table

A user should understand the overall situation within approximately five seconds.

---

## 2. Header

Keep the existing page title:

**Barangay report**

Keep the subtitle:

**Screening and referral counts per barangay**

Improve the hierarchy and spacing around the header.

The header should contain:

- Page title
- Short explanatory description
- Year selector
- Language selector

### Year selector

Use a compact segmented control:

`2026 | 2025 | 2024`

Requirements:

- Selected year is clearly visible.
- Controls are not unnecessarily large.
- Maintain the existing year-filtering behavior.

---

## 3. KPI cards

Keep the three existing major metrics.

### Screened

**463**

Checked for TB symptoms

### Referred

**321**

Sent to TB-DOTS for testing

### Positive

**105**

Confirmed positive by the facility

Redesign them as clean dashboard cards.

### Requirements

- Equal width
- Consistent height
- Generous but controlled padding
- Large numeric value
- Small label/eyebrow
- Supporting description
- Subtle icon
- Minimal shadow
- No excessive gradients
- No giant decorative illustrations

The number should be the most visually prominent element.

Recommended hierarchy:

```text
SCREENED

463

Checked for TB symptoms
```

Use the existing TB-Screen teal as the primary visual accent.

For **Positive**, a restrained clinical warning/accent treatment is acceptable, but do not turn the entire card bright red.

---

# 4. Main ranking visualization

The existing horizontal-bar ranking is conceptually correct and should remain.

**Do not replace it with a pie chart, donut chart, or generic dashboard graph.**

The problem is primarily its:

- size
- spacing
- hierarchy
- visual presentation

not the underlying visualization type.

Create a compact analytics card.

Recommended structure:

```text
Top barangays
by referrals

[ Referred ] [ Positive ] [ Screened ]

1  Poblacion       ████████████████████  64
2  Lilingayon      ████████████         39
3  Lumbo           ████████              25
4  Batangan        ██████                20
5  Bagontaas       █████                 17
6  Pinatilan       ████                  14
7  Tongantongan    ███                   12
8  Laligan         ███                   11
```

### Sizing

The current chart is too vertically dominant.

Target approximately **300–400px of vertical space** for the ranking card, depending on viewport and existing design system.

Do not create enormous bars.

Use:

- Thin bars
- Clear ranking numbers
- Consistent barangay-name alignment
- Values at the end of the bars
- Subtle background tracks
- Strong teal foreground bars
- Consistent row spacing

The visualization should feel like an analytics component, not a giant infographic.

---

## 5. Ranking interaction

Keep the existing metric tabs:

`Referred | Positive | Screened`

When the user changes the metric:

- Re-sort the barangays by that metric.
- Update the bars.
- Update the values.
- Keep the same visual structure.

Use one reusable ranking component rather than three separate charts.

Animation should be subtle.

Avoid excessive chart animation.

---

## 6. "View all barangays"

The ranking card may have a small action in the upper-right:

**View all barangays →**

If practical, it should scroll to or focus the detailed table.

If this introduces unnecessary navigation or complexity, omit it.

Do not create a separate page solely for this action.

---

# 7. Detailed barangay table

Keep the existing information:

- Barangay
- Screened 2026
- Referred 2026
- Referred 2025
- Positive 2026
- Positive 2025
- Missed check-ups 2026

Do not change the underlying metrics or definitions.

Improve readability.

### Table requirements

- Comfortable row spacing
- Strong but restrained header contrast
- Barangay names left-aligned
- Numeric values right-aligned
- Consistent numeric formatting
- Use tabular numerals if supported
- Subtle row separators
- Hover state
- Compact enough to display many rows
- Avoid excessive borders

Do not turn every cell into a colored badge.

This is a reporting table, not a task-management table.

---

# 8. Table header

Use a layout similar to:

```text
All barangays                         Search barangay...
```

The search field should be compact and integrated into the table header.

Do not make the search input unnecessarily large.

If technically reasonable, support searching by barangay name without changing existing data behavior.

---

# 9. Year comparison

The current table makes the 2026/2025 comparison difficult to scan.

Improve the visual grouping.

Preferred structure:

```text
                    2026                         2025
             Screened  Referred  Positive   Referred  Positive
```

If grouped table headers are difficult with the current component, use consistent visual grouping or subtle column separation.

Do not change metric definitions.

---

# 10. Missed check-ups

**Missed check-ups 2026** is operationally different from screening/referral totals.

Visually separate it slightly from the screening/referral metrics while keeping it in the same table.

Do not make it look like another positive-case metric.

---

# 11. Pagination

Keep pagination.

Recommended presentation:

```text
Showing 1–10 of 30 barangays

                         ‹   1   2   3   ›
```

Requirements:

- Active page has a clear restrained teal treatment.
- Controls are compact.
- Avoid oversized circular buttons.
- Preserve existing pagination behavior.

---

# 12. Information density

This is a reporting tool.

Prioritize:

**clarity > decoration**

Avoid:

- Huge empty spaces
- Giant charts
- Excessive rounded cards
- Heavy shadows
- Gradients everywhere
- Decorative illustrations
- Excessive icons
- Large colored backgrounds
- Generic "startup analytics" styling that sacrifices data density

The page should feel like a serious healthcare information system.

---

# 13. Visual direction

Use the existing TB-Screen identity:

- Dark teal sidebar
- White/off-white main content background
- Teal primary accent
- Very light borders
- Subtle gray secondary text
- High readability
- Professional typography

Desired aesthetic:

**Modern healthcare dashboard + government reporting system**

Avoid:

**Startup analytics dashboard**

---

# 14. Responsive behavior

Verify the redesign at:

- 1366×768
- 1440×900
- 1920×1080
- Laptop widths
- Tablet widths supported by the existing portal

At 1366×768, the user should be able to see:

- Header
- KPI cards
- Most or all of the ranking card

without the ranking visualization taking over the screen.

The detailed table can naturally continue below.

---

# 15. Preserve functionality

Do not break:

- Existing Supabase queries
- Existing RPCs
- Year filtering
- Language switching
- Barangay calculations
- Pagination
- Existing permissions
- Navigation
- Authentication
- Existing report definitions

Do not invent new metrics.

Do not modify the database schema for this redesign.

---

# 16. Accessibility

Maintain or improve:

- Keyboard navigation
- Visible focus states
- Semantic table structure
- Accessible chart labels
- Sufficient text contrast
- Screen-reader-friendly controls
- Buttons that are actually buttons
- Proper ARIA only where necessary

Do not rely on color alone to communicate meaning.

---

# 17. Reference visual direction

Use the supplied/reference mockup as inspiration.

Important characteristics:

- Compact KPI cards
- Compact horizontal ranking chart
- Clear numbered ranking
- Search integrated into the table
- Clean detailed table
- Strong information hierarchy
- Controlled whitespace
- Consistent teal branding
- Professional healthcare aesthetic

Do not copy the mockup blindly.

Adapt it to the existing TB-Screen codebase and existing design system.

---

# 18. Implementation approach

Before modifying code:

1. Inspect the existing Barangay Report page.
2. Identify the current chart component.
3. Identify KPI/card components.
4. Identify the table implementation.
5. Identify existing design tokens/components.
6. Reuse existing components wherever practical.
7. Avoid introducing a new UI library just for this page.

Then implement the redesign.

After implementation:

- Run TypeScript checks.
- Run relevant tests.
- Verify existing report data remains unchanged.
- Verify year switching.
- Verify Referred/Positive/Screened chart tabs.
- Verify search.
- Verify pagination.
- Verify language switching.
- Verify the page at 1366×768.

Do not modify backend/reporting logic unless required to fix an existing UI issue.

---

# 19. Design principles

## Principle 1 — Make the information easier to understand

The goal is not to maximize visual decoration.

The user should immediately understand:

> How many people were screened, referred, and confirmed positive — and which barangays account for the largest numbers?

The page should answer that question before the user reaches the detailed table.

## Principle 2 — Preserve useful visualization choices

The horizontal ranking chart is appropriate because users need to compare barangays.

Do not replace it with:

- pie charts
- donut charts
- 3D charts
- gauges
- decorative illustrations

unless there is a strong data-visualization reason.

## Principle 3 — Data density matters

This is a facility reporting interface.

A beautiful design that forces the user to scroll unnecessarily is worse than a clean, compact design.

## Principle 4 — Clinical professionalism

The interface should feel trustworthy and calm.

Avoid:

- flashy animations
- excessive color
- excessive gradients
- playful illustrations
- unnecessarily rounded everything

---

# 20. Acceptance criteria

The redesign is successful when:

- The page looks substantially cleaner without changing report functionality.
- KPIs are immediately understandable.
- The ranking chart is compact and readable.
- Barangay rankings can be compared quickly.
- The detailed table remains easy to scan.
- 2026/2025 information is visually easier to compare.
- Search and pagination remain functional.
- Language switching remains functional.
- Existing data values and definitions remain unchanged.
- The page does not feel visually overloaded.
- The page does not feel excessively empty.
- The UI remains consistent with the rest of TB-Screen.
- No database migration is required.
- TypeScript checks pass.
- Relevant tests pass.

---

# Final instruction to Claude

Before coding, briefly inspect the existing implementation and explain:

1. Which components you will reuse.
2. Which components you will modify.
3. Which components you will create.
4. Whether any existing data/query logic needs to change.

Then implement the redesign.

**Do not rewrite working backend/reporting logic just to achieve the visual redesign.**

The priority is:

**Information hierarchy → readability → data density → consistency → polish.**
