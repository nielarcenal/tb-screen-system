# TB-Screen BHW — Web Redesign & Branding Addendum

Companion to the original Design Brief. Covers: the three-portal visual redesign, logo/app-identity wiring, show-password, and removing example-email placeholders — across the mobile app and all web surfaces.

---

## 0. Before you build — preview, don't batch

- **One piece at a time.** Don't apply the redesign to all three web spaces at once, or batch this whole addendum into a single pass. Finish one deliverable, get explicit approval, then move to the next.
- **For anything visual (§2), get it approved in Claude Design first.** That's the real preview — an actual mockup to react to, not a text description. Only move to Claude Code once a space's design is approved there, and implement what was approved rather than redesigning further mid-build.
- **If building directly in Claude Code without a Claude Design pass:** before writing the redesign for a given space, describe the plan in words — what changes, screen by screen — and wait for a go-ahead before touching files.
- **After building each piece, report exactly how to check it** — the dev server command and the route/screen to open — before starting the next piece. Do not move on until told the current piece looks right.

---

## 1. Web architecture — recommendation

**One deployed web app, three role-scoped spaces:** `/admin`, `/facility`, `/captain`, behind one login. Shared design system and Supabase client; each space gets its own nav rail, accent, and landing dashboard so it reads as a dedicated destination per role. Set `document.title` per route (e.g., "TB-Screen — Admin", "TB-Screen — Facility Portal", "TB-Screen — Captain Portal") to reinforce the separation in the browser tab even though it's one app.

If you actually want three independently hosted apps (separate domains/builds), say so — everything below still applies, it just gets deployed three times instead of once.

---

## 2. Per-role design brief — paste into Claude Design

*Build and get approval one space at a time — see §0. Approving the mockup here, before any code changes, is the actual preview step.*

### Shared direction (all three spaces)

- **Layout:** persistent left sidebar nav (logo at top, nav items, user/facility context at bottom) + content area. Standard, legible admin-dashboard pattern — not a marketing site.
- **Palette:** reuse the existing Teal Trust palette (teal `#028090` primary actions, deep teal-navy `#0B2E33` nav/headers, seafoam `#00A896` accents, neutral grays for structure). Reuse the status chip colors already established on mobile (synced/pending; upcoming/missed/did-not-present) so the same status reads the same way everywhere.
- **Typography:** a clean web system/sans stack (e.g., Inter or system-ui) for the dashboards — a different register from the Georgia display font used in the slide deck, which was chosen for print/editorial feel, not utility screens. Flag if you'd rather keep one typeface across everything.
- **States:** every table/list/card needs idle, loading, empty, and error states designed — not just the happy path with data in it.
- **Contrast:** body text ≥ 4.5:1 against its background (WCAG AA) — check this on the teal/navy combinations specifically, since saturated teal-on-white can read lower-contrast than it looks.
- **Responsive target:** desktop/tablet first. These are internal staff tools, not the BHW's phone — don't spend effort making them phone-responsive; that budget belongs on the mobile app.

### Admin space (new — not previously speced)

Keep it minimal, same principle as the facility portal: tables and forms, not a product.

- **Dashboard:** a handful of stat tiles — facility count, captain count, BHW count, system-wide open referrals. Read-only overview, no drill-down needed.
- **Manage Captains:** list (name, barangay, status) + create/edit/deactivate — same pattern as the Captain's own BHW-management screen, one level up.
- **Manage Facilities:** list of TB-DOTS facilities + their accounts; create/edit a facility record.

### TB-DOTS Facility space (existing screens — apply the shared direction above)

Referral inbox, result/attendance/no-show actions, and the Barangay Hotspot View, as already speced — now with the sidebar/nav/palette/state treatment described above instead of a bare table.

### Captain space (existing screens — apply the shared direction above)

BHW list + create/edit/deactivate, and the deactivation-handoff summary dialog — same visual treatment.

---

## 3. Logo & app identity — technical checklist

The uploaded PNG has the rounded-corner treatment and background already baked into the pixels — that's fine for a marketing image, but not for an actual app/favicon icon, since the OS or browser applies its own mask and a pre-rounded source can double-round or show a seam. What's actually needed:

- **Master icon:** a flat, full-bleed 1024×1024 square — navy background edge-to-edge, no pre-applied rounding, no transparent margin. Used for `app.json`'s `icon` field and the iOS build.
- **Android adaptive icon:** two layers — a transparent-background **foreground** (just the white circle + teal lung mark) and a solid **background** color (the navy). Android composites these itself with whatever mask shape the launcher uses; a single flattened image doesn't fit this model.
- **Splash screen:** the mark centered on a plain background (recommend navy, to match the brand) — keep it simple, it renders briefly.
- **Favicon:** separate 32×32 and 16×16 exports; the fine lung detail will blur at 16px, so a simplified version (or just the white circle + lung silhouette, no cross accent) reads better that small.
- **Where it's wired in:** `app.json`/`app.config` (`icon`, `splash.image`, `android.adaptiveIcon.foregroundImage` / `backgroundColor`); each web space's `<head>` favicon link; the sidebar nav header (all three web spaces); the mobile app's login and first-launch/language-picker screens.

If you don't have a layered/vector source for the mark, I can attempt a rough crop-and-extract from the PNG as a starting point — flag that separately and I'll try it, with the caveat that a flattened source only gets you an approximate result, not a production-clean one.

---

## 4. Show Password — paste into Claude Code

```
Add a reusable show/hide password toggle, built once per platform and
reused everywhere a password is entered or set.

WEB (React):
- Build a shared <PasswordField> component: label, input whose `type`
  toggles between "password" and "text", trailing icon-button (eye /
  eye-off) that flips the state. The toggle button must be
  type="button" so it never submits the form. Give it an aria-label
  that changes with state ("Show password" / "Hide password").
- Use it on: the login screen in all three role spaces, and any
  "set initial password" field in an account-creation flow (Admin
  creating Captain/Facility accounts, Captain creating BHW accounts) —
  wherever such a field exists. If accounts are created via an emailed
  invite link instead of a directly-typed temp password, there's no
  field there to change.

MOBILE (React Native Paper):
- TextInput already supports this natively:
  <TextInput
    secureTextEntry={!showPassword}
    right={
      <TextInput.Icon
        icon={showPassword ? "eye-off" : "eye"}
        onPress={() => setShowPassword(v => !v)}
      />
    }
  />
- Apply to the login screen and any password-change field in Settings.
```

---

## 5. Remove example-email placeholders — paste into Claude Code

```
Audit every email-type input, web and mobile, for a placeholder that
looks like a fake example address ("you@example.com", "name@email.com",
etc.) and replace it.

Preferred: no placeholder text at all — rely on a persistent/floating
label instead (Material 3 pattern, already used via React Native Paper
on mobile; extend the same floating-label pattern to the web forms for
consistency).

Fallback, only if the web form library doesn't support floating
labels: a neutral instructional placeholder — "Email address" — never
a fake example value.

Do not change the field's type or validation (type="email" /
keyboardType="email-address" stay as-is) — only the placeholder text
changes.
```

---

## 6. Decision Log entry — draft

> **Web redesign scope** — recommended one deployed web app with three role-scoped spaces (Admin / Facility / Captain) rather than three separately hosted apps, sharing login, design system, and backend client, distinguished by nav, accent, and tab title. Pending confirmation — will switch to genuinely separate deployments if preferred. Added: a dedicated Admin space (dashboard tiles, manage captains, manage facilities) not previously speced. Show/hide password and removal of example-email placeholders apply globally, built as shared components rather than per-screen, to avoid missing a field. Implementation proceeds one piece at a time with explicit approval before each is built — visual changes previewed and approved in Claude Design before any Claude Code work begins.
