/**
 * Language switcher as EN/TL/CEB pills (design §3 header). Shared by the app
 * shell header and the logged-out login page so language is always reachable.
 */
import { useTranslation } from 'react-i18next';

import { AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from '../i18n';

export default function LangToggle() {
  const { t, i18n } = useTranslation();
  return (
    <div className="lang-toggle" role="group" aria-label={t('languages.label', 'Language')}>
      {SUPPORTED_LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          className={i18n.language === lng ? 'active' : ''}
          aria-pressed={i18n.language === lng}
          onClick={() => changeLanguage(lng as AppLanguage)}
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
