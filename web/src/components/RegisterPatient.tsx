/**
 * Register a walk-in patient at the facility (migration 0025).
 *
 * WHY THIS EXISTS. Not every presumptive TB patient arrives through a BHW. Some
 * walk in, some are sent by a private clinic, some come back on their own. Until
 * now the registry could only describe the BHW pathway, so those people existed
 * on paper at the facility and nowhere in the system — invisible to the hotspot
 * counts, to result recording, and to follow-up.
 *
 * WHAT IT WRITES, and why all three rows. A walk-in gets the SAME chain a BHW
 * referral gets — patient → screening → referral — because that is what makes
 * it behave identically everywhere downstream:
 *
 *   patients   enrolled_by = the signed-in staff member. `enrolled_by` was
 *              always a plain FK to users, never bhw-only; 0025 added the
 *              INSERT policy that was missing, not a column.
 *   screenings the same DOH-NTP checklist, evaluated by the same rule
 *              (lib/screeningRules.ts, mirroring the mobile module), plus the
 *              same optional PGI-S and vitals.
 *   referrals  addressed to this facility, starting at 'received' rather than
 *              'submitted' — there is no "waiting to arrive" phase for someone
 *              already standing at the desk.
 *
 * The referral row is also what makes the patient READABLE afterwards: 0021
 * scopes tb_dots reads to referred patients. Without it the record would vanish
 * from the facility that just created it.
 *
 * POSITIONING (§1, §5), unchanged and load-bearing here too. The checklist alone
 * decides `referred`. PGI-S is the patient's own words; vitals are measurements.
 * Neither feeds the decision, and nothing on this screen scores anything. A
 * screening that does NOT flag is still recorded and still registers the
 * patient — "does not meet presumptive criteria" is a real answer, not a
 * failure, and the facility still has someone in front of it.
 *
 * PRIVACY (§4): the contact number is stored ONLY alongside SMS consent, which
 * the patients_sms_consent_gate CHECK enforces in the database as well.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';
import {
  PortalUser,
  Sex,
  SYMPTOM_KEYS,
  SymptomFlags,
  TriState,
  Vitals,
  VITALS_KEYS,
  PgisSeverity,
  PatientRegistryMatch,
  ageFromBirthdate,
  manilaToday,
} from '../lib/types';
import { evaluateReferral, isChecklistComplete } from '../lib/screeningRules';
import { bmiFrom, emptyVitals, parseVital, VITALS_RANGE } from '../lib/vitals';
import AddressCascadeWeb from './AddressCascadeWeb';

const TRI: TriState[] = ['yes', 'no', 'unsure'];
const PGIS: PgisSeverity[] = ['none', 'mild', 'moderate', 'severe'];

/** Label and unit i18n keys per vitals field, written out IN FULL so the locale
 *  scan in i18n.test.ts sees them as literals rather than a runtime prefix. */
const VITALS_LABEL: Record<keyof Vitals, string> = {
  height_cm: 'vitals.height',
  weight_kg: 'vitals.weight',
  temperature_c: 'vitals.temperature',
  systolic_bp: 'vitals.systolic',
  diastolic_bp: 'vitals.diastolic',
  pulse_rate: 'vitals.pulse',
  spo2_percent: 'vitals.spo2',
};

const VITALS_UNIT: Record<keyof Vitals, string> = {
  height_cm: 'vitals.unitCm',
  weight_kg: 'vitals.unitKg',
  temperature_c: 'vitals.unitC',
  systolic_bp: 'vitals.unitMmHg',
  diastolic_bp: 'vitals.unitMmHg',
  pulse_rate: 'vitals.unitBpm',
  spo2_percent: 'vitals.unitPercent',
};

const emptyVitalsText = Object.fromEntries(VITALS_KEYS.map((k) => [k, ''])) as Record<
  keyof Vitals,
  string
>;

/** Basic PH mobile sanity check (11 digits starting 09) — mirrors the app. */
function isValidPhMobile(n: string): boolean {
  return /^09\d{9}$/.test(n.trim());
}

interface Props {
  me: PortalUser;
  /** Open the finished referral in the inbox. */
  onOpenReferral: (referralId: string) => void;
}

/** What the save produced, for the confirmation panel. */
interface Registered {
  referralId: string;
  displayCode: string;
  name: string;
  referred: boolean;
  reused: boolean;
}

interface RegistrationIds {
  requestId: string;
  patientId: string;
  screeningId: string;
  referralId: string;
}

interface RegisterWalkinResult {
  patient_id: string;
  screening_id: string;
  referral_id: string;
  display_code: string;
  full_name: string;
  referred: boolean;
  existing_patient?: boolean;
}

const newRegistrationIds = (): RegistrationIds => ({
  requestId: crypto.randomUUID(),
  patientId: crypto.randomUUID(),
  screeningId: crypto.randomUUID(),
  referralId: crypto.randomUUID(),
});

export default function RegisterPatient({ onOpenReferral }: Props) {
  const { t } = useTranslation();

  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [barangay, setBarangay] = useState<string | null>(null);
  const [sitio, setSitio] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [contactNumber, setContactNumber] = useState('');
  const [smsLanguage, setSmsLanguage] = useState<'en' | 'tl' | 'ceb'>('en');
  const [flags, setFlags] = useState<SymptomFlags>({});
  const [pgis, setPgis] = useState<PgisSeverity | null>(null);
  const [vitalsText, setVitalsText] = useState<Record<keyof Vitals, string>>(emptyVitalsText);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);
  const [lookupState, setLookupState] = useState<'idle' | 'searching' | 'clear' | 'matches' | 'error'>('idle');
  const [matches, setMatches] = useState<PatientRegistryMatch[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<PatientRegistryMatch | null>(null);
  const ids = useRef<RegistrationIds | null>(null);
  if (!ids.current) ids.current = newRegistrationIds();

  // Parse vitals once per render. Blank is always valid and stores null —
  // nothing here is required, and a facility without a working oximeter must
  // still be able to register the person in front of it.
  const vitals: Vitals = { ...emptyVitals };
  const vitalsInvalid: Partial<Record<keyof Vitals, boolean>> = {};
  for (const key of VITALS_KEYS) {
    const { value, valid } = parseVital(key, vitalsText[key]);
    vitals[key] = value;
    if (!valid) vitalsInvalid[key] = true;
  }
  const vitalsValid = VITALS_KEYS.every((k) => !vitalsInvalid[k]);
  const bmi = bmiFrom(vitals.height_cm, vitals.weight_kg);

  const age = ageFromBirthdate(birthdate || null);
  const checklistComplete = isChecklistComplete(flags);
  const outcome = checklistComplete ? evaluateReferral(flags) : null;
  const contactValid = !smsOptIn || isValidPhMobile(contactNumber);
  const lookupComplete = lookupState === 'clear' || selectedMatch !== null;

  const canSave =
    consentGiven &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    age !== null &&
    sex !== null &&
    !!barangay &&
    checklistComplete &&
    pgis !== null &&
    vitalsValid &&
    contactValid &&
    lookupComplete &&
    !busy;

  useEffect(() => {
    setLookupState('idle');
    setMatches([]);
    setSelectedMatch(null);
  }, [firstName, middleName, lastName, birthdate, contactNumber]);

  const searchRegistry = async () => {
    if (!firstName.trim() || !lastName.trim() || age === null) return;
    setLookupState('searching');
    setSelectedMatch(null);
    setError(null);
    const { data, error: lookupError } = await supabase.rpc('search_patient_registry', {
      p_first_name: firstName.trim(),
      p_middle_name: middleName.trim() || null,
      p_last_name: lastName.trim(),
      p_birthdate: birthdate,
      p_contact_number: contactNumber.trim() || null,
    });
    if (lookupError) {
      setMatches([]);
      setLookupState('error');
      setError(lookupError.message);
      return;
    }
    const found = (data ?? []) as PatientRegistryMatch[];
    setMatches(found);
    setLookupState(found.length ? 'matches' : 'clear');
  };

  const reset = () => {
    setFirstName('');
    setMiddleName('');
    setLastName('');
    setBirthdate('');
    setSex(null);
    setBarangay(null);
    setSitio('');
    setConsentGiven(false);
    setSmsOptIn(false);
    setContactNumber('');
    setFlags({});
    setPgis(null);
    setVitalsText(emptyVitalsText);
    setDone(null);
    setError(null);
    setLookupState('idle');
    setMatches([]);
    setSelectedMatch(null);
    ids.current = newRegistrationIds();
  };

  /** Migration 0032 owns the patient -> screening -> referral transaction.
   * The four ids live across retries, so a lost success response replays the
   * same request instead of creating a duplicate patient. */
  const save = async () => {
    if (!canSave || !sex || !barangay || age === null || !outcome) return;
    setBusy(true);
    setError(null);
    try {
      const operation = ids.current!;
      const screeningFields = {
        p_request_id: operation.requestId,
        p_patient_id: selectedMatch?.patient_id ?? operation.patientId,
        p_screening_id: operation.screeningId,
        p_referral_id: operation.referralId,
        p_symptom_flags: flags,
        p_pgis_severity: pgis,
        p_height_cm: vitals.height_cm,
        p_weight_kg: vitals.weight_kg,
        p_temperature_c: vitals.temperature_c,
        p_systolic_bp: vitals.systolic_bp,
        p_diastolic_bp: vitals.diastolic_bp,
        p_pulse_rate: vitals.pulse_rate,
        p_spo2_percent: vitals.spo2_percent,
      };
      const registration = selectedMatch
        ? supabase.rpc('register_existing_patient_walkin', {
            ...screeningFields,
            p_first_name: firstName.trim(),
            p_middle_name: middleName.trim() || null,
            p_last_name: lastName.trim(),
            p_birthdate: birthdate,
          })
        : supabase.rpc('register_walkin', {
            ...screeningFields,
            p_first_name: firstName.trim(),
            p_middle_name: middleName.trim() || null,
            p_last_name: lastName.trim(),
            p_birthdate: birthdate,
            p_sex: sex,
            p_barangay_code: barangay,
            p_sitio: sitio.trim() || null,
            p_sms_consent: smsOptIn,
            p_contact_number: smsOptIn ? contactNumber.trim() : null,
            p_preferred_language: smsOptIn ? smsLanguage : null,
          });
      const { data, error: rpcError } = await registration;
      if (rpcError) throw new Error(rpcError.message);
      const result = data as RegisterWalkinResult | null;
      if (!result?.referral_id || !result.display_code || !result.full_name) {
        throw new Error('Registration succeeded but returned an invalid response. Please retry.');
      }

      setDone({
        referralId: result.referral_id,
        displayCode: result.display_code,
        name: result.full_name,
        referred: result.referred,
        reused: result.existing_patient === true,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ---------- confirmation ----------
  if (done) {
    return (
      <div className="card centered regdone">
        <div className={`regdone-badge${done.referred ? ' flagged' : ''}`}>
          <span className="msym" aria-hidden="true">
            {done.referred ? 'assignment_turned_in' : 'check_circle'}
          </span>
        </div>
        <h2>{t('register.doneTitle', { name: done.name })}</h2>
        <p className="regdone-code">{done.displayCode}</p>
        <p className="regdone-body">
          {done.referred ? t('register.doneFlagged') : t('register.doneNotFlagged')}
        </p>
        {done.reused ? <p className="reg-reused">{t('register.existingReused')}</p> : null}
        <p className="mutedline">{t('common.nonDiagnostic')}</p>
        <div className="regdone-actions">
          <button onClick={() => onOpenReferral(done.referralId)}>
            <span className="msym" aria-hidden="true">
              move_to_inbox
            </span>
            {t('register.openInInbox')}
          </button>
          <button className="secondary" onClick={reset}>
            {t('register.registerAnother')}
          </button>
        </div>
      </div>
    );
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { type?: string; required?: boolean; max?: string; placeholder?: string } = {},
  ) => (
    <div className="dfield">
      <label className="dfield-lbl" htmlFor={id}>
        {label}
        {opts.required ? null : <span className="dfield-opt">{t('register.optional')}</span>}
      </label>
      <input
        id={id}
        type={opts.type ?? 'text'}
        value={value}
        max={opts.max}
        placeholder={opts.placeholder}
        onChange={(e) => set(e.target.value)}
      />
    </div>
  );

  const vitalField = (key: keyof Vitals) => (
    <div className="dfield" key={key}>
      <label className="dfield-lbl" htmlFor={`vital-${key}`}>
        {`${t(VITALS_LABEL[key])} (${t(VITALS_UNIT[key])})`}
      </label>
      <input
        id={`vital-${key}`}
        type="text"
        inputMode={VITALS_RANGE[key].decimals === 1 ? 'decimal' : 'numeric'}
        className={vitalsInvalid[key] ? 'bad' : undefined}
        aria-invalid={vitalsInvalid[key] === true}
        value={vitalsText[key]}
        onChange={(e) => setVitalsText((p) => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="regwrap">
      {/* Why this screen exists, said once at the top. */}
      <div className="reg-intro">
        <span className="msym" aria-hidden="true">
          person_add
        </span>
        <p>{t('register.intro')}</p>
      </div>

      {/* ---- Patient ---- */}
      <section className="card regsec">
        <h3>{t('register.patientSection')}</h3>
        <div className="dfield-row">
          {field('reg-first', t('register.firstName'), firstName, setFirstName, { required: true })}
          {field('reg-middle', t('register.middleName'), middleName, setMiddleName)}
          {field('reg-last', t('register.lastName'), lastName, setLastName, { required: true })}
        </div>
        <div className="dfield-row">
          {field('reg-birth', t('register.birthdate'), birthdate, setBirthdate, {
            type: 'date',
            required: true,
            max: manilaToday(),
          })}
          <div className="dfield">
            <span className="dfield-lbl">{t('register.age')}</span>
            {/* Derived, never typed — the same rule the mobile form follows. */}
            <div className="derived-box">{age !== null ? age : '—'}</div>
          </div>
          <div className="dfield">
            <span className="dfield-lbl">{t('register.sex')}</span>
            <div className="toggle-pair">
              {(['male', 'female'] as Sex[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`tog${sex === s ? ' on' : ''}`}
                  onClick={() => setSex(s)}
                >
                  {t(`sex.${s}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="dfield-row addr-row">
          <AddressCascadeWeb value={barangay} onChange={setBarangay} />
        </div>
        {field('reg-sitio', t('address.sitio'), sitio, setSitio)}
      </section>

      {/* ---- Consent ---- */}
      <section className="card regsec consent">
        <h3>{t('register.consentSection')}</h3>
        <p className="dfield-hint">{t('register.consentIntro')}</p>
        <label className="checkline">
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) => setConsentGiven(e.target.checked)}
          />
          <span>{t('register.consentConfirm')}</span>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={smsOptIn}
            onChange={(e) => {
              setSmsOptIn(e.target.checked);
              if (!e.target.checked) setContactNumber(''); // §4: no consent, no number
            }}
          />
          <span>{t('register.smsOptIn')}</span>
        </label>
        {smsOptIn ? (
          <div className="dfield-row">
            {field(
              'reg-contact',
              t('register.contactNumber'),
              contactNumber,
              setContactNumber,
              { required: true, placeholder: '09XXXXXXXXX' },
            )}
            <div className="dfield">
              <label className="dfield-lbl" htmlFor="reg-smslang">
                {t('register.smsLanguage')}
              </label>
              <select
                id="reg-smslang"
                value={smsLanguage}
                onChange={(e) => setSmsLanguage(e.target.value as 'en' | 'tl' | 'ceb')}
              >
                <option value="en">English</option>
                <option value="tl">Tagalog</option>
                <option value="ceb">Cebuano</option>
              </select>
            </div>
          </div>
        ) : null}
        {smsOptIn && contactNumber.length > 0 && !contactValid ? (
          <p className="error">{t('register.contactInvalid')}</p>
        ) : null}
      </section>

      <section className="card regsec patient-lookup">
        <div className="regsec-head">
          <h3>{t('register.lookupTitle')}</h3>
          <span className="ro-tag">{t('register.required')}</span>
        </div>
        <p className="dfield-hint">{t('register.lookupIntro')}</p>
        <button
          type="button"
          className="retry"
          disabled={!firstName.trim() || !lastName.trim() || age === null || lookupState === 'searching'}
          onClick={() => void searchRegistry()}
        >
          <span className="msym" aria-hidden="true">person_search</span>
          {lookupState === 'searching' ? t('register.lookupSearching') : t('register.lookupAction')}
        </button>
        {lookupState === 'idle' ? <p className="lookup-note">{t('register.lookupRequired')}</p> : null}
        {lookupState === 'clear' ? <p className="lookup-clear">{t('register.lookupClear')}</p> : null}
        {lookupState === 'error' ? <p className="error">{t('register.lookupError')}</p> : null}
        {matches.length > 0 ? (
          <div className="lookup-matches">
            <strong>{t('register.lookupFound')}</strong>
            {matches.map((match) => (
              <button
                type="button"
                key={match.patient_id}
                className={selectedMatch?.patient_id === match.patient_id ? 'selected' : ''}
                disabled={!match.can_reuse}
                onClick={() => setSelectedMatch(match)}
              >
                <span><b>{match.full_name ?? match.display_code}</b><small>{match.display_code}</small></span>
                <span>{match.phone_last4 ? `•••• ${match.phone_last4}` : t('register.noStoredPhone')}</span>
                <small>{match.can_reuse ? t('register.useExisting') : t('register.existingRestricted')}</small>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---- DOH-NTP checklist ---- */}
      <section className="card regsec">
        <h3>{t('register.checklistSection')}</h3>
        <p className="dfield-hint">{t('register.checklistIntro')}</p>
        {SYMPTOM_KEYS.map((key) => (
          <div key={key} className="sym-ask">
            <span className="sym-q">{t(`symptoms.${key}`)}</span>
            <div className="toggle-pair tri">
              {TRI.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`tog${flags[key] === v ? ' on' : ''}`}
                  onClick={() => setFlags((p) => ({ ...p, [key]: v }))}
                >
                  {t(`common.${v}`)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ---- PGI-S: the patient's own words, visually separate ---- */}
      <section className="card regsec pgis-sec">
        <div className="regsec-head">
          <h3>{t('register.pgisSection')}</h3>
          <span className="pr-tag">{t('detail.patientReportedTag')}</span>
        </div>
        <p className="dfield-hint">{t('register.pgisIntro')}</p>
        <div className="toggle-pair tri">
          {PGIS.map((v) => (
            <button
              key={v}
              type="button"
              className={`tog amberpick${pgis === v ? ' on' : ''}`}
              onClick={() => setPgis(v)}
            >
              {t(`pgis.${v}`)}
            </button>
          ))}
        </div>
      </section>

      {/* ---- Vitals: optional, measurements only ---- */}
      <section className="card regsec">
        <div className="regsec-head">
          <h3>{t('vitals.heading')}</h3>
          <span className="ro-tag">{t('vitals.optionalTag')}</span>
        </div>
        <p className="dfield-hint">{t('vitals.introFacility')}</p>
        <div className="dfield-row">
          {vitalField('height_cm')}
          {vitalField('weight_kg')}
          <div className="dfield">
            <span className="dfield-lbl">{t('vitals.bmiDerived')}</span>
            <div className="derived-box">{bmi !== null ? bmi.toFixed(1) : '—'}</div>
          </div>
        </div>
        <div className="dfield-row">
          {vitalField('temperature_c')}
          {vitalField('spo2_percent')}
        </div>
        <div className="dfield-row">
          {vitalField('systolic_bp')}
          {vitalField('diastolic_bp')}
          {vitalField('pulse_rate')}
        </div>
        {!vitalsValid ? <p className="error">{t('vitals.outOfRange')}</p> : null}
        <p className="rd-note">{t('vitals.contextNote')}</p>
      </section>

      {/* ---- Save ---- */}
      <div className="reg-foot">
        {outcome ? (
          <p className="reg-outcome">
            {outcome.referred ? t('register.willFlag') : t('register.willNotFlag')}
          </p>
        ) : (
          <p className="mutedline">{t('register.answerAll')}</p>
        )}
        {error ? <p className="error">{t('register.saveError', { message: error })}</p> : null}
        <button className="reg-save" disabled={!canSave} onClick={() => void save()}>
          {busy ? t('register.saving') : t('register.saveCta')}
        </button>
        <p className="mutedline">{t('common.nonDiagnostic')}</p>
      </div>
    </div>
  );
}
