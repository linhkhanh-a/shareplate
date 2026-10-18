import { useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { answerDialog, currentDialog, subscribeDialogs } from '@/lib/dialog';

/** Shows Shareplate's own "are you sure?" dialogs. Mounted once, in the root layout. */
export function AppDialogHost() {
  const theme = useTheme();
  const request = useSyncExternalStore(subscribeDialogs, currentDialog, currentDialog);
  if (!request) return null;
  const cancel = () => answerDialog(request.id, false);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={cancel}>
      <View style={styles.backdrop}>
        {/* Tapping outside the card is the same as Cancel. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={cancel} accessibilityLabel="Cancel" accessibilityRole="button" />
        <View
          role="alertdialog"
          aria-modal
          aria-labelledby="app-dialog-title"
          aria-describedby="app-dialog-message"
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="heading" nativeID="app-dialog-title" accessibilityRole="header">
            {request.title}
          </ThemedText>
          {request.message ? (
            <ThemedText themeColor="textSecondary" nativeID="app-dialog-message">
              {request.message}
            </ThemedText>
          ) : null}
          <View style={styles.buttons}>
            <Button label="Cancel" variant="secondary" onPress={cancel} style={styles.button} />
            <Button
              label={request.confirmLabel}
              onPress={() => answerDialog(request.id, true)}
              style={
                request.destructive
                  ? { ...styles.button, backgroundColor: theme.danger, borderColor: theme.danger }
                  : styles.button
              }
              textColor={request.destructive ? '#ffffff' : undefined}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 20, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.medium,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  buttons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  button: { flexGrow: 1, flexBasis: 0 },
});
