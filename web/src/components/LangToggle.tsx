/**
 * Language switcher as EN/TL/CEB pills (design §3 header). Shared by the app
 * shell header and the logged-out login page so language is always reachable.
 *
 * The pills read 'EN'/'TL'/'CEB', which are the same three tokens in every
 * language, so the group's aria-label is the ONLY part of this control a
 * screen reader can announce meaningfully -- and it must therefore be
 * translated. It was not: the label was written as t('languages.label',
 * 'Language'), and no bundle defined that key, so i18next fell back to the
 * second argument and announced the English word "Language" on the Tagalog and
 * Cebuano portals too. The default-value argument is what hid it -- a missing
 * key normally renders as the key itself, which is loud; a default renders as
 * plausible English, which is silent. This is the only call site in the portal
 * that ever passed one, and i18n.test.ts now fails if another appears.
 */
import { useTranslation } from 'react-i18next';

import { AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from '../i18n';

export default function LangToggle() {
  const { t, i18n } = useTranslation();
  return (
    <div className="lang-toggle" role="group" aria-label={t('languages.label')}>
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
