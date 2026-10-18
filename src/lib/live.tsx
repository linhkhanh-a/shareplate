import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { editorsByBill, type PresenceInfo } from '@/lib/presence';
import { keys } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

interface TripLive {
  /** True while changes from other people are arriving live. */
  connected: boolean;
  /** Names of other people who have this bill or activity open right now. */
  editorsOf: (id: string) => string[];
  /** Tell others which bill or activity you have open (null when you close it). */
  setEditing: (id: string | null) => void;
}

const TripLiveContext = createContext<TripLive>({
  connected: false,
  editorsOf: () => [],
  setEditing: () => {},
});

export function useTripLive(): TripLive {
  return useContext(TripLiveContext);
}

/**
 * Keeps one trip up to date while any of its screens are open.
 *
 * - Data: listens for changes to the trip's row. The database bumps it on every
 *   new, edited or deleted bill, payment, person or plan activity, so the screens refetch.
 * - Presence: shares who is editing what.
 * Both channels are private: only trip members can join them.
 */
export function TripLiveProvider({
  tripId,
  me,
  children,
}: {
  tripId: string;
  me?: { memberId: string; name: string };
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [editors, setEditors] = useState<Map<string, string[]>>(new Map());
  const presenceChannel = useRef<RealtimeChannel | null>(null);
  const editing = useRef<string | null>(null);
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  // Live data.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      // Several changes often land together (a bill and its shares); refetch once.
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: keys.bills(tripId) });
        void qc.invalidateQueries({ queryKey: keys.payments(tripId) });
        void qc.invalidateQueries({ queryKey: keys.members(tripId) });
        void qc.invalidateQueries({ queryKey: keys.trip(tripId) });
        void qc.invalidateQueries({ queryKey: keys.itinerary(tripId) });
        void qc.invalidateQueries({ queryKey: keys.events(tripId) });
      }, 150);
    };

    let wasConnected = false;
    const channel = supabase
      .channel(`trip-data:${tripId}`, { config: { private: true } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'groups', filter: `id=eq.${tripId}` }, refresh)
      .subscribe((status) => {
        const ok = status === 'SUBSCRIBED';
        setConnected(ok);
        // After a dropped connection, catch up on anything missed.
        if (ok && wasConnected) refresh();
        if (ok) wasConnected = true;
      });

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc, tripId]);

  // Presence (who's editing). Joins once we know who you are in this trip.
  const memberId = me?.memberId;
  useEffect(() => {
    if (!memberId) return;
    const channel = supabase.channel(`trip:${tripId}`, {
      config: { private: true, presence: { key: memberId } },
    });
    presenceChannel.current = channel;
    const track = () =>
      channel.track({
        memberId,
        name: meRef.current?.name ?? 'Someone',
        editingBillId: editing.current,
      } satisfies PresenceInfo);

    channel
      .on('presence', { event: 'sync' }, () => {
        setEditors(editorsByBill(channel.presenceState() as Record<string, unknown[]>, memberId));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void track();
      });

    return () => {
      presenceChannel.current = null;
      void supabase.removeChannel(channel);
    };
  }, [tripId, memberId]);

  const setEditing = useCallback((billId: string | null) => {
    editing.current = billId;
    const channel = presenceChannel.current;
    const current = meRef.current;
    if (channel && current) {
      void channel.track({ memberId: current.memberId, name: current.name, editingBillId: billId } satisfies PresenceInfo);
    }
  }, []);

  const value = useMemo<TripLive>(
    () => ({ connected, editorsOf: (billId) => editors.get(billId) ?? [], setEditing }),
    [connected, editors, setEditing],
  );

  return <TripLiveContext.Provider value={value}>{children}</TripLiveContext.Provider>;
}
