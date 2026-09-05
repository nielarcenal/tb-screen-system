/**
 * i18next setup for the portal — same trilingual convention as mobile (§9).
 * The chosen language is persisted in localStorage (non-personal).
 *
 * The <html lang> attribute is kept in step with the chosen language. Both
 * entry documents ship lang="en" hardcoded, and nothing used to update it, so
 * a portal switched to Tagalog or Cebuano still announced itself as English:
 * a screen reader then reads Filipino text with English pronunciation rules,
 * which is the difference between usable and not. It also drives the browser's
 * own translate offer, spell-check dictionary and hyphenation.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { tl } from './locales/tl';
import { ceb } from './locales/ceb';

export const SUPPORTED_LANGUAGES = ['en', 'tl', 'ceb'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'tbscreen-portal-language';

export function storedLanguage(): AppLanguage {
  const v = localStorage.getItem(STORAGE_KEY);
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(v ?? '')
    ? (v as AppLanguage)
    : 'en';
}

/** Keep <html lang> in step with i18next. Guarded because this module is
 *  imported by the vitest setup, which may run before jsdom installs a
 *  document. */
function applyDocumentLanguage(lng: AppLanguage): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
}

export function changeLanguage(lng: AppLanguage): void {
  localStorage.setItem(STORAGE_KEY, lng);
  applyDocumentLanguage(lng);
  void i18n.changeLanguage(lng);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tl: { translation: tl },
    ceb: { translation: ceb },
  },
  lng: storedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

// The stored language is applied at init, so a reload lands on the right
// <html lang> without waiting for the user to touch the toggle.
applyDocumentLanguage(storedLanguage());

export default i18n;
