import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useScrollLock } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface Drag {
  from: number;
  to: number;
  height: number;
}

interface Props<T> {
  items: T[];
  keyOf: (item: T) => string;
  /** Read out by screen readers, e.g. "Move Night market". */
  labelOf: (item: T) => string;
  /** Draws one row. Put `handle` where the drag grip should go. */
  renderItem: (item: T, handle: ReactNode, dragging: boolean) => ReactNode;
  /** Called once when a drag ends somewhere new. */
  onMove: (from: number, to: number) => void;
  gap?: number;
}

/**
 * A vertical list people can reorder by dragging a grip. Built on React
 * Native's own touch system, so it works the same on iPhone, iPad and the web.
 * Screen reader users get "Move up" and "Move down" actions on each grip.
 */
export function DragList<T>({ items, keyOf, labelOf, renderItem, onMove, gap = Spacing.two }: Props<T>) {
  const lockScroll = useScrollLock();
  const heights = useRef(new Map<string, number>());
  const [dy] = useState(() => new Animated.Value(0));
  const drag = useRef<Drag | null>(null);
  // What's being dragged, for drawing. The dragged row's height is kept here
  // so the rows it passes can slide out of its way by exactly that much.
  const [active, setActive] = useState<Drag | null>(null);

  const heightAt = (i: number) => (heights.current.get(keyOf(items[i])) ?? 72) + gap;

  // Which slot the dragged row is over, moving past a neighbour once it's halfway.
  function slotFor(from: number, offset: number): number {
    let to = from;
    let rest = offset;
    if (offset > 0) {
      for (let i = from + 1; i < items.length && rest > heightAt(i) / 2; i++) {
        to = i;
        rest -= heightAt(i);
      }
    } else {
      for (let i = from - 1; i >= 0 && -rest > heightAt(i) / 2; i--) {
        to = i;
        rest += heightAt(i);
      }
    }
    return to;
  }

  const handlers = {
    start(index: number) {
      drag.current = { from: index, to: index, height: heightAt(index) };
      dy.setValue(0);
      setActive(drag.current);
      lockScroll(true);
    },
    move(offset: number) {
      const d = drag.current;
      if (!d) return;
      dy.setValue(offset);
      const to = slotFor(d.from, offset);
      if (to !== d.to) {
        drag.current = { ...d, to };
        setActive(drag.current);
      }
    },
    end() {
      const d = drag.current;
      drag.current = null;
      dy.setValue(0);
      setActive(null);
      lockScroll(false);
      if (d && d.from !== d.to) onMove(d.from, d.to);
    },
  };
  // The grips are created once; they call whatever the latest handlers are.
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });

  return (
    <View style={{ gap }}>
      {items.map((item, index) => {
        const key = keyOf(item);
        const dragging = active?.from === index;
        let shift = 0;
        if (active && !dragging) {
          if (active.to > active.from && index > active.from && index <= active.to) shift = -active.height;
          if (active.to < active.from && index < active.from && index >= active.to) shift = active.height;
        }
        const handle = (
          <Grip
            label={`Move ${labelOf(item)}`}
            index={index}
            count={items.length}
            latest={latest}
            onAccessibilityMove={(to) => onMove(index, to)}
          />
        );
        return (
          <Animated.View
            key={key}
            onLayout={(e) => heights.current.set(key, e.nativeEvent.layout.height)}
            style={[
              dragging ? [styles.dragging, { transform: [{ translateY: dy }] }] : { transform: [{ translateY: shift }] },
            ]}>
            {renderItem(item, handle, dragging)}
          </Animated.View>
        );
      })}
    </View>
  );
}

const webGrip = Platform.OS === 'web' ? ({ touchAction: 'none', cursor: 'grab', userSelect: 'none' } as unknown as ViewStyle) : null;

function Grip({
  label,
  index,
  count,
  latest,
  onAccessibilityMove,
}: {
  label: string;
  index: number;
  count: number;
  latest: RefObject<{ start: (i: number) => void; move: (dy: number) => void; end: () => void }>;
  onAccessibilityMove: (to: number) => void;
}) {
  const theme = useTheme();
  const indexRef = useRef(index);
  useLayoutEffect(() => {
    indexRef.current = index;
  }, [index]);
  // One responder for the grip's lifetime (it tracks the gesture), calling the
  // latest handlers through refs when touched, as React Native's docs show.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => latest.current?.start(indexRef.current),
      onPanResponderMove: (_e, g) => latest.current?.move(g.dy),
      onPanResponderRelease: () => latest.current?.end(),
      onPanResponderTerminate: () => latest.current?.end(),
    }),
  );

  const actions = [
    ...(index > 0 ? [{ name: 'moveUp', label: 'Move up' }] : []),
    ...(index < count - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []),
  ];

  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Drag up or down to change the order"
      accessibilityActions={actions}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'moveUp') onAccessibilityMove(index - 1);
        if (e.nativeEvent.actionName === 'moveDown') onAccessibilityMove(index + 1);
      }}
      style={[styles.grip, webGrip]}>
      <ThemedText style={[styles.gripIcon, { color: theme.textSecondary }]}>⋮⋮</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  dragging: {
    zIndex: 10,
    opacity: 0.95,
    borderRadius: Radius.medium,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  grip: { width: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  gripIcon: { fontSize: 18, letterSpacing: -4 },
});
