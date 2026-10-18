import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TopBar } from '@/components/top-bar';
import { Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';

const UPDATED = 'October 17, 2026';

export default function PrivacyScreen() {
  return (
    <Screen>
      <TopBar />
      <View style={styles.block}>
        <ThemedText type="title" accessibilityRole="header">
          Privacy
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Last updated {UPDATED}
        </ThemedText>
        <ThemedText>
          Shareplate is a personal project by Linh Bui for splitting trip expenses with friends. This page explains
          what it stores and why.
        </ThemedText>
      </View>

      <Block title="What Shareplate stores">
        <Bullet>Your name, email address and profile photo from your Google account, when you sign in.</Bullet>
        <Bullet>Your Zelle email or phone number, only if you choose to add it.</Bullet>
        <Bullet>
          The trips you create or join: trip names, the people in them, bills, receipt photos, payments you record,
          itinerary plans and budgets.
        </Bullet>
      </Block>

      <Block title="Who can see it">
        <ThemedText>
          Only people in the same trip. They see your name and, if you added it, your Zelle details, so they can pay
          you back. People outside your trips can&apos;t see anything about you.
        </ThemedText>
      </Block>

      <Block title="What Shareplate doesn't do">
        <Bullet>It never moves money. Payments happen in your own bank or Zelle app.</Bullet>
        <Bullet>It doesn&apos;t sell or share your information, or show ads.</Bullet>
        <Bullet>It only asks Google for your name, email and photo. It can&apos;t read your Gmail or Drive.</Bullet>
      </Block>

      <Block title="Where it's kept">
        <ThemedText>
          Data is stored with Supabase, the database service the app runs on, and the website is hosted by Vercel.
        </ThemedText>
      </Block>

      <Block title="Leaving or deleting your data">
        <ThemedText>
          You can leave a trip once your balance in it is settled. You can delete your account yourself from your
          profile (tap your picture, then Delete your account). That removes your profile, Zelle info and sign-in,
          and deletes trips only you can see. In trips you shared with others, your past bills and payments stay so
          their totals still add up, shown under your name as a former member. For anything else, email
          linhkhanhtr.22@gmail.com.
        </ThemedText>
      </Block>
    </Screen>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <ThemedText type="heading" accessibilityRole="header">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bullet}>
      <ThemedText>•</ThemedText>
      <ThemedText style={styles.bulletText}>{children}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  bullet: { flexDirection: 'row', gap: Spacing.two },
  bulletText: { flex: 1 },
});
