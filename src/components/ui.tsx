import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ScrollLockContext = createContext<(locked: boolean) => void>(() => {});

/** Lets something on the page (like a drag handle) pause scrolling while it's in use. */
export function useScrollLock() {
  return useContext(ScrollLockContext);
}

/** A scrolling page with a centered, readable column. */
export function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const theme = useTheme();
  const [locked, setLocked] = useState(false);
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <ScrollLockContext.Provider value={setLocked}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" scrollEnabled={!locked}>
          <View style={styles.column}>{children}</View>
        </ScrollView>
      </ScrollLockContext.Provider>
      {footer ? <View style={[styles.column, styles.footer]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function Section({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      {title || action ? (
        <View style={styles.sectionHeader}>
          {title ? <ThemedText type="heading">{title}</ThemedText> : <View />}
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
  style?: ViewStyle;
  /** Overrides the label color, for buttons on colored backgrounds. */
  textColor?: string;
};

export function Button({ label, variant = 'primary', loading, disabled, style, textColor, ...rest }: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const palette = {
    primary: { bg: theme.primary, pressed: theme.primaryPressed, fg: theme.onPrimary, border: theme.primary },
    secondary: { bg: theme.surface, pressed: theme.surfaceMuted, fg: theme.text, border: theme.border },
    quiet: { bg: 'transparent', pressed: theme.surfaceMuted, fg: theme.primary, border: 'transparent' },
    danger: { bg: 'transparent', pressed: theme.surfaceMuted, fg: theme.danger, border: theme.border },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      aria-disabled={!!isDisabled}
      aria-busy={!!loading}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'quiet' && styles.buttonQuiet,
        {
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderColor: palette.border,
          opacity: isDisabled ? 0.55 : 1,
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={textColor ?? palette.fg} />
      ) : (
        <ThemedText type="strong" numberOfLines={1} style={{ color: textColor ?? palette.fg, textAlign: 'center' }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

type FieldProps = TextInputProps & { label: string; hint?: string; error?: string | null };

export function TextField({ label, hint, error, style, ...rest }: FieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="strong">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** A short message in the flow of the page: errors, confirmations, empty states. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const theme = useTheme();
  const accent = tone === 'error' ? theme.danger : tone === 'success' ? theme.primary : theme.border;
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: theme.surface, borderLeftColor: accent, borderColor: theme.border }]}>
      {typeof children === 'string' ? <ThemedText type="small">{children}</ThemedText> : children}
    </View>
  );
}

export function Pill({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'accent' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: tone === 'accent' ? theme.accent : theme.surfaceMuted },
      ]}>
      <ThemedText type="small" style={{ color: tone === 'accent' ? theme.onAccent : theme.textSecondary }}>
        {label}
      </ThemedText>
    </View>
  );
}

const AVATAR_TINTS = ['#1F6F5C', '#2F5D8A', '#8A4F2F', '#6B4F8A', '#3D7A3A', '#8A2F4F'];

/** Initials in a colored circle. The color is stable for the same name. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tint = AVATAR_TINTS[hash % AVATAR_TINTS.length];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint }]}>
      <ThemedText style={{ color: '#FFFFFF', fontFamily: Fonts.semibold, fontSize: size * 0.38, lineHeight: size * 0.5 }}>
        {initials}
      </ThemedText>
    </View>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessibilityLabel="Loading">
      <ActivityIndicator color={theme.primary} />
    </View>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center' },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
    alignSelf: 'center',
  },
  footer: { paddingTop: Spacing.two, paddingBottom: Spacing.three },
  section: { gap: Spacing.three },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: {
    minHeight: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonQuiet: { minHeight: 40, paddingHorizontal: Spacing.two },
  field: { gap: Spacing.two },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: Radius.small,
    paddingHorizontal: Spacing.three,
    fontFamily: Fonts.regular,
    fontSize: 16,
  },
  notice: {
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: Radius.small,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.pill,
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  loading: { padding: Spacing.five, alignItems: 'center' },
});

/** A small selectable option, used for "Paid by" and categories. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={({ pressed }) => [
        chipStyles.chip,
        {
          backgroundColor: selected ? theme.primary : pressed ? theme.surfaceMuted : theme.surface,
          borderColor: selected ? theme.primary : theme.border,
        },
      ]}>
      <ThemedText type="small" style={{ color: selected ? theme.onPrimary : theme.text, fontFamily: Fonts.medium }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={chipStyles.group}>
      <ThemedText type="strong">{label}</ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={chipStyles.wrap}>
        {children}
      </View>
    </View>
  );
}

/** Two to four options side by side, one selected. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[chipStyles.segmented, { backgroundColor: theme.surfaceMuted }]}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            onPress={() => onChange(o.value)}
            style={[chipStyles.segment, selected && { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ThemedText
              type="small"
              style={{ fontFamily: selected ? Fonts.semibold : Fonts.medium, color: selected ? theme.text : theme.textSecondary }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-label={label}
      style={[
        chipStyles.checkbox,
        { borderColor: checked ? theme.primary : theme.border, backgroundColor: checked ? theme.primary : theme.surface },
      ]}>
      {checked ? <ThemedText style={{ color: theme.onPrimary, fontFamily: Fonts.bold, lineHeight: 18 }}>✓</ThemedText> : null}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  group: { gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    minHeight: 36,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  segmented: { flexDirection: 'row', borderRadius: Radius.medium, padding: Spacing.one, gap: Spacing.one },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.small + 2,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
