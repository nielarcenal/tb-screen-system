/**
 * i18next setup for the portal — same trilingual convention as mobile (§9).
 * The chosen language is persisted in localStorage (non-personal).
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

export function changeLanguage(lng: AppLanguage): void {
  localStorage.setItem(STORAGE_KEY, lng);
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

export default i18n;
