import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Checkbox, Notice, Screen, Segmented, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { APP_VERSION } from '@/lib/changelog';
import { friendlyError } from '@/lib/errors';
import { useIsAppAdmin, useSendFeedback, type FeedbackKind } from '@/lib/queries';

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'problem', label: 'Problem' },
  { value: 'question', label: 'Question' },
];

const PLACEHOLDER: Record<FeedbackKind, string> = {
  idea: 'What would make Shareplate better for your trips?',
  problem: 'What happened, and what did you expect instead?',
  question: 'What would you like to know?',
};

/** Send an idea, a problem or a question to the people who make Shareplate. */
export default function FeedbackScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const send = useSendFeedback();
  const admin = useIsAppAdmin();
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [message, setMessage] = useState('');
  const [contactOk, setContactOk] = useState(true);
  const [sent, setSent] = useState(false);
  const ready = message.trim().length >= 3;

  async function onSend() {
    try {
      await send.mutateAsync({ kind, message, contact_ok: contactOk, page: from ?? null, app_version: APP_VERSION });
      setSent(true);
      setMessage('');
    } catch {
      // Shown below.
    }
  }

  return (
    <Screen
      footer={
        sent ? undefined : (
          <View style={{ gap: Spacing.two }}>
            {send.isError ? <Notice tone="error">{friendlyError(send.error)}</Notice> : null}
            <Button label="Send feedback" onPress={onSend} disabled={!ready} loading={send.isPending} />
          </View>
        )
      }>
      <TopBar />
      <ThemedText type="title" accessibilityRole="header">
        Send feedback
      </ThemedText>

      {sent ? (
        <>
          <Notice tone="success">
            <ThemedText type="strong">Thank you!</ThemedText>
            <ThemedText type="small">Your feedback was sent.</ThemedText>
          </Notice>
          <Button variant="secondary" label="Send more" onPress={() => setSent(false)} />
          <Button variant="quiet" label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </>
      ) : (
        <>
          <Segmented label="What kind of feedback" options={KINDS} value={kind} onChange={setKind} />
          <TextField
            label="Your message"
            placeholder={PLACEHOLDER[kind]}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={4000}
            style={styles.message}
            hint={kind === 'problem' ? 'Which screen, and the steps to make it happen, help a lot.' : undefined}
          />
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: contactOk }}
            aria-checked={contactOk}
            onPress={() => setContactOk((v) => !v)}
            style={styles.check}>
            <Checkbox checked={contactOk} label="It's OK to email me about this" />
            <ThemedText style={styles.grow}>It&apos;s OK to email me about this</ThemedText>
          </Pressable>
        </>
      )}

      {admin.data ? <Button variant="quiet" label="Open the feedback inbox" onPress={() => router.push('/feedback-inbox')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Room between the box's edge and the text, like the one-line fields have side to side.
  message: { minHeight: 140, textAlignVertical: 'top', paddingTop: Spacing.three, paddingBottom: Spacing.three },
  check: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 44 },
  grow: { flex: 1, minWidth: 0 },
});
