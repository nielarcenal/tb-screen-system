/**
 * Draws whatever `showConfirm()` is currently asking. Mounted once, at the app
 * root; see confirmDialog.ts for why the app draws this instead of calling
 * `Alert.alert`.
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: the two buttons are ALWAYS stacked
 * and the safe one is ALWAYS on top, in every language, at every font scale.
 * Nothing about the layout is conditional on the label text, because that
 * condition is exactly what Android's AlertDialog got wrong.
 *
 * It uses React Native's `Modal` rather than a Paper `Portal`, because this has
 * to appear above ChangePasswordGate — an absolutely-positioned overlay with
 * `elevation: 24` — and a native modal window sidesteps arguing about
 * elevation and z-index with it.
 */
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Button, Text } from 'react-native-paper';

import { answerConfirm, useConfirmDialogStore } from '../lib/confirmDialog';
import { palette } from '../ui/tokens';

export default function ConfirmDialogHost() {
  const pending = useConfirmDialogStore((s) => s.pending);

  return (
    <Modal
      visible={pending !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      // Android's hardware back. Dismissing answers "no", matching what
      // Alert.alert did and keeping the safe answer the easy one.
      onRequestClose={() => {
        if (pending) answerConfirm(pending.id, false);
      }}
    >
      {pending ? (
        <Pressable
          onPress={() => answerConfirm(pending.id, false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(32, 48, 46, 0.45)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          {/* Swallows taps on the card itself so they don't reach the scrim. */}
          <Pressable
            onPress={() => {}}
            accessibilityViewIsModal
            style={{
              backgroundColor: palette.paper,
              borderRadius: 20,
              paddingHorizontal: 24,
              paddingVertical: 22,
              gap: 12,
              // The body runs long in all three languages. Cap the card and let
              // the prose scroll, so the buttons below can never be pushed off
              // the screen at a large font scale — being unable to reach "stay
              // signed in" is the same failure as reading it second.
              maxHeight: '85%',
            }}
          >
            <ScrollView contentContainerStyle={{ gap: 10 }} bounces={false}>
              <Text variant="titleLarge" style={{ color: palette.ink, fontWeight: '700' }}>
                {pending.title}
              </Text>
              <Text variant="bodyMedium" style={{ color: palette.inkSoft, lineHeight: 21 }}>
                {pending.body}
              </Text>
            </ScrollView>

            {/* Stacked, safe-on-top, full width. Deliberately NOT a row: a row
                would collapse into a stack on its own once the labels stopped
                fitting, and it is the platform's version of that collapse that
                put the destructive action first in tl and ceb. */}
            <View style={{ gap: 4 }}>
              <Button
                mode="contained"
                onPress={() => answerConfirm(pending.id, false)}
                contentStyle={{ height: 52 }}
                labelStyle={{ fontSize: 16, fontWeight: '600' }}
                style={{ borderRadius: 26 }}
              >
                {pending.cancelLabel}
              </Button>
              <Button
                mode="text"
                onPress={() => answerConfirm(pending.id, true)}
                textColor={palette.red}
                contentStyle={{ height: 52 }}
                labelStyle={{ fontSize: 16, fontWeight: '600' }}
                style={{ borderRadius: 26 }}
              >
                {pending.confirmLabel}
              </Button>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </Modal>
  );
}
