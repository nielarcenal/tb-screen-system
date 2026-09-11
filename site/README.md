# TB-Screen project website

The public page: what the system is, who it is for, how to install the Android
app, and — prominently — what it deliberately does not do.

Built from the approved design canvas *TB-Screen Project Site* (7 artboards).
The canvas is the reference for **appearance**; this folder is the real page.

No build step and no dependencies. It is one static HTML file plus one
stylesheet, so it can be served by anything.

```
site/
  index.html      the whole page — hero, how it works, limits, features, download, about
  styles.css      all styling, with the responsive breakpoints
  assets/         logo + favicons (copied from web/public/assets)
                  author.jpg — the author's portrait, cropped square and
                  downscaled to 720px (58 KB).
```

The portrait was cropped from a 3840x2160 studio original that is deliberately
**not** committed: it is 1.26 MB, it exists only to produce the 58 KB asset, and
this page gets opened on mobile data in a barangay. The crop was
`(976, 40, 2776, 1840)` scaled to 720x720 at quality 84 — repeat that if it ever
needs redoing from a fresh original.

## Deploying

Deployed as its own Vercel project, separate from the staff portal, so a health
worker downloading the APK never lands on a sign-in form.

- **Root directory:** `site`
- **Framework preset:** Other
- **Build command:** none
- **Output directory:** `site` (or leave blank — it is already static)

The portal stays where it is at `tb-screen-system.vercel.app` and is untouched
by this.

## Content

Everything on the page is real: no placeholders remain. Three facts are
hand-kept beside the download button — version, size and date — and must be
updated whenever a new APK ships (see below).

The "why" paragraph in the About section is the author's own words. It is the
only part of the page that says why the system exists rather than what it does.
Leave it alone.

### The embedded video (added 2026-09-11)

The "What is tuberculosis?" band embeds a third-party video:
*What is tuberculosis?* by **KNCV TB Plus**
(<https://www.youtube.com/watch?v=UytL_4suU_Q>). It is not ours. The credit
line under the player — title, channel, a link to both, and "not affiliated" —
must stay whenever the video does. It uses the `youtube-nocookie.com` embed so
nothing is set in the visitor's browser until they press play. If the video is
removed from YouTube, remove the whole band rather than leave an empty frame.

### The APK link

The APK is a **GitHub release asset**, which needs the repository to be public —
a release asset on a private repo demands a login, which is useless for a BHW
standing in a barangay. The repository was made public on 2026-09-06 after an
audit confirmed nothing sensitive was ever committed: no `.env`, no chat
transcripts, no token literals in any blob on any branch, and neither
`supabase/.temp/` (cron secret) nor `supabase/reset_fresh_accounts.sql`
(test-account password) has ever been tracked — both are gitignored, and must
stay that way.

Current asset:

```
https://github.com/nielarcenal/tb-screen-system/releases/download/v1.1.0/app-release.apk
```

Shipping a new APK means: cut a release with the new tag, then update the URL
in `index.html` **and** the three facts beside it (version, size, date). They
are hand-kept — there is no build step to derive them.

## The copy is not decoration

Two rules govern edits here, and both come from the project's positioning:

1. **Nothing on this page may imply diagnosis, detection, a probability, or a
   score.** The "does not diagnose" band is not a disclaimer to be shortened —
   it is the section that makes the rest of the page honest. The same claim is
   repeated in the hero and the footer on purpose.
2. **"Specimen form" is retired.** Sputum is collected only at the facility, so
   nothing physical travels with the patient. The printed sheet is an optional
   **referral slip**, and the copy says the referral reaches the facility on
   sync whether or not anything is printed. An earlier draft of this design said
   "QR specimen slips"; that wording is wrong and must not come back.
