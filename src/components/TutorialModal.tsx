import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setTutorialShown } from '@/services/trackingPreferences';

const { width: W } = Dimensions.get('window');

interface SlideData {
  id: string;
  emoji: string;
  accentColor: string;
  accentBg: string;
  title: string;
  body: string;
}

const SLIDES: SlideData[] = [
  {
    id: '1',
    emoji: '🏍️',
    accentColor: '#1B6CA8',
    accentBg: '#DBEAFE',
    title: 'Welcome to RideZen',
    body: 'Track fuel, maintenance, and riding distance — all stored privately on your phone.\n\nNo account. No cloud. Just you and your ride.',
  },
  {
    id: '2',
    emoji: '🏠',
    accentColor: '#1B6CA8',
    accentBg: '#EFF8FF',
    title: 'My Garage',
    body: 'See all your vehicles at a glance — odometer, maintenance status, and fuel stats right on your home screen.',
  },
  {
    id: '3',
    emoji: '📍',
    accentColor: '#2D6A4F',
    accentBg: '#DCFCE7',
    title: 'Odometer Tracking',
    body: 'Tap Start/End Ride for manual tracking, or enable Auto-track to let RideZen update your odometer in the background.\n\nChange anytime in Settings.',
  },
  {
    id: '4',
    emoji: '🔧',
    accentColor: '#B45309',
    accentBg: '#FEF3C7',
    title: 'Maintenance',
    body: 'RideZen seeds your maintenance schedule based on your vehicle type — engine oil, tyres, and more.\n\nStatus badges show when something is due soon or overdue.',
  },
  {
    id: '5',
    emoji: '⛽',
    accentColor: '#5B6DAE',
    accentBg: '#EEF2FF',
    title: 'Fuel Log',
    body: 'Log each refuel and RideZen automatically calculates your average L/100km and monthly fuel spend.',
  },
  {
    id: 'final',
    emoji: '🚀',
    accentColor: '#1B6CA8',
    accentBg: '#DBEAFE',
    title: "Let's add your\nfirst vehicle",
    body: "You're all set. Add your vehicle to get started — it only takes a minute.",
  },
];

interface Props {
  visible: boolean;
  onDone: () => void;
}

export function TutorialModal({ visible, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlashList<SlideData>>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const isFinal = currentIndex === SLIDES.length - 1;

  React.useEffect(() => {
    if (visible) {
      setCurrentIndex(0);
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: 0, animated: false });
      }, 50);
    }
  }, [visible]);

  const handleSkip = () => {
    setTutorialShown();
    onDone();
  };

  const handleNext = () => {
    const next = currentIndex + 1;
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setCurrentIndex(next);
  };

  const handleAddVehicle = () => {
    setTutorialShown();
    onDone();
    router.push('/vehicle/add');
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / W);
    if (index >= 0 && index < SLIDES.length) {
      setCurrentIndex(index);
    }
  };

  const renderItem = useCallback(({ item }: { item: SlideData }) => (
    <View
      style={{
        width: W,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 36,
      }}
    >
      <View
        style={{
          width: 112,
          height: 112,
          borderRadius: 32,
          backgroundColor: item.accentBg,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 36,
          shadowColor: item.accentColor,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 5,
        }}
      >
        <Text style={{ fontSize: 52 }}>{item.emoji}</Text>
      </View>

      <Text
        style={{
          fontFamily: 'PlayfairDisplay_600SemiBold',
          fontSize: 26,
          color: '#0D3B5E',
          textAlign: 'center',
          lineHeight: 34,
          marginBottom: 16,
        }}
      >
        {item.title}
      </Text>

      <Text
        style={{
          fontFamily: 'Inter_400Regular',
          fontSize: 14,
          color: '#6B7280',
          textAlign: 'center',
          lineHeight: 22,
        }}
      >
        {item.body}
      </Text>
    </View>
  ), []);

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#F0F8FF', paddingTop: insets.top }}>

        {/* ── Header ── */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 24,
            paddingVertical: 14,
          }}
        >
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 13,
              color: '#1B6CA8',
              letterSpacing: 0.5,
            }}
          >
            RideZen
          </Text>
          {!isFinal ? (
            <TouchableOpacity
              onPress={handleSkip}
              accessibilityRole="button"
              accessibilityLabel="Skip tutorial"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#9CA3AF' }}>
                Skip for now
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 70 }} />
          )}
        </View>

        {/* ── Slides (FlashList) ── */}
        <View style={{ flex: 1 }}>
          <FlashList
            ref={listRef}
            data={SLIDES}
            renderItem={renderItem}
            estimatedItemSize={W}
            horizontal
            pagingEnabled
            snapToInterval={W}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScroll}
            scrollEventThrottle={16}
            keyExtractor={item => item.id}
          />
        </View>

        {/* ── Footer ── */}
        <View style={{ paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 16) + 12 }}>

          {/* Dot indicators */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 24 }}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={{
                  height: 6,
                  width: i === currentIndex ? 22 : 6,
                  borderRadius: 3,
                  backgroundColor: i === currentIndex ? '#1B6CA8' : '#CBD5E1',
                }}
              />
            ))}
          </View>

          {isFinal ? (
            <>
              <TouchableOpacity
                onPress={handleAddVehicle}
                style={{
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: '#1B6CA8',
                  alignItems: 'center',
                  justifyContent: 'center',
                  shadowColor: '#1B6CA8',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 10,
                  elevation: 6,
                  marginBottom: 12,
                }}
                accessibilityRole="button"
                accessibilityLabel="Add your first vehicle"
              >
                <Text style={{ color: 'white', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
                  Add my first vehicle
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSkip}
                style={{ alignItems: 'center', paddingVertical: 8 }}
                accessibilityRole="button"
              >
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#9CA3AF' }}>
                  Maybe later
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              onPress={handleNext}
              style={{
                height: 52,
                borderRadius: 16,
                backgroundColor: '#1B6CA8',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#1B6CA8',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 10,
                elevation: 6,
              }}
              accessibilityRole="button"
              accessibilityLabel="Next"
            >
              <Text style={{ color: 'white', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
                Next
              </Text>
            </TouchableOpacity>
          )}
        </View>

      </View>
    </Modal>
  );
}
