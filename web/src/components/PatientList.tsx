import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { ageFromBirthdate, manilaToday, type PatientRow } from '../lib/types';
import { patientDraft, patientSearch, validPatientDraft, type PatientDraft } from '../lib/patientList';
import PatientTimeline from './PatientTimeline';
import './PatientList.css';

const PAGE_SIZE = 25;
type Props = { onRegister: () => void; onOpenReferral: (id: string) => void; onOpenCase: (id: string) => void };
type Referral = { referral_id: string; status: string; created_at: string };
type Case = { case_id: string; case_number: string; case_status: string };

function PatientDetail({ patient, onSaved, onClose, onOpenReferral, onOpenCase }: Props & { patient: PatientRow; onSaved: (p: PatientRow) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(() => patientDraft(patient));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [timeline, setTimeline] = useState(false);
  const [links, setLinks] = useState<{ referrals: Referral[]; cases: Case[] } | null>(null);
  const [linkError, setLinkError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [address, setAddress] = useState(patient.barangay_code);
  useEffect(() => {
    let cancelled = false;
    setLinks(null); setLinkError(false);
    void Promise.all([
      supabase.from('referrals').select('referral_id,status,created_at').eq('patient_id', patient.patient_id).order('created_at', { ascending: false }).limit(100),
      supabase.from('tb_cases').select('case_id,case_number,case_status').eq('patient_id', patient.patient_id).order('created_at', { ascending: false }).limit(100),
    ]).then(([r, c]) => {
      if (cancelled) return;
      if (r.error || c.error) setLinkError(true);
      else setLinks({ referrals: (r.data ?? []) as Referral[], cases: (c.data ?? []) as Case[] });
    }).catch(() => { if (!cancelled) setLinkError(true); });
    return () => { cancelled = true; };
  }, [patient.patient_id, retry]);
  useEffect(() => {
    let cancelled = false;
    setAddress(patient.barangay_code);
    void supabase.from('ref_barangays').select('name,ref_cities(name)').eq('barangay_code', patient.barangay_code).maybeSingle().then(({ data }) => {
      if (!cancelled && data) {
        const city = data.ref_cities as unknown as { name: string } | null;
        setAddress([data.name, city?.name].filter(Boolean).join(', '));
      }
    });
    return () => { cancelled = true; };
  }, [patient.barangay_code]);
  const update = (key: keyof PatientDraft, value: string | boolean | null) => setDraft(d => ({ ...d, [key]: value }));
  const save = async () => {
    if (busy || !confirmed || !validPatientDraft(draft)) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      const { data, error: e } = await supabase.rpc('update_facility_patient', {
        p_patient_id: patient.patient_id, p_expected_updated_at: patient.updated_at,
        p_first_name: draft.first_name?.trim(), p_middle_name: draft.middle_name?.trim() || null,
        p_last_name: draft.last_name?.trim(), p_birthdate: draft.birthdate, p_sex: draft.sex,
        p_barangay_code: draft.barangay_code, p_sitio: draft.sitio?.trim() || null,
        p_sms_consent: draft.sms_consent, p_contact_number: draft.sms_consent ? draft.contact_number?.trim() : null,
        p_preferred_language: draft.sms_consent ? draft.preferred_language : null,
      });
      if (e) {
        setError(t(e.code === '40001' ? 'patients.stale' : e.code === '23505' ? 'patients.duplicate' : e.code === 'PGRST202' ? 'patients.migration' : 'patients.saveError'));
        return;
      }
      if (!data?.patient_id || !data.updated_at) throw new Error('Invalid patient response');
      onSaved(data as PatientRow); setEditing(false); setSaved(true);
    } catch { setError(t('patients.saveError')); }
    finally { setBusy(false); }
  };
  const field = (key: 'first_name' | 'middle_name' | 'last_name' | 'birthdate' | 'sitio' | 'contact_number', label: string, type = 'text') => (
    <label className="dfield" key={key}>{label}<input type={type} value={draft[key] ?? ''} max={type === 'date' ? manilaToday() : undefined} maxLength={key === 'sitio' ? 200 : 100} onChange={e => update(key, e.target.value)} /></label>
  );
  return <section className="card patient-detail" aria-label={t('patients.details')}>
    <div className="patient-toolbar"><div><h3>{patient.full_name || patient.display_code}</h3><span>{patient.display_code}</span></div>
      <button className="secondary" disabled={busy} onClick={onClose}>{t('patients.back')}</button></div>
    {saved && <p role="status">{t('patients.saved')}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {editing ? <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <fieldset disabled={busy}>
        <p className="patient-notice">{t('patients.sharedWarning')}</p>
        <div className="patient-fields">
          {field('first_name', t('register.firstName'))}{field('middle_name', t('register.middleName'))}{field('last_name', t('register.lastName'))}
          {field('birthdate', t('register.birthdate'), 'date')}
          <label className="dfield">{t('register.sex')}<select value={draft.sex} onChange={e => update('sex', e.target.value)}><option value="male">{t('sex.male')}</option><option value="female">{t('sex.female')}</option></select></label>
        </div>
        <p>{t('patients.address')}: {address}</p><p>{t('patients.barangayLocked')}</p>
        {field('sitio', t('address.sitio'))}
        <label className="checkline"><input type="checkbox" checked={draft.sms_consent} onChange={e => setDraft(d => ({ ...d, sms_consent: e.target.checked, contact_number: e.target.checked ? d.contact_number : null, preferred_language: e.target.checked ? d.preferred_language ?? 'en' : null }))} />{t('register.smsOptIn')}</label>
        {draft.sms_consent && <div className="patient-fields">{field('contact_number', t('register.contactNumber'), 'tel')}<label className="dfield">{t('register.smsLanguage')}<select value={draft.preferred_language ?? 'en'} onChange={e => update('preferred_language', e.target.value)}><option value="en">English</option><option value="tl">Tagalog</option><option value="ceb">Cebuano</option></select></label></div>}
        <p>{t('patients.validation')}</p>
        <label className="checkline"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{t('patients.confirm')}</label>
        <div className="patient-toolbar"><button type="submit" disabled={!confirmed || !validPatientDraft(draft)}>{busy ? t('register.saving') : t('patients.save')}</button><button type="button" className="secondary" onClick={() => { setEditing(false); setError(''); }}>{t('patients.cancel')}</button></div>
      </fieldset>
    </form> : <>
      <dl className="patient-fields patient-facts">
        {[[t('register.firstName'), patient.first_name], [t('register.middleName'), patient.middle_name], [t('register.lastName'), patient.last_name], [t('register.birthdate'), patient.birthdate], [t('register.age'), ageFromBirthdate(patient.birthdate) ?? patient.age], [t('register.sex'), t(`sex.${patient.sex}`)], [t('patients.address'), [patient.sitio, address].filter(Boolean).join(', ')], [t('register.contactNumber'), patient.contact_number], [t('patients.smsConsent'), t(patient.sms_consent ? 'common.yes' : 'common.no')], [t('register.smsLanguage'), patient.preferred_language === 'en' ? 'English' : patient.preferred_language === 'tl' ? 'Tagalog' : patient.preferred_language === 'ceb' ? 'Cebuano' : null]].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
      </dl>
      <div className="patient-toolbar"><button onClick={() => { setDraft(patientDraft(patient)); setEditing(true); setConfirmed(false); setSaved(false); }}>{t('patients.edit')}</button><button className="secondary" onClick={() => setTimeline(v => !v)} aria-expanded={timeline}>{t('patients.timeline')}</button></div>
      {timeline && <PatientTimeline patientId={patient.patient_id} />}
      <h4>{t('patients.actions')}</h4><p>{t('patients.linksScope')}</p>
      {linkError ? <div role="alert"><p>{t('patients.loadError')}</p><button onClick={() => setRetry(v => v + 1)}>{t('common.refresh')}</button></div> : !links ? <p>{t('common.loading')}</p> : <div className="patient-links">
        <section><h4>{t('nav.inbox')}</h4>{!links.referrals.length && <p>{t('patients.noReferrals')}</p>}{links.referrals.map(r => <button className="secondary" key={r.referral_id} onClick={() => onOpenReferral(r.referral_id)}>{t('patients.openReferral')} · {r.created_at.slice(0, 10)} · {t(`status.${r.status}`, { defaultValue: r.status })}</button>)}</section>
        <section><h4>{t('nav.cases')}</h4>{!links.cases.length && <p>{t('patients.noCases')}</p>}{links.cases.map(c => <button className="secondary" key={c.case_id} onClick={() => onOpenCase(c.case_id)}>{c.case_number}</button>)}</section>
      </div>}
    </>}
  </section>;
}

export default function PatientList(props: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<PatientRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false); setRows([]);
    let request = supabase.from('patients').select('*', { count: 'exact' }).order('full_name').order('patient_id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (query) request = request.or(`full_name.ilike.%${query}%,display_code.ilike.%${query}%`);
    void Promise.resolve(request).then(({ data, count: total, error: e }) => {
      if (cancelled) return;
      if (e) setError(true);
      else { setRows((data ?? []) as PatientRow[]); setCount(total ?? 0); }
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [query, page, revision]);
  if (selected) return <PatientDetail key={selected.patient_id} {...props} patient={selected} onClose={() => { setSelected(null); setRevision(v => v + 1); }} onSaved={setSelected} />;
  return <section className="patient-list" aria-label={t('patients.title')}>
    <p>{t('patients.scope')}</p>
    <div className="patient-toolbar"><form onSubmit={e => { e.preventDefault(); setQuery(patientSearch(search)); setPage(0); }}><label htmlFor="patient-search">{t('patients.search')}</label><div className="patient-toolbar"><input id="patient-search" value={search} onChange={e => setSearch(e.target.value)} maxLength={100} /><button type="submit">{t('patients.searchButton')}</button></div></form><button onClick={props.onRegister}>{t('nav.register')}</button><button className="secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}>{t('common.refresh')}</button></div>
    {loading ? <p role="status">{t('common.loading')}</p> : error ? <p className="error" role="alert">{t('patients.loadError')}</p> : <>
      <p role="status">{t('patients.count', { count })}</p>
      {!rows.length ? <p>{t('patients.empty')}</p> : <div className="patient-table-wrap"><table className="patient-table"><thead><tr><th>{t('patients.name')}</th><th>{t('register.birthdate')}</th><th>{t('register.contactNumber')}</th><th>{t('patients.details')}</th></tr></thead><tbody>{rows.map(p => <tr key={p.patient_id}><td>{p.full_name || '—'}<small>{p.display_code}</small></td><td>{p.birthdate ?? '—'}</td><td>{p.contact_number ?? '—'}</td><td><button className="secondary" onClick={() => setSelected(p)} aria-label={`${t('patients.view')} ${p.full_name || p.display_code}`}>{t('patients.view')}</button></td></tr>)}</tbody></table></div>}
      <div className="patient-toolbar patient-pages"><button className="secondary" disabled={page === 0} onClick={() => setPage(v => v - 1)}>{t('patients.previous')}</button><span>{t('patients.page', { page: page + 1, pages: Math.max(1, Math.ceil(count / PAGE_SIZE)) })}</span><button className="secondary" disabled={(page + 1) * PAGE_SIZE >= count} onClick={() => setPage(v => v + 1)}>{t('patients.next')}</button></div>
    </>}
  </section>;
}
