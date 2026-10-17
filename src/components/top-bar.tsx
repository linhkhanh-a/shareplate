import { router } from 'expo-router';
import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { Spacing } from '@/constants/theme';

/** Back button on the left, an optional action on the right. */
export function TopBar({ back = true, right }: { back?: boolean; right?: ReactNode }) {
  return (
    <View style={styles.bar}>
      {back ? (
        <Button
          variant="quiet"
          label="Back"
          accessibilityLabel="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      ) : (
        <View />
      )}
      {right ?? <View />}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: -Spacing.two,
    marginBottom: -Spacing.three,
  },
});
