/**
 * Screening (Feature 5): DOH-NTP symptom checklist + PGI-S, trilingual.
 * Restyled per design 1a screens 7/7b/7c as a step flow:
 *   one question per screen with large tri-state pills → amber PGI-S step
 *   (patient-reported, visually separate) → review-answers list → result.
 *
 * POSITIONING (§1) and NO-SCORING (§5) — enforced by structure:
 *  - The referral recommendation comes ONLY from evaluateReferral()
 *    (src/domain/screeningRules.ts) over the checklist answers. Nothing here
 *    computes, displays, or stores any score.
 *  - PGI-S is collected on its own amber step, labeled patient-reported
 *    ("None" is a valid answer); its value is recorded on the screening row
 *    but is never passed to evaluateReferral().
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
import { Appbar, Button, Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { insertLocalScreening } from '../../src/db/screeningsRepo';
import { PgisSeverity, SymptomFlags, TriState } from '../../src/db/types';
import {
  evaluateReferral,
  isChecklistComplete,
  SYMPTOM_KEYS,
} from '../../src/domain/screeningRules';
import { uuid } from '../../src/lib/uuid';
import { triggerSync } from '../../src/sync/syncManager';
import { palette } from '../../src/ui/tokens';

const PGIS_OPTIONS: PgisSeverity[] = ['none', 'mild', 'moderate', 'severe'];
const TOTAL_STEPS = SYMPTOM_KEYS.length + 1; // 9 checklist items + PGI-S

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
  const [phase, setPhase] = useState<Phase>('questions');
  const [step, setStep] = useState(0); // 0..8 checklist, 9 = PGI-S
  const [saving, setSaving] = useState(false);

  const isPgisStep = step === SYMPTOM_KEYS.length;
  const currentKey = SYMPTOM_KEYS[Math.min(step, SYMPTOM_KEYS.length - 1)];
  // PGI-S requires an answer like every other step ("None" is a valid answer);
  // it stays supplementary — never feeds the referral rule (§5).
  const answered = isPgisStep ? pgis !== null : flags[currentKey] !== undefined;
  const complete = isChecklistComplete(flags);
  const outcome = complete ? evaluateReferral(flags) : null;

  const setAnswer = (key: (typeof SYMPTOM_KEYS)[number], value: TriState) =>
    setFlags((prev) => ({ ...prev, [key]: value }));

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
      setStep(SYMPTOM_KEYS.length);
    } else if (step === 0) {
      router.back();
    } else {
      setStep(step - 1);
    }
  };

  const goNext = () => {
    if (!answered) return;
    if (isPgisStep) setPhase('review');
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

  // ---------- RESULT (design 7c) ----------
  if (phase === 'result' && outcome) {
    const meets = outcome.referred;
    return (
      <View style={{ flex: 1, backgroundColor: palette.background }}>
        <Appbar.Header style={{ backgroundColor: palette.background }}>
          <Appbar.BackAction onPress={goBack} />
        </Appbar.Header>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 8 }}>
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
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 8 }}>
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
            disabled={!complete || pgis === null}
            onPress={() => setPhase('result')}
            contentStyle={{ height: 54 }}
            labelStyle={{ fontSize: 15.5, fontWeight: '600' }}
            style={{ borderRadius: 27 }}
          >
            {complete && pgis !== null
              ? t('screening.seeRecommendation')
              : t('screening.answerAll')}
          </Button>
        </View>
      </View>
    );
  }

  // ---------- QUESTION / PGI-S STEPS (design 7) ----------
  const progress = (step + (answered && !isPgisStep ? 1 : 0)) / TOTAL_STEPS;
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

      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 20 }}>
        {!isPgisStep ? (
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
          {answered ? t('screening.next') : t('screening.answerFirst')}
        </Button>
      </View>
    </View>
  );
}
