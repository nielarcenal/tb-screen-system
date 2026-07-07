/**
 * Cascading PSGC address selector for the portal (mirrors the mobile
 * AddressCascade, brief §6): Region → Province → City/Municipality →
 * Barangay, each level filtered by its parent, reading the ref_* tables
 * (RLS: readable by any authenticated user). Levels with exactly one option
 * are auto-selected (the bundled scope is Bukidnon-only). Changing a parent
 * clears everything below it. Controlled: the parent owns the barangay code.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase';

interface Option {
  code: string;
  name: string;
}

interface Props {
  /** Selected barangay code (the only value that leaves this component). */
  value: string | null;
  onChange: (barangayCode: string | null) => void;
}

const asOptions = (rows: Record<string, unknown>[] | null, codeKey: string): Option[] =>
  (rows ?? []).map((r) => ({ code: String(r[codeKey]), name: String(r.name) }));

export default function AddressCascadeWeb({ value, onChange }: Props) {
  const { t } = useTranslation();

  const [regions, setRegions] = useState<Option[]>([]);
  const [provinces, setProvinces] = useState<Option[]>([]);
  const [cities, setCities] = useState<Option[]>([]);
  const [barangays, setBarangays] = useState<Option[]>([]);

  const [region, setRegion] = useState<string>('');
  const [province, setProvince] = useState<string>('');
  const [city, setCity] = useState<string>('');

  // Reverse-prefill the upper levels from an existing barangay code (edit).
  useEffect(() => {
    if (!value) return;
    void (async () => {
      const { data: b } = await supabase
        .from('ref_barangays')
        .select('city_code')
        .eq('barangay_code', value)
        .maybeSingle();
      if (!b) return;
      const { data: c } = await supabase
        .from('ref_cities')
        .select('province_code')
        .eq('city_code', b.city_code)
        .maybeSingle();
      if (!c) return;
      const { data: p } = await supabase
        .from('ref_provinces')
        .select('region_code')
        .eq('province_code', c.province_code)
        .maybeSingle();
      if (!p) return;
      setRegion(String(p.region_code));
      setProvince(String(c.province_code));
      setCity(String(b.city_code));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // once, from the initial value

  useEffect(() => {
    void supabase
      .from('ref_regions')
      .select('region_code, name')
      .order('name')
      .then(({ data }) => {
        const opts = asOptions(data, 'region_code');
        setRegions(opts);
        if (opts.length === 1) setRegion(opts[0].code);
      });
  }, []);

  useEffect(() => {
    if (!region) return setProvinces([]);
    void supabase
      .from('ref_provinces')
      .select('province_code, name')
      .eq('region_code', region)
      .order('name')
      .then(({ data }) => {
        const opts = asOptions(data, 'province_code');
        setProvinces(opts);
        if (opts.length === 1) setProvince(opts[0].code);
      });
  }, [region]);

  useEffect(() => {
    if (!province) return setCities([]);
    void supabase
      .from('ref_cities')
      .select('city_code, name')
      .eq('province_code', province)
      .order('name')
      .then(({ data }) => setCities(asOptions(data, 'city_code')));
  }, [province]);

  useEffect(() => {
    if (!city) return setBarangays([]);
    void supabase
      .from('ref_barangays')
      .select('barangay_code, name')
      .eq('city_code', city)
      .order('name')
      .then(({ data }) => setBarangays(asOptions(data, 'barangay_code')));
  }, [city]);

  const level = (
    id: string,
    label: string,
    val: string,
    options: Option[],
    enabled: boolean,
    set: (code: string) => void,
  ) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={val}
        disabled={!enabled}
        onChange={(e) => set(e.target.value)}
        style={{ width: '100%' }}
      >
        <option value="" />
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      {level('addr-region', t('address.region'), region, regions, regions.length > 0, (code) => {
        setRegion(code);
        setProvince('');
        setCity('');
        onChange(null);
      })}
      {level('addr-province', t('address.province'), province, provinces, !!region, (code) => {
        setProvince(code);
        setCity('');
        onChange(null);
      })}
      {level('addr-city', t('address.city'), city, cities, !!province, (code) => {
        setCity(code);
        onChange(null);
      })}
      {level('addr-brgy', t('address.barangay'), value ?? '', barangays, !!city, (code) =>
        onChange(code || null),
      )}
    </>
  );
}
