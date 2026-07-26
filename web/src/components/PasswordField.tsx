/**
 * Password input with a show/hide toggle (handoff §7). Build-once, reuse on
 * every login and every "set initial password" field. Renders the input plus a
 * trailing eye/eye-off button only — callers keep their own translated
 * <label htmlFor> so the visible label stays associated with the input.
 *
 * The toggle is type="button" (never submits the form) and its aria-label
 * flips with state so screen-reader users hear whether it will show or hide.
 */
import { InputHTMLAttributes, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordField({ id, ...rest }: Props) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const fallbackId = useId();

  return (
    <div className="pw-field">
      <input id={id ?? fallbackId} type={show ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className="pw-toggle"
        aria-label={show ? t('login.hidePassword') : t('login.showPassword')}
        aria-pressed={show}
        onClick={() => setShow((v) => !v)}
      >
        <span className="msym" aria-hidden="true">
          {show ? 'visibility_off' : 'visibility'}
        </span>
      </button>
    </div>
  );
}
