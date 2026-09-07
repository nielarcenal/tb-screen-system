/**
 * Screening (Feature 5): DOH-NTP symptom checklist + PGI-S + optional vitals,
 * trilingual. Restyled per design 1a screens 7/7b/7c as a step flow:
 *   one question per screen with large tri-state pills → amber PGI-S step
 *   (patient-reported, visually separate) → optional vitals step → review-answers
 *   list → result.
 *
 * POSITIONING (§1) and NO-SCORING (§5) — enforced by structure:
 *  - The referral recommendation comes ONLY from evaluateReferral()
 *    (src/domain/screeningRules.ts) over the checklist answers. Nothing here
 *    computes, displays, or stores any score.
 *  - PGI-S is collected on its own amber step, labeled patient-reported
 *    ("None" is a valid answer); its value is recorded on the screening row
 *    but is never passed to evaluateReferral().
 *  - Vitals (0024) sit on their own step AFTER the checklist and PGI-S, are
 *    ENTIRELY OPTIONAL — every field may be left blank and the step skipped —
 *    and are likewise never passed to evaluateReferral(). A BHW whose
 *    thermometer or oximeter is flat that day must still finish the screening.
 *    They are printed on the referral document so the facility has them on
 *    arrival; BMI is derived there, not stored (domain/vitals.ts).
 *  - The outcome is worded as "flags for referral (presumptive TB)" with the
 *    rule that fired, plus a standing "this is not a diagnosis" note.
 *
 * Answers are tri-state (yes/no/unsure); every checklist item must be answered
 * before finishing, and only an explicit "yes" counts toward the rule (§5).
 * The screening row is saved ONCE, when leaving the result step ("Done" or
 * "Create referral") — editing answers before that never writes.
 */
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Appbar, Button, Text, TextInput } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { insertLocalScreening } from '../../src/db/screeningsRepo';
import { PgisSeverity, SymptomFlags, TriState, Vitals, VITALS_KEYS } from '../../src/db/types';
import {
  evaluateReferral,
  isChecklistComplete,
  SYMPTOM_KEYS,
} from '../../src/domain/screeningRules';
import { bmiFrom, emptyVitals, parseVital, VITALS_RANGE } from '../../src/domain/vitals';
import { uuid } from '../../src/lib/uuid';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

const PGIS_OPTIONS: PgisSeverity[] = ['none', 'mild', 'moderate', 'severe'];
const TOTAL_STEPS = SYMPTOM_KEYS.length + 2; // 9 checklist items + PGI-S + vitals

/** Blank text for every vitals field — the state the step opens in and the
 *  state it is perfectly valid to leave in. */
const emptyVitalsText = Object.fromEntries(VITALS_KEYS.map((k) => [k, ''])) as Record<
  keyof Vitals,
  string
>;

/** Label and unit i18n keys per vitals field, written out IN FULL. The locale
 *  scan in src/i18n/i18n.test.ts reads source for literal key strings; a
 *  `vitals.${...}` template would force the whole namespace onto the
 *  runtime-built allowlist and hide any genuine orphan inside it. */
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

type Phase = 'questions' | 'review' | 'result';

const TRI_OPTIONS: {
  value: TriState;
  icon: string;
  selected: { border: string; bg: string; fg: string; borderWidth: number };
}[] = [
  {
    value: 'yes',
    icon: 'check',
    selected: { border: 'transparent', bg: palette.teal, fg: '#FFFFFF', borderWidth: 0 },
  },
  {
    value: 'no',
    icon: 'close',
    selected: { border: palette.ink, bg: palette.paper, fg: palette.ink, borderWidth: 2 },
  },
  {
    value: 'unsure',
    icon: 'help',
    selected: {
      border: 'transparent',
      bg: palette.surfaceVariant,
      fg: palette.inkMid,
      borderWidth: 0,
    },
  },
];

export default function ScreeningScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();

  const [flags, setFlags] = useState<SymptomFlags>({});
  const [pgis, setPgis] = useState<PgisSeverity | null>(null);
  // Vitals are held as the RAW TEXT typed, not as parsed numbers: a half-typed
  // "3" on the way to "36.8" is out of range, and re-rendering the field from a
  // parsed value would delete it under the BHW's fingers.
  const [vitalsText, setVitalsText] = useState<Record<keyof Vitals, string>>(emptyVitalsText);
  const [phase, setPhase] = useState<Phase>('questions');
  const [step, setStep] = useState(0); // 0..8 checklist, 9 = PGI-S, 10 = vitals
  const [saving, setSaving] = useState(false);

  const isPgisStep = step === SYMPTOM_KEYS.length;
  const isVitalsStep = step === SYMPTOM_KEYS.length + 1;
  const currentKey = SYMPTOM_KEYS[Math.min(step, SYMPTOM_KEYS.length - 1)];

  // Parse once per render: the values to store, and which fields to mark bad.
  // Blank always parses valid to null — nothing here is ever required (§5).
  const vitals: Vitals = { ...emptyVitals };
  const vitalsInvalid: Partial<Record<keyof Vitals, boolean>> = {};
  for (const key of VITALS_KEYS) {
    const { value, valid } = parseVital(key, vitalsText[key]);
    vitals[key] = value;
    if (!valid) vitalsInvalid[key] = true;
  }
  const vitalsValid = VITALS_KEYS.every((k) => !vitalsInvalid[k]);
  const bmi = bmiFrom(vitals.height_cm, vitals.weight_kg);

  // PGI-S requires an answer like every other checklist step ("None" is valid);
  // the VITALS step requires nothing at all — it may be walked straight past —
  // but a value that is present must be a value the database will accept.
  // Both stay supplementary: neither feeds the referral rule (§5).
  const answered = isVitalsStep
    ? vitalsValid
    : isPgisStep
      ? pgis !== null
      : flags[currentKey] !== undefined;
  const complete = isChecklistComplete(flags);
  const outcome = complete ? evaluateReferral(flags) : null;

  const setAnswer = (key: (typeof SYMPTOM_KEYS)[number], value: TriState) =>
    setFlags((prev) => ({ ...prev, [key]: value }));

  const setVital = (key: keyof Vitals, text: string) =>
    setVitalsText((prev) => ({ ...prev, [key]: text }));

  /** Save once, then run the exit action. Used by Done / Create referral. */
  const saveAnd = async (after: (screeningId: string) => void) => {
    if (!patientId || !outcome || saving) return;
    setSaving(true);
    try {
      const screeningId = uuid();
      await insertLocalScreening({
        screening_id: screeningId,
        patient_id: patientId,
        symptom_flags: flags,
        pgis_severity: pgis, // supplementary only — not part of `outcome` (§5)
        ...vitals, // likewise supplementary; any or all may be null (§5)
        referred: outcome.referred,
      });
      void triggerSync(); // best-effort; row stays queued if offline
      after(screeningId);
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    if (phase === 'result') {
      setPhase('review');
    } else if (phase === 'review') {
      setPhase('questions');
      setStep(SYMPTOM_KEYS.length + 1); // back into the vitals step
    } else if (step === 0) {
      router.back();
    } else {
      setStep(step - 1);
    }
  };

  const goNext = () => {
    if (!answered) return;
    if (isVitalsStep) setPhase('review');
    else setStep(step + 1);
  };

  /** Large tri-state pill (design component sheet: Yes filled teal / No outlined ink / Unsure tonal). */
  const triPill = (
    key: (typeof SYMPTOM_KEYS)[number],
    opt: (typeof TRI_OPTIONS)[number],
    compact = false,
  ) => {
    const on = flags[key] === opt.value;
    return (
      <Pressable
        key={opt.value}
        onPress={() => setAnswer(key, opt.value)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: compact ? 6 : 12,
          minHeight: compact ? 40 : 58,
          paddingHorizontal: compact ? 8 : 18,
          paddingVertical: compact ? 4 : 8,
          flex: compact ? 1 : undefined,
          borderRadius: 29,
          borderWidth: on ? opt.selected.borderWidth : 1.5,
          borderColor: on ? opt.selected.border : palette.outline,
          backgroundColor: on ? opt.selected.bg : palette.paper,
        }}
      >
        {!compact ? (
          <MaterialCommunityIcons
            name={opt.icon as never}
            size={23}
            color={on ? opt.selected.fg : palette.inkMid}
          />
        ) : null}
        <Text
          variant={compact ? 'labelMedium' : 'titleMedium'}
          style={{ color: on ? opt.selected.fg : palette.inkMid, fontWeight: '600' }}
        >
          {t(`common.${opt.value}`)}
        </Text>
      </Pressable>
    );
  };

  /** PGI-S pill (amber family = the patient's own voice, distinct from BHW teal). */
  const pgisPill = (opt: PgisSeverity, compact = false) => {
    const on = pgis === opt;
    return (
      <Pressable
        key={opt}
        onPress={() => setPgis(opt)}
        style={{
          flex: compact ? 1 : undefined,
          minHeight: compact ? 40 : 58,
          paddingHorizontal: compact ? 4 : 20,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 29,
          borderWidth: on ? 0 : 1.5,
          borderColor: palette.amberBorder,
          backgroundColor: on ? palette.amber : palette.paper,
        }}
      >
        <Text
          variant={compact ? 'labelMedium' : 'titleMedium'}
          style={{ color: on ? '#FFFFFF' : palette.amberSoft, fontWeight: '600' }}
        >
          {t(`screening.pgisOptions.${opt}`)}
        </Text>
      </Pressable>
    );
  };

  /**
   * One vitals input. Deliberately plain: a label, a unit, and a number field.
   * No colour coding, no thresholds, no "normal range" hint — a measurement
   * carries no verdict in this system (§1/§5), and a red field would be one.
   * `error` marks only a value the database's CHECK would reject.
   */
  const vitalField = (key: keyof Vitals) => (
    <View key={key} style={{ flex: 1, minWidth: 132 }}>
      <TextInput
        mode="outlined"
        label={`${t(VITALS_LABEL[key])} (${t(VITALS_UNIT[key])})`}
        value={vitalsText[key]}
        onChangeText={(v) => setVital(key, v)}
        error={vitalsInvalid[key] === true}
        keyboardType={VITALS_RANGE[key].decimals === 1 ? 'decimal-pad' : 'number-pad'}
        style={{ backgroundColor: palette.paper }}
      />
    </View>
  );

  /** The whole optional vitals grid — shared by its own step and the review. */
  const vitalsGrid = (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {vitalField('height_cm')}
        {vitalField('weight_kg')}
      </View>
      {/* BMI is DERIVED here, never stored and never categorised — it is a
          restatement of the two fields above it, shown the way age is shown
          next to birthdate on the enrolment form. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 12,
          backgroundColor: palette.surfaceVariant,
        }}
      >
        <Text variant="bodySmall" style={{ color: palette.muted, flex: 1 }}>
          {t('vitals.bmiDerived')}
        </Text>
        <Text
          variant="titleMedium"
          style={{ fontWeight: '700', color: bmi !== null ? palette.tealDark : palette.outline }}
        >
          {bmi !== null ? bmi.toFixed(1) : '—'}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {vitalField('temperature_c')}
        {vitalField('spo2_percent')}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {vitalField('systolic_bp')}
        {vitalField('diastolic_bp')}
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {vitalField('pulse_rate')}
        <View style={{ flex: 1, minWidth: 132 }} />
      </View>
      {!vitalsValid ? (
        <Text variant="bodySmall" style={{ color: palette.red, lineHeight: 18 }}>
          {t('vitals.outOfRange')}
        </Text>
      ) : null}
    </View>
  );

  // ---------- RESULT (design 7c) ----------
  if (phase === 'result' && outcome) {
    const meets = outcome.referred;
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <Appbar.Header style={{ backgroundColor: palette.background }}>
          <Appbar.BackAction onPress={goBack} />
        </Appbar.Header>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 8 }}
        >
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <View
              style={{
                backgroundColor: meets ? palette.tealContainer : palette.surfaceSubtle,
                borderWidth: 1.5,
                borderColor: meets ? palette.tealBorder : palette.border,
                borderRadius: 24,
                paddingVertical: 32,
                paddingHorizontal: 24,
                alignItems: 'center',
                gap: 12,
              }}
            >
              <MaterialCommunityIcons
                name={meets ? 'clipboard-check' : 'check-circle-outline'}
                size={56}
                color={meets ? palette.tealDark : palette.muted}
              />
              <Text
                variant="headlineSmall"
                style={{
                  color: meets ? palette.tealDeep : palette.inkMid,
                  fontWeight: '700',
                  textAlign: 'center',
                }}
              >
                {t(meets ? 'screening.outcomeTitleReferred' : 'screening.outcomeTitleNot')}
              </Text>
              <Text
                variant="bodyLarge"
                style={{
                  color: meets ? palette.tealDeep : palette.inkMid,
                  textAlign: 'center',
                  lineHeight: 24,
                }}
              >
                {meets ? t('screening.outcomeReferred') : t('screening.outcomeNotReferred')}
              </Text>
              {outcome.reason === 'cardinal_symptom' ? (
                <Text
                  variant="bodySmall"
                  style={{ color: palette.tealDeep, textAlign: 'center', lineHeight: 19 }}
                >
                  {t('screening.reasonCardinal')}
                </Text>
              ) : null}
              {outcome.reason === 'contact_with_symptom' ? (
                <Text
                  variant="bodySmall"
                  style={{ color: palette.tealDeep, textAlign: 'center', lineHeight: 19 }}
                >
                  {t('screening.reasonContact')}
                </Text>
              ) : null}
              {!meets ? (
                <Text
                  variant="bodySmall"
                  style={{ color: palette.inkMid, textAlign: 'center', lineHeight: 19 }}
                >
                  {t('screening.notReferredAdvice')}
                </Text>
              ) : null}
            </View>

            {/* Standing non-diagnosis note (§1). */}
            <View
              style={{
                marginTop: 16,
                flexDirection: 'row',
                gap: 10,
                padding: 14,
                borderRadius: 14,
                backgroundColor: palette.surfaceSubtle,
              }}
            >
              <MaterialCommunityIcons name="information-outline" size={19} color={palette.muted} />
              <Text variant="bodySmall" style={{ flex: 1, color: palette.inkSoft, lineHeight: 19 }}>
                {t('screening.nonDiagnostic')}
              </Text>
            </View>
          </View>

          <View style={{ gap: 12, marginTop: 20, paddingBottom: 8 }}>
            {meets ? (
              <Button
                mode="contained"
                loading={saving}
                disabled={saving}
                onPress={() =>
                  void saveAnd((screeningId) => router.replace(`/referral/${screeningId}`))
                }
                contentStyle={{ height: 56 }}
                labelStyle={{ fontSize: 17, fontWeight: '600' }}
                style={{ borderRadius: 28 }}
              >
                {t('patientDetail.createReferral')}
              </Button>
            ) : null}
            <Button
              mode="outlined"
              disabled={saving}
              onPress={() => setPhase('review')}
              textColor={palette.teal}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontWeight: '600' }}
              style={{ borderRadius: 26, borderColor: palette.teal }}
            >
              {t('screening.reviewTitle')}
            </Button>
            <Button
              mode="outlined"
              loading={saving && !meets}
              disabled={saving}
              onPress={() => void saveAnd(() => router.back())}
              textColor={palette.inkMid}
              contentStyle={{ height: 52 }}
              labelStyle={{ fontWeight: '600' }}
              style={{ borderRadius: 26, borderColor: palette.outline }}
            >
              {t('screening.saveCta')}
            </Button>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ---------- REVIEW (design 7b) ----------
  if (phase === 'review') {
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <Appbar.Header style={{ backgroundColor: palette.background }}>
          <Appbar.BackAction onPress={goBack} />
          <Appbar.Content title={t('screening.reviewTitle')} />
        </Appbar.Header>
        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 8 }}
        >
          <Text variant="bodySmall" style={{ color: palette.inkSoft, marginBottom: 4 }}>
            {t('screening.reviewHint')}
          </Text>
          {SYMPTOM_KEYS.map((key) => (
            <View
              key={key}
              style={{
                backgroundColor: palette.paper,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                gap: 9,
              }}
            >
              <Text variant="bodyMedium" style={{ color: palette.ink, fontWeight: '500' }}>
                {t(`screening.symptoms.${key}`)}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {TRI_OPTIONS.map((opt) => triPill(key, opt, true))}
              </View>
            </View>
          ))}

          {/* PGI-S — amber, patient-reported, optional. */}
          <View
            style={{
              backgroundColor: '#FFF9EE',
              borderWidth: 1.5,
              borderColor: palette.amberBorder,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 9,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="account-voice" size={16} color={palette.amber} />
              <Text
                variant="labelSmall"
                style={{ color: palette.amber, fontWeight: '700', letterSpacing: 0.7 }}
              >
                {t('screening.patientReportedTag').toUpperCase()}
              </Text>
            </View>
            <Text variant="bodyMedium" style={{ color: palette.ink, fontWeight: '500' }}>
              {t('screening.pgisHeading')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {PGIS_OPTIONS.map((opt) => pgisPill(opt, true))}
            </View>
          </View>

          {/* Vitals — optional, and still optional here: the review may be left
              with every field blank. */}
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MaterialCommunityIcons name="heart-pulse" size={16} color={palette.muted} />
              <Text
                variant="labelSmall"
                style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.7 }}
              >
                {t('vitals.optionalTag').toUpperCase()}
              </Text>
            </View>
            <Text variant="bodyMedium" style={{ color: palette.ink, fontWeight: '500' }}>
              {t('vitals.heading')}
            </Text>
            {vitalsGrid}
          </View>
        </ScrollView>
        <View
          style={{
            padding: 20,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: palette.surfaceVariant,
            backgroundColor: palette.background,
          }}
        >
          <Button
            mode="contained"
            disabled={!complete || pgis === null || !vitalsValid}
            onPress={() => setPhase('result')}
            contentStyle={{ height: 54 }}
            labelStyle={{ fontSize: 15.5, fontWeight: '600' }}
            style={{ borderRadius: 27 }}
          >
            {!complete || pgis === null
              ? t('screening.answerAll')
              : !vitalsValid
                ? t('vitals.fixBeforeContinuing')
                : t('screening.seeRecommendation')}
          </Button>
        </View>
      </View>
    );
  }

  // ---------- QUESTION / PGI-S STEPS (design 7) ----------
  const progress = (step + (answered && !isPgisStep && !isVitalsStep ? 1 : 0)) / TOTAL_STEPS;
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Appbar.Header style={{ backgroundColor: palette.background }}>
        <Appbar.BackAction onPress={goBack} />
        <Appbar.Content title={t('screening.checklistHeading')} />
      </Appbar.Header>

      {/* Progress. */}
      <View style={{ paddingHorizontal: 24 }}>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: palette.surfaceVariant,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: palette.seafoam,
              width: `${Math.round(progress * 100)}%`,
            }}
          />
        </View>
        <Text
          variant="labelMedium"
          style={{ marginTop: 8, color: palette.muted, fontWeight: '600' }}
        >
          {t('screening.stepOf', { step: step + 1, total: TOTAL_STEPS })}
        </Text>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}
      >
        {isVitalsStep ? (
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 20,
              padding: 24,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialCommunityIcons name="heart-pulse" size={19} color={palette.muted} />
              <Text
                variant="labelSmall"
                style={{ color: palette.muted, fontWeight: '700', letterSpacing: 0.9 }}
              >
                {t('vitals.optionalTag').toUpperCase()}
              </Text>
            </View>
            <Text
              variant="headlineSmall"
              style={{ marginTop: 10, color: palette.ink, fontWeight: '600', lineHeight: 31 }}
            >
              {t('vitals.heading')}
            </Text>
            <Text
              variant="bodySmall"
              style={{ marginTop: 8, color: palette.inkSoft, lineHeight: 19 }}
            >
              {t('vitals.intro')}
            </Text>
            <View style={{ marginTop: 22 }}>{vitalsGrid}</View>
          </View>
        ) : !isPgisStep ? (
          <View
            style={{
              backgroundColor: palette.paper,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 20,
              padding: 24,
            }}
          >
            <Text
              variant="labelSmall"
              style={{ color: palette.seafoam, fontWeight: '700', letterSpacing: 0.9 }}
            >
              {t('screening.checklistHeading').toUpperCase()}
            </Text>
            <Text
              variant="headlineSmall"
              style={{ marginTop: 10, color: palette.ink, fontWeight: '600', lineHeight: 31 }}
            >
              {t(`screening.symptoms.${currentKey}`)}
            </Text>
            <View style={{ marginTop: 24, gap: 12 }}>
              {TRI_OPTIONS.map((opt) => triPill(currentKey, opt))}
            </View>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: '#FFF9EE',
              borderWidth: 1.5,
              borderColor: palette.amberBorder,
              borderRadius: 20,
              padding: 24,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialCommunityIcons name="account-voice" size={19} color={palette.amber} />
              <Text
                variant="labelSmall"
                style={{ color: palette.amber, fontWeight: '700', letterSpacing: 0.9 }}
              >
                {t('screening.patientReportedTag').toUpperCase()}
              </Text>
            </View>
            <Text
              variant="headlineSmall"
              style={{ marginTop: 10, color: palette.ink, fontWeight: '600', lineHeight: 31 }}
            >
              {t('screening.pgisHeading')}
            </Text>
            <Text
              variant="bodySmall"
              style={{ marginTop: 8, color: palette.amberSoft, lineHeight: 19 }}
            >
              {t('screening.pgisIntro')}
            </Text>
            <View style={{ marginTop: 22, gap: 12 }}>
              {PGIS_OPTIONS.map((opt) => pgisPill(opt))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Back / Next. */}
      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          padding: 24,
          paddingTop: 14,
          borderTopWidth: 1,
          borderTopColor: palette.surfaceVariant,
          backgroundColor: palette.background,
        }}
      >
        <Button
          mode="outlined"
          onPress={goBack}
          textColor={palette.inkMid}
          contentStyle={{ height: 54 }}
          labelStyle={{ fontWeight: '600' }}
          style={{ flex: 1, borderRadius: 27, borderColor: palette.outline }}
        >
          {t('common.back')}
        </Button>
        <Button
          mode="contained"
          onPress={goNext}
          disabled={!answered}
          contentStyle={{ height: 54 }}
          labelStyle={{ fontWeight: '600' }}
          style={{ flex: 2, borderRadius: 27 }}
        >
          {isVitalsStep
            ? // Naming the skip is the point: a BHW with no working thermometer
              // needs to see that moving on is a supported choice, not a lapse.
              !vitalsValid
              ? t('vitals.fixBeforeContinuing')
              : VITALS_KEYS.every((k) => vitalsText[k].trim() === '')
                ? t('vitals.skipCta')
                : t('screening.next')
            : answered
              ? t('screening.next')
              : t('screening.answerFirst')}
        </Button>
      </View>
    </View>
  );
}
