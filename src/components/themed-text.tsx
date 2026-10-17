import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'display' | 'title' | 'heading' | 'default' | 'strong' | 'small' | 'money';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  display: {
    fontFamily: Fonts.bold,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  heading: {
    fontFamily: Fonts.semibold,
    fontSize: 18,
    lineHeight: 24,
  },
  default: {
    fontFamily: Fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  strong: {
    fontFamily: Fonts.semibold,
    fontSize: 16,
    lineHeight: 24,
  },
  small: {
    fontFamily: Fonts.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  money: {
    fontFamily: Fonts.semibold,
    fontSize: 16,
    lineHeight: 24,
    fontVariant: ['tabular-nums'],
  },
});
