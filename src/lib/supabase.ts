import '@/lib/polyfills';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env');
}

const isWeb = Platform.OS === 'web';

export const supabase = createClient(url, key, {
  auth: {
    // The website keeps the session in the browser's localStorage (the default);
    // the phone app keeps it in the device's app storage.
    storage: isWeb ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On the web, Google sends people back with a one-time code in the URL.
    detectSessionInUrl: isWeb,
    flowType: 'pkce',
  },
});

// Phones: only refresh the sign-in while the app is open.
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
