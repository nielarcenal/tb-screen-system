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
```

## Deploying

Deployed as its own Vercel project, separate from the staff portal, so a health
worker downloading the APK never lands on a sign-in form.

- **Root directory:** `site`
- **Framework preset:** Other
- **Build command:** none
- **Output directory:** `site` (or leave blank — it is already static)

The portal stays where it is at `tb-screen-system.vercel.app` and is untouched
by this.

## Still to fill in

Three things are placeholders in the markup. Each is marked with an HTML comment
naming it, so `grep` finds them:

| Marker | Where | What is needed |
|---|---|---|
| `APK-LINK` | `index.html`, download section | The real APK URL. Until it is set the button reads "Download link coming soon" and carries `aria-disabled="true"` — replace both. |
| `AUTHOR-FACTS` | `index.html`, about section | Full name, degree programme, institution, adviser. Also appears once more in the footer as `[University]`. |
| `WHY-PARAGRAPH` | `index.html`, about section | One or two sentences on why this problem, in the author's own words. |

```bash
grep -n "APK-LINK\|AUTHOR-FACTS\|WHY-PARAGRAPH\|\[University\]" site/index.html
```

### About the APK link

The repository is **private**, and a GitHub Release asset on a private repo is
not publicly downloadable — the URL demands a login, which is useless for a BHW
standing in a barangay. So the release route needs the repository to be public
first. Nothing in the repo or its history blocks that: no `.env` is tracked, the
chat transcripts are gitignored, and a history sweep for a real Supabase key
finds nothing. It is still a decision about publishing a capstone, not a
technical one.

The alternative is any host that gives a direct link — Google Drive works, at
the cost of an interstitial warning page on a 97 MB file.

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
