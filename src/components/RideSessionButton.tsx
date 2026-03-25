// Start/End Ride CTA rendered at the bottom of each VehicleCard.
// Idle: near-solid white pill with cardColor text — high contrast on any card colour.
// Active: solid danger-red pill with spring entrance animation.

import React, { useEffect } from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { PlayIcon, StopSquareIcon } from '@/components/icons';

interface Props {
  isTracking: boolean;       // this vehicle specifically is being tracked
  isAnyRideActive: boolean;  // any vehicle is being tracked (disables Start on others)
  cardColor: string;
  onStartRide: () => void;
  onEndRide: () => void;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export function RideSessionButton({
  isTracking,
  isAnyRideActive,
  cardColor,
  onStartRide,
  onEndRide,
}: Props) {
  const scale = useSharedValue(isTracking ? 1 : 0.88);
  const opacity = useSharedValue(isTracking ? 1 : 0);

  useEffect(() => {
    if (isTracking) {
      opacity.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.ease) });
      scale.value = withSpring(1, { damping: 14, stiffness: 200 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(0.88, { duration: 180 });
    }
  }, [isTracking]);

  const endBtnStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  const isDisabled = isAnyRideActive && !isTracking;

  if (isTracking) {
    return (
      <AnimatedTouchable
        onPress={onEndRide}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            height: 44,
            borderRadius: 14,
            backgroundColor: '#E53E3E',
            marginTop: 12,
            shadowColor: '#E53E3E',
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: 0.45,
            shadowRadius: 6,
            elevation: 4,
          },
          endBtnStyle,
        ]}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="End ride and save distance"
      >
        <StopSquareIcon color="white" size={12} />
        <Text style={{ color: 'white', fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>
          End Ride
        </Text>
      </AnimatedTouchable>
    );
  }

  return (
    <View style={{ marginTop: 12 }}>
      <TouchableOpacity
        onPress={isDisabled ? undefined : onStartRide}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          height: 44,
          borderRadius: 14,
          backgroundColor: isDisabled ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.95)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDisabled ? 0 : 0.10,
          shadowRadius: 4,
          elevation: isDisabled ? 0 : 2,
        }}
        activeOpacity={isDisabled ? 1 : 0.82}
        accessibilityRole="button"
        accessibilityLabel="Start tracking this ride"
        disabled={isDisabled}
      >
        <PlayIcon color={isDisabled ? 'rgba(255,255,255,0.5)' : cardColor} size={11} />
        <Text
          style={{
            color: isDisabled ? 'rgba(255,255,255,0.5)' : cardColor,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 13,
          }}
        >
          Start Ride
        </Text>
      </TouchableOpacity>
    </View>
  );
}
