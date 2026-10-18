import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Loading, TextField } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mapsUrl, type PickedPlace } from '@/lib/itinerary';
import { searchPlaces, type FoundPlace } from '@/lib/queries';

/**
 * Where an activity happens. Type a place and pick it from free OpenStreetMap
 * search to save its exact spot, or just keep what you typed.
 */
export function PlaceField({
  name,
  place,
  onChange,
  near,
}: {
  name: string;
  place: PickedPlace | null;
  onChange: (next: { name: string; place: PickedPlace | null }) => void;
  /** A spot to search around first, e.g. another place in the plan. */
  near: { lat: number; lng: number } | null;
}) {
  const theme = useTheme();
  // Searches run only while you're typing, not for a name that was picked or loaded.
  const [typing, setTyping] = useState(false);
  const [results, setResults] = useState<FoundPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const query = name.trim();
  // Plain numbers, so a new object each render doesn't restart the search.
  const nearLat = near?.lat ?? null;
  const nearLng = near?.lng ?? null;

  useEffect(() => {
    if (!typing || query.length < 3) return;
    let live = true;
    // Wait for a pause in typing, so each word doesn't send a search.
    const timer = setTimeout(() => {
      setSearching(true);
      setProblem(null);
      searchPlaces(query, nearLat !== null && nearLng !== null ? { lat: nearLat, lng: nearLng } : null)
        .then((found) => live && setResults(found))
        .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)))
        .finally(() => live && setSearching(false));
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [typing, query, nearLat, nearLng]);

  const showResults = typing && query.length >= 3;

  return (
    <View style={{ gap: Spacing.two }}>
      <TextField
        label="Where"
        placeholder="Đà Lạt night market"
        value={name}
        onChangeText={(text) => {
          setTyping(true);
          if (text.trim().length < 3) setResults(null);
          // Editing the name by hand means it's no longer the place that was picked.
          onChange({ name: text, place: null });
        }}
        maxLength={300}
        hint={place ? undefined : 'Type a place and pick it from the list for its exact spot, or just keep what you typed.'}
      />

      {showResults ? (
        <View style={[styles.results, { borderColor: theme.border, backgroundColor: theme.surface }]} accessibilityLabel="Places found">
          {searching ? <Loading /> : null}
          {problem ? (
            <ThemedText type="small" themeColor="textSecondary">
              {problem}
            </ThemedText>
          ) : null}
          {!searching && !problem && results?.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No places found. You can keep the name as typed.
            </ThemedText>
          ) : null}
          {(results ?? []).map((r) => (
            <Pressable
              key={`${r.name}-${r.lat}-${r.lng}`}
              accessibilityRole="button"
              accessibilityLabel={`${r.name}, ${r.address}`}
              onPress={() => {
                setTyping(false);
                setResults(null);
                onChange({ name: r.name, place: { address: r.address, lat: r.lat, lng: r.lng } });
              }}
              style={({ pressed }) => [styles.result, { backgroundColor: pressed ? theme.surfaceMuted : 'transparent' }]}>
              <ThemedText type="strong" numberOfLines={1}>
                {r.name}
              </ThemedText>
              {r.address ? (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {r.address}
                </ThemedText>
              ) : null}
            </Pressable>
          ))}
          <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
            Search by OpenStreetMap
          </ThemedText>
        </View>
      ) : null}

      {place ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`Exact spot saved${place.address ? `: ${place.address}` : ''}`}
        </ThemedText>
      ) : null}
      {name.trim() ? (
        <Button
          variant="secondary"
          label="Open in Maps"
          onPress={() => void Linking.openURL(mapsUrl(name, Platform.OS, place))}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  results: { borderWidth: 1, borderRadius: Radius.medium, padding: Spacing.two, gap: Spacing.one },
  result: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.two, borderRadius: Radius.small, gap: Spacing.half },
  credit: { textAlign: 'right' },
});
