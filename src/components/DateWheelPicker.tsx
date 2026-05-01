import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Layout constants ─────────────────────────────────────────────────────────

const ITEM_H    = 52;
const VISIBLE   = 5;                          // must be odd
const PICKER_H  = ITEM_H * VISIBLE;
const CENTER    = Math.floor(VISIBLE / 2);    // = 2  (0-indexed centre slot)
const PAD       = ITEM_H * CENTER;            // top/bottom padding so first/last items can be centred

// ─── Data helpers ─────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function daysInMonth(month1: number, year: number) {
  return new Date(year, month1, 0).getDate(); // month1 is 1-based
}

const THIS_YEAR = new Date().getFullYear();
const YEARS     = Array.from({ length: 16 }, (_, i) => THIS_YEAR - 5 + i);

// ─── WheelColumn ─────────────────────────────────────────────────────────────

interface ColProps {
  data: string[];
  selectedIndex: number;
  onChange: (i: number) => void;
  flex?: number;
}

const WheelColumn = React.memo(function WheelColumn({
  data, selectedIndex, onChange, flex = 1,
}: ColProps) {
  const ref       = useRef<ScrollView>(null);
  const committed = useRef(selectedIndex);

  // Scroll to initial position on mount
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
    }, 60);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Programmatically scroll when parent clamps the index (e.g. day 31 → 28)
  useEffect(() => {
    if (selectedIndex !== committed.current) {
      ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: true });
      committed.current = selectedIndex;
    }
  }, [selectedIndex]);

  // Shared handler for both onMomentumScrollEnd and onScrollEndDrag.
  // Using both covers the case where the user releases the finger with
  // little/no velocity on Android (momentum never fires there).
  const handleEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const i = Math.max(0, Math.min(Math.round(y / ITEM_H), data.length - 1));
      if (i !== committed.current) {
        committed.current = i;
        onChange(i);
      }
    },
    [data.length, onChange],
  );

  return (
    <View style={{ flex, height: PICKER_H }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.9}
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
        bounces={false}
        nestedScrollEnabled
      >
        {data.map((label, i) => {
          const dist = Math.abs(i - selectedIndex);
          return (
            <View key={`${label}-${i}`} style={styles.item}>
              <Text
                style={[
                  styles.itemText,
                  dist === 0 && styles.itemTextSelected,
                  {
                    opacity: dist === 0 ? 1 : dist === 1 ? 0.45 : 0.18,
                    fontSize: dist === 0 ? 20 : dist === 1 ? 17 : 15,
                  },
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
});

// ─── DateWheelPickerModal ─────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  value: string;            // 'YYYY-MM-DD'
  onConfirm: (date: string) => void;
  onClose: () => void;
}

export function DateWheelPickerModal({ visible, value, onConfirm, onClose }: Props) {
  const insets = useSafeAreaInsets();

  function parseValue(v: string) {
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  const [dayIdx,   setDayIdx]   = useState(() => parseValue(value).getDate() - 1);
  const [monthIdx, setMonthIdx] = useState(() => parseValue(value).getMonth());
  const [yearIdx,  setYearIdx]  = useState(() => {
    const y = parseValue(value).getFullYear();
    const i = YEARS.indexOf(y);
    return i !== -1 ? i : 5;
  });

  // Re-sync state whenever the modal opens
  useEffect(() => {
    if (!visible) return;
    const d = parseValue(value);
    setDayIdx(d.getDate() - 1);
    setMonthIdx(d.getMonth());
    const yi = YEARS.indexOf(d.getFullYear());
    setYearIdx(yi !== -1 ? yi : 5);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp day when month or year changes (e.g. Mar 31 → Feb 28)
  const maxDays  = daysInMonth(monthIdx + 1, YEARS[yearIdx]);
  const dayItems = Array.from({ length: maxDays }, (_, i) =>
    String(i + 1).padStart(2, '0'),
  );

  useEffect(() => {
    if (dayIdx >= maxDays) setDayIdx(maxDays - 1);
  }, [maxDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const clampedDayIdx = Math.min(dayIdx, maxDays - 1);

  const handleConfirm = () => {
    const yyyy = YEARS[yearIdx];
    const mm   = String(monthIdx + 1).padStart(2, '0');
    const dd   = String(clampedDayIdx + 1).padStart(2, '0');
    onConfirm(`${yyyy}-${mm}-${dd}`);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      {/* Dim backdrop — tapping it dismisses without confirming */}
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {/* Header row */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.cancelBtn}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Select Date</Text>
          <TouchableOpacity onPress={handleConfirm} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.doneBtn}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Wheels */}
        <View style={styles.wheelsOuter}>
          {/* Selection highlight strip — sits behind the wheels, non-interactive */}
          <View pointerEvents="none" style={styles.selectionStrip} />

          {/* Day */}
          <WheelColumn
            data={dayItems}
            selectedIndex={clampedDayIdx}
            onChange={setDayIdx}
            flex={1}
          />

          {/* Month */}
          <WheelColumn
            data={MONTH_LABELS}
            selectedIndex={monthIdx}
            onChange={setMonthIdx}
            flex={2.2}
          />

          {/* Year */}
          <WheelColumn
            data={YEARS.map(String)}
            selectedIndex={yearIdx}
            onChange={setYearIdx}
            flex={1.4}
          />

          {/* Top gradient mask — non-interactive */}
          <View pointerEvents="none" style={[styles.mask, styles.maskTop]}>
            <View style={[styles.maskLayer, { opacity: 0.96 }]} />
            <View style={[styles.maskLayer, { opacity: 0.72 }]} />
            <View style={[styles.maskLayer, { opacity: 0.40 }]} />
            <View style={[styles.maskLayer, { opacity: 0.16 }]} />
          </View>

          {/* Bottom gradient mask — non-interactive */}
          <View pointerEvents="none" style={[styles.mask, styles.maskBottom]}>
            <View style={[styles.maskLayer, { opacity: 0.16 }]} />
            <View style={[styles.maskLayer, { opacity: 0.40 }]} />
            <View style={[styles.maskLayer, { opacity: 0.72 }]} />
            <View style={[styles.maskLayer, { opacity: 0.96 }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const MASK_LAYER_H = ITEM_H * CENTER / 4; // divide the 2-item-height mask into 4 equal bands

const styles = StyleSheet.create({
  // ── Items
  item: {
    height: ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  itemText: {
    fontFamily: 'Inter_400Regular',
    color: '#4B5563',
    textAlign: 'center',
  },
  itemTextSelected: {
    fontFamily: 'Inter_600SemiBold',
    color: '#0D3B5E',
  },

  // ── Modal chrome
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontFamily: 'PlayfairDisplay_500Medium',
    fontSize: 17,
    color: '#0D3B5E',
  },
  cancelBtn: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#9CA3AF',
    paddingVertical: 8,
  },
  doneBtn: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: '#1B6CA8',
    paddingVertical: 8,
  },

  // ── Wheels
  wheelsOuter: {
    flexDirection: 'row',
    height: PICKER_H,
    overflow: 'hidden',
  },
  selectionStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_H * CENTER,
    height: ITEM_H,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(27,108,168,0.30)',
    backgroundColor: 'rgba(27,108,168,0.055)',
    zIndex: 1,
  },

  // ── Gradient masks (stacked semi-transparent white bands)
  mask: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ITEM_H * CENTER,   // covers the 2 non-selected rows at each edge
    zIndex: 2,
  },
  maskTop:    { top: 0 },
  maskBottom: { bottom: 0 },
  maskLayer: {
    flex: 1,
    backgroundColor: 'white',
  },
});
