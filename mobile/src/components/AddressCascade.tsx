/**
 * Cascading PSGC address selector (brief §6):
 *   Region → Province → City/Municipality → Barangay,
 * each level filtered by its parent, reading from the OFFLINE reference tables.
 *
 * Notes:
 *  - Sitio is intentionally NOT part of this component: it is free text with no
 *    PSGC reference data and is never used for matching. Forms render their own
 *    sitio TextInput below this cascade.
 *  - Levels with exactly one option (region/province — the bundle is scoped to
 *    Bukidnon, a documented delimitation) are auto-selected.
 *  - Changing a parent clears all levels below it.
 *  - Controlled component; parent owns the selection.
 */
import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Dialog, Divider, List, Portal, Searchbar, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import {
  listBarangays,
  listCities,
  listProvinces,
  listRegions,
  PsgcOption,
} from '../db/psgcRepo';

import { autoSelectSingle, AddressSelection, emptyAddress } from './addressSelection';

// Re-exported so screens keep importing both from this component.
export type { AddressSelection };
export { emptyAddress };

interface Props {
  value: AddressSelection;
  /**
   * Same shape as a useState setter, and the updater form is load-bearing:
   * the auto-select below runs from an async callback and MUST merge into
   * whatever the newest selection is, including one already queued by the
   * parent's pre-fill but not yet rendered. Passing a plain object there
   * overwrites that queued value (see autoSelectSingle). User taps stay
   * plain objects — they carry intent, and the parent may act on them.
   */
  onChange: Dispatch<SetStateAction<AddressSelection>>;
  disabled?: boolean;
}

type Level = 'region' | 'province' | 'city' | 'barangay';

/** One tappable field; opens the shared picker dialog. */
function PickerField({
  label,
  selectedName,
  enabled,
  onOpen,
}: {
  label: string;
  selectedName: string;
  enabled: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable onPress={enabled ? onOpen : undefined}>
      <View pointerEvents="none">
        <TextInput
          mode="outlined"
          label={label}
          value={selectedName}
          editable={false}
          disabled={!enabled}
          right={<TextInput.Icon icon="menu-down" />}
        />
      </View>
    </Pressable>
  );
}

export default function AddressCascade({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();

  const [regions, setRegions] = useState<PsgcOption[]>([]);
  const [provinces, setProvinces] = useState<PsgcOption[]>([]);
  const [cities, setCities] = useState<PsgcOption[]>([]);
  const [barangays, setBarangays] = useState<PsgcOption[]>([]);

  const [openLevel, setOpenLevel] = useState<Level | null>(null);
  const [search, setSearch] = useState('');

  // The effects below must not re-run per selection change, so their closures
  // go stale; onChange is read through a ref to keep them on the live one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // --- load each level when its parent changes; auto-select single options ---
  useEffect(() => {
    void listRegions().then((r) => {
      setRegions(r);
      onChangeRef.current((prev) => autoSelectSingle(prev, 'regionCode', r) ?? prev);
    });
  }, []);

  useEffect(() => {
    if (!value.regionCode) return setProvinces([]);
    void listProvinces(value.regionCode).then((p) => {
      setProvinces(p);
      onChangeRef.current((prev) => autoSelectSingle(prev, 'provinceCode', p) ?? prev);
    });
  }, [value.regionCode]);

  useEffect(() => {
    if (!value.provinceCode) return setCities([]);
    void listCities(value.provinceCode).then(setCities);
  }, [value.provinceCode]);

  useEffect(() => {
    if (!value.cityCode) return setBarangays([]);
    void listBarangays(value.cityCode).then(setBarangays);
  }, [value.cityCode]);

  const nameOf = (opts: PsgcOption[], code: string | null) =>
    (code && opts.find((o) => o.code === code)?.name) || '';

  const optionsFor: Record<Level, PsgcOption[]> = {
    region: regions,
    province: provinces,
    city: cities,
    barangay: barangays,
  };

  const filtered = useMemo(() => {
    const opts = openLevel ? optionsFor[openLevel] : [];
    const q = search.trim().toLowerCase();
    return q ? opts.filter((o) => o.name.toLowerCase().includes(q)) : opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLevel, search, regions, provinces, cities, barangays]);

  const select = useCallback(
    (code: string) => {
      switch (openLevel) {
        case 'region':
          onChange({ regionCode: code, provinceCode: null, cityCode: null, barangayCode: null });
          break;
        case 'province':
          onChange({ ...value, provinceCode: code, cityCode: null, barangayCode: null });
          break;
        case 'city':
          onChange({ ...value, cityCode: code, barangayCode: null });
          break;
        case 'barangay':
          onChange({ ...value, barangayCode: code });
          break;
      }
      setOpenLevel(null);
      setSearch('');
    },
    [openLevel, value, onChange],
  );

  const open = (level: Level) => {
    setSearch('');
    setOpenLevel(level);
  };

  return (
    <View style={{ gap: 8 }}>
      <PickerField
        label={t('address.region')}
        selectedName={nameOf(regions, value.regionCode)}
        enabled={!disabled && regions.length > 0}
        onOpen={() => open('region')}
      />
      <PickerField
        label={t('address.province')}
        selectedName={nameOf(provinces, value.provinceCode)}
        enabled={!disabled && !!value.regionCode}
        onOpen={() => open('province')}
      />
      <PickerField
        label={t('address.city')}
        selectedName={nameOf(cities, value.cityCode)}
        enabled={!disabled && !!value.provinceCode}
        onOpen={() => open('city')}
      />
      <PickerField
        label={t('address.barangay')}
        selectedName={nameOf(barangays, value.barangayCode)}
        enabled={!disabled && !!value.cityCode}
        onOpen={() => open('barangay')}
      />

      <Portal>
        <Dialog visible={openLevel !== null} onDismiss={() => setOpenLevel(null)}>
          <Dialog.Title>{openLevel ? t(`address.${openLevel}`) : ''}</Dialog.Title>
          <Dialog.Content style={{ paddingHorizontal: 0, maxHeight: 420 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Searchbar
                placeholder={t('address.search')}
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <Divider />
            <FlatList
              data={filtered}
              keyExtractor={(o) => o.code}
              style={{ maxHeight: 340 }}
              renderItem={({ item }) => (
                <List.Item title={item.name} onPress={() => select(item.code)} />
              )}
            />
          </Dialog.Content>
        </Dialog>
      </Portal>
    </View>
  );
}
