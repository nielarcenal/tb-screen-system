/**
 * Patient name helpers.
 *
 * The record stores the three parts (first / middle / last) plus `full_name`,
 * the composed display string every reader already uses (patient list,
 * follow-ups, referral slip, web portal). Compose it here so there is exactly
 * one definition of how a name renders.
 */

/** "First Middle Last", collapsing whitespace and omitting an empty middle. */
export function composeFullName(
  first: string,
  middle: string | null | undefined,
  last: string,
): string {
  return [first, middle, last]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0)
    .join(' ');
}

/**
 * Best-effort split of a legacy single-field name, mirroring the SQL backfill in
 * supabase/migrations/0010_patient_name_parts.sql. Only used to pre-fill the
 * edit form for rows enrolled before the split; a one-word name becomes the
 * first name with no last name.
 */
export function splitFullName(fullName: string | null | undefined): {
  first: string;
  middle: string;
  last: string;
} {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: '', middle: '', last: '' };
  if (words.length === 1) return { first: words[0], middle: '', last: '' };
  return {
    first: words[0],
    middle: words.slice(1, -1).join(' '),
    last: words[words.length - 1],
  };
}

/** Up to two initials for the avatar bubble. Empty string when there is no name. */
export function nameInitials(fullName: string | null | undefined): string {
  if (!fullName) return '';
  return fullName
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
