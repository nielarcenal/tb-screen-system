# TB-Screen — Logo & App Identity assets

Generated from `uploads/TB-Screen Logo.png` (§3 of the Redesign & Branding Addendum).

## Files (assets/icons/)
| File | Size | Use |
|------|------|-----|
| icon-1024.png | 1024² | Master app icon — full-bleed navy, no rounding, no transparent margin. Expo `icon`. |
| adaptive-foreground-1024.png | 1024² | Android adaptive **foreground** — transparent bg, mark in center safe zone. |
| splash-1024.png | 1024² | Splash mark centered on navy. Expo `splash.image`. |
| apple-touch-icon-180.png | 180² | iOS Safari / web home-screen icon. |
| favicon-32.png / favicon-16.png | 32² / 16² | Browser tab favicons. |

Brand navy: `#0B2E33`

## Expo app.json / app.config
```json
{
  "expo": {
    "icon": "./assets/icons/icon-1024.png",
    "splash": {
      "image": "./assets/icons/splash-1024.png",
      "resizeMode": "contain",
      "backgroundColor": "#0B2E33"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/icons/adaptive-foreground-1024.png",
        "backgroundColor": "#0B2E33"
      }
    },
    "web": { "favicon": "./assets/icons/favicon-32.png" }
  }
}
```

## Web `<head>` (already wired into all four .dc.html spaces)
```html
<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/icons/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/icons/apple-touch-icon-180.png">
```

The sidebar nav header keeps `assets/tb-screen-logo.png` (the rounded badge) — it suits the small in-app header; swap to `icon-1024.png` if a square mark is preferred.

## ⚠ Caveat — imperfect extraction
These were flatten-extracted from the finished rounded PNG (no layered/vector source). The disc was detected and recentered, and rounded corners were replaced with navy, but edges may carry faint anti-aliasing from the original and the cross accent blurs at 16px. Good enough as production placeholders; for final polish, regenerate from a vector master of the lung + cross mark.
