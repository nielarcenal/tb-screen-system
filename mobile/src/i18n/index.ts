/**
 * i18next initialization (react-i18next). Trilingual: en / tl / ceb (§9).
 * Default language is English; the persisted user choice (appStore) is applied
 * at app root after store hydration. English is the fallback for missing keys.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { en } from './locales/en';
import { tl } from './locales/tl';
import { ceb } from './locales/ceb';
import { AppLanguage } from './languages';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tl: { translation: tl },
    ceb: { translation: ceb },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export function changeLanguage(lng: AppLanguage): Promise<unknown> {
  return i18n.changeLanguage(lng);
}

export default i18n;
