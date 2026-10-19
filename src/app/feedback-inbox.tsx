import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { timeAgo } from '@/lib/activity';
import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Button, Loading, Notice, Pill, Screen, Segmented } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { friendlyError } from '@/lib/errors';
import { useFeedbackInbox, useIsAppAdmin, useMarkFeedback, type FeedbackItem } from '@/lib/queries';

/** For the app's owners: everything people sent, newest first. */
export default function FeedbackInboxScreen() {
  const admin = useIsAppAdmin();
  const inbox = useFeedbackInbox(admin.data === true);
  const [show, setShow] = useState<'new' | 'all'>('new');

  if (admin.isPending) {
    return (
      <Screen>
        <TopBar />
        <Loading />
      </Screen>
    );
  }
  if (!admin.data) {
    return (
      <Screen>
        <TopBar />
        <Notice>Only Shareplate&apos;s owners can read feedback.</Notice>
      </Screen>
    );
  }

  const items = (inbox.data ?? []).filter((f) => show === 'all' || f.status === 'new');
  const newCount = (inbox.data ?? []).filter((f) => f.status === 'new').length;

  return (
    <Screen>
      <TopBar />
      <ThemedText type="title" accessibilityRole="header">
        Feedback
      </ThemedText>
      <Segmented
        label="Which feedback"
        options={[
          { value: 'new', label: `New (${newCount})` },
          { value: 'all', label: 'All' },
        ]}
        value={show}
        onChange={setShow}
      />
      {inbox.isPending ? <Loading /> : null}
      {inbox.isError ? <Notice tone="error">{friendlyError(inbox.error)}</Notice> : null}
      {inbox.data && items.length === 0 ? <ThemedText themeColor="textSecondary">Nothing here.</ThemedText> : null}
      <View style={{ gap: Spacing.two }}>
        {items.map((f) => (
          <FeedbackCard key={f.id} item={f} />
        ))}
      </View>
    </Screen>
  );
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  const theme = useTheme();
  const mark = useMarkFeedback();
  const label = { idea: 'Idea', problem: 'Problem', question: 'Question' }[item.kind];
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, opacity: item.status === 'done' ? 0.6 : 1 }]}>
      <View style={styles.head}>
        <Pill label={label} tone={item.kind === 'problem' ? 'accent' : 'muted'} />
        <ThemedText type="small" themeColor="textSecondary" style={styles.grow}>
          {timeAgo(item.created_at)}
        </ThemedText>
      </View>
      <ThemedText selectable>{item.message}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" selectable>
        {[item.contact_email ? `Reply to ${item.contact_email}` : 'No reply wanted', item.page, item.app_version && `version ${item.app_version}`]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
      <Button
        variant="secondary"
        label={item.status === 'new' ? 'Mark done' : 'Mark as new'}
        loading={mark.isPending}
        onPress={() => mark.mutate({ id: item.id, status: item.status === 'new' ? 'done' : 'new' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
});
