/**
 * TB-Screen BHW design tokens — single source for the palette used across the
 * app, mirroring the approved design canvas ("TB-Screen BHW.dc.html"):
 *   deep teal primary, seafoam accent, warm off-white surfaces, tonal status
 *   tints (teal = on-track, red = missed, amber = patient-reported / no-show).
 * Amber is reserved for the patient's own voice (PGI-S) and "did not present";
 * offline is a calm neutral, never red.
 */
export const palette = {
  // brand
  teal: '#028090', // primary
  tealDark: '#016575',
  tealDeep: '#014B57',
  seafoam: '#00A896', // accent (progress, positive emphasis)
  tealContainer: '#D9EEEF',
  tealBorder: '#7CBEC6',

  // surfaces (warm off-whites) — #F7F5F1 mirrors the web --bg (parity §6)
  background: '#F7F5F1',
  surfaceSubtle: '#F3F0EA',
  surfaceVariant: '#EDE8E0',
  border: '#E3DED6',
  outline: '#C9C2B6',
  paper: '#FFFFFF',

  // ink
  ink: '#20302E',
  inkMid: '#4A5754',
  inkSoft: '#5A6B68',
  muted: '#8A968F',

  // status: missed / errors
  red: '#96362E',
  redContainer: '#FBE7E5',
  redDeep: '#7A2B24',

  // status: patient-reported (PGI-S) / did-not-present
  amber: '#8A5E00',
  amberContainer: '#F7ECD8',
  amberBorder: '#E0C98F',
  amberInk: '#6F4C00',
  amberSoft: '#6F5B33',

  // disabled
  disabledBg: '#E3DED6',
  disabledFg: '#9C948A',
} as const;

/** Chip tints for referral stages (design component sheet, "Referral stages"). */
export const statusChip = {
  submitted: { bg: palette.surfaceSubtle, fg: palette.inkSoft },
  received: { bg: palette.surfaceVariant, fg: palette.inkMid },
  tested: { bg: palette.tealContainer, fg: palette.tealDark },
  closed: { bg: palette.teal, fg: palette.paper }, // result recorded
} as const;

/** Chip tints for follow-up states (upcoming / missed / did-not-present). */
export const followUpChip = {
  upcoming: { bg: palette.tealContainer, fg: palette.tealDark },
  missed: { bg: palette.redContainer, fg: palette.red },
  cancelled: { bg: palette.surfaceVariant, fg: palette.muted },
  noShow: { bg: palette.amberContainer, fg: palette.amberInk },
} as const;
