import {
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
  useFonts,
} from '@expo-google-fonts/be-vietnam-pro';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/queries';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [fontsLoaded, fontError] = useFonts({
    BeVietnamPro_400Regular,
    BeVietnamPro_500Medium,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_700Bold,
  });
  const { session, loading } = useAuth();
  const profile = useProfile();

  const signedIn = !!session;
  // If the profile can't load (say, offline), don't trap people on the setup screen.
  const onboarded = !!profile.data?.onboarded_at || profile.isError;
  const ready = (fontsLoaded || !!fontError) && !loading && (!signedIn || !profile.isPending);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  // Where someone belongs right now; screens they can't use send them here.
  const home = !signedIn ? '/sign-in' : !onboarded ? '/onboarding' : '/';

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: Colors[scheme].background,
      card: Colors[scheme].surface,
      text: Colors[scheme].text,
      border: Colors[scheme].border,
      primary: Colors[scheme].primary,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn} redirectTo={home}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn && !onboarded} redirectTo={home}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>

        <Stack.Protected guard={signedIn && onboarded} redirectTo={home}>
          <Stack.Screen name="index" />
          <Stack.Screen name="trips/new" />
          <Stack.Screen name="trips/[id]/index" />
          <Stack.Screen name="trips/[id]/bill" />
          <Stack.Screen name="trips/[id]/settle" />
          <Stack.Screen name="profile" />
        </Stack.Protected>

        {/* Open to everyone: invite links work before signing in. */}
        <Stack.Screen name="join" />
        <Stack.Screen name="privacy" />
      </Stack>
    </ThemeProvider>
  );
}
