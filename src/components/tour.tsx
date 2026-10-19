import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TourArt } from '@/components/tour-art';
import { TOUR } from '@/lib/help';

/** The short tour of Shareplate: one card at a time, with Back, Next and Skip. */
export function Tour({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  if (!visible) return null;
  const slide = TOUR[index];
  const last = index === TOUR.length - 1;
  const close = () => {
    setIndex(0);
    onClose();
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.backdrop}>
        <View
          role="dialog"
          aria-modal
          aria-label="Shareplate tour"
          style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <TourArt art={slide.art} />
          <ThemedText type="small" themeColor="textSecondary">
            {`${index + 1} of ${TOUR.length}`}
          </ThemedText>
          <ThemedText type="heading" accessibilityRole="header" accessibilityLiveRegion="polite">
            {slide.title}
          </ThemedText>
          <ThemedText themeColor="textSecondary">{slide.body}</ThemedText>

          <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {TOUR.map((_, i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i === index ? theme.primary : theme.border }]} />
            ))}
          </View>

          <View style={styles.buttons}>
            {index > 0 ? (
              <Button label="Back" variant="secondary" onPress={() => setIndex(index - 1)} style={styles.button} />
            ) : (
              <Button label="Skip" variant="secondary" onPress={close} style={styles.button} />
            )}
            <Button
              label={last ? 'Get started' : 'Next'}
              onPress={() => (last ? close() : setIndex(index + 1))}
              style={styles.button}
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
    maxWidth: 440,
    minHeight: 480,
    borderRadius: Radius.medium,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  dots: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center', marginTop: 'auto' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  button: { flexGrow: 1, flexBasis: 0 },
});
