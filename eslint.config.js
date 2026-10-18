// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge functions run on Deno and are checked with `deno check` instead.
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'supabase/functions/**'],
  },
]);
