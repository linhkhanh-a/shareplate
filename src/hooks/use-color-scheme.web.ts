import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const noopSubscribe = () => () => {};

/**
 * The website is pre-rendered as static HTML, where the visitor's color scheme
 * is unknown. Render light on the server and switch to the real scheme once
 * the page is running in the browser.
 */
export function useColorScheme() {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();
  return isClient ? colorScheme : 'light';
}
