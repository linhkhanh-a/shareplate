/**
 * Shareplate design tokens.
 *
 * Palette: Ha Long jade for primary actions, Hoi An lantern saffron as the one
 * accent, on a cool white (not cream). Type: Be Vietnam Pro, a typeface made by
 * Vietnamese designers, so names like "Hà Nội" or "Nguyễn" render properly.
 * Money always uses tabular figures so columns of amounts line up.
 */

import '@/global.css';

export const Colors = {
  light: {
    background: '#F7F9F8',
    surface: '#FFFFFF',
    surfaceMuted: '#E8EFEC',
    border: '#D3DEDA',
    text: '#17221E',
    textSecondary: '#55665F',
    primary: '#1F6F5C',
    primaryPressed: '#185A4A',
    onPrimary: '#FFFFFF',
    accent: '#F2B134',
    onAccent: '#2B1D00',
    danger: '#B4402B',
    focus: '#F2B134',
  },
  dark: {
    background: '#0F1714',
    surface: '#16221E',
    surfaceMuted: '#1E2D28',
    border: '#2A3B35',
    text: '#E7F0EC',
    textSecondary: '#9FB3AB',
    primary: '#4FB89A',
    primaryPressed: '#3E9E83',
    onPrimary: '#06201A',
    accent: '#F2B134',
    onAccent: '#2B1D00',
    danger: '#F08A74',
    focus: '#F2B134',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = {
  regular: 'BeVietnamPro_400Regular',
  medium: 'BeVietnamPro_500Medium',
  semibold: 'BeVietnamPro_600SemiBold',
  bold: 'BeVietnamPro_700Bold',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 14,
  pill: 999,
} as const;

export const MaxContentWidth = 560;
