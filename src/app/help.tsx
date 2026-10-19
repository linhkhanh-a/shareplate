import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { InstallApp } from '@/components/install-app';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Tour } from '@/components/tour';
import { Button, Screen, Section, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchHelp } from '@/lib/help';

/** Help: the tour, step-by-step guides for each feature, and common questions. */
export default function HelpScreen() {
  const { tour } = useLocalSearchParams<{ tour?: string }>();
  const [touring, setTouring] = useState(tour === '1');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { guides, faq } = searchHelp(query);
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key));

  return (
    <Screen>
      <TopBar />
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="title" accessibilityRole="header">
          Help
        </ThemedText>
        <ThemedText themeColor="textSecondary">How everything in Shareplate works, and answers to common questions.</ThemedText>
      </View>

      <Button label="Take the tour" onPress={() => setTouring(true)} />

      <TextField
        label="Search help"
        placeholder="Like “rounding”, “guest” or “zelle”"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={80}
      />

      {guides.length > 0 ? (
        <Section title="How to">
          <View style={styles.list}>
            {guides.map((g) => (
              <Fold key={g.id} title={g.title} open={open === `g-${g.id}` || !!query.trim()} onToggle={() => toggle(`g-${g.id}`)}>
                {g.steps.map((step, i) => (
                  <View key={i} style={styles.step}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.stepNumber}>
                      {`${i + 1}.`}
                    </ThemedText>
                    <ThemedText style={styles.grow}>{step}</ThemedText>
                  </View>
                ))}
              </Fold>
            ))}
          </View>
        </Section>
      ) : null}

      {faq.length > 0 ? (
        <Section title="Questions">
          <View style={styles.list}>
            {faq.map((f, i) => (
              <Fold key={f.q} title={f.q} open={open === `q-${i}` || !!query.trim()} onToggle={() => toggle(`q-${i}`)}>
                <ThemedText>{f.a}</ThemedText>
              </Fold>
            ))}
          </View>
        </Section>
      ) : null}

      {guides.length === 0 && faq.length === 0 ? (
        <ThemedText themeColor="textSecondary">Nothing matches “{query.trim()}”. Try another word.</ThemedText>
      ) : null}

      <Section title="Feedback">
        <ThemedText type="small" themeColor="textSecondary">
          An idea, something not working, or a question that isn&apos;t answered here? Every message is read.
        </ThemedText>
        <Button label="Send feedback" variant="secondary" onPress={() => router.push({ pathname: '/feedback', params: { from: '/help' } })} />
      </Section>

      <Section title="Install the app">
        <InstallApp />
      </Section>

      <View style={styles.links}>
        <Button variant="quiet" label="What’s new" onPress={() => router.push('/whats-new')} />
        <Button variant="quiet" label="Privacy" onPress={() => router.push('/privacy')} />
      </View>

      <Tour visible={touring} onClose={() => setTouring(false)} />
    </Screen>
  );
}

/** A title that opens to show more. */
function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.fold, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={onToggle}
        style={styles.foldHead}>
        <ThemedText type="strong" style={styles.grow}>
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary">{open ? '−' : '+'}</ThemedText>
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
  fold: { borderWidth: 1, borderRadius: Radius.medium, overflow: 'hidden' },
  foldHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, minHeight: 48 },
  foldBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  step: { flexDirection: 'row', gap: Spacing.two },
  stepNumber: { width: 20, paddingTop: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.two },
});
