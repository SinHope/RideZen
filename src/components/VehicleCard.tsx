import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { Vehicle, MaintenanceStatus } from '@/types';
import { formatOdometer, daysAgoLabel } from '@/utils/consumption';
import { RideSessionButton } from '@/components/RideSessionButton';

interface Props {
  vehicle: Vehicle;
  overdueCount?: number;
  dueCount?: number;
  avgConsumption?: number;
  lastRefuelDate?: string;
  onPress?: () => void;
  // Ride session
  trackingMode?: 'manual' | 'auto';
  isTracking?: boolean;
  isAnyRideActive?: boolean;
  rideDistanceKm?: number;
  onStartRide?: () => void;
  onEndRide?: () => void;
}

function getBadgeStatus(overdueCount: number, dueCount: number): MaintenanceStatus {
  if (overdueCount > 0) return 'overdue';
  if (dueCount > 0) return 'due';
  return 'ok';
}

function getBadgeLabel(overdueCount: number, dueCount: number): string {
  if (overdueCount > 0) return `${overdueCount} Overdue`;
  if (dueCount > 0) return `${dueCount} Due soon`;
  return 'All good';
}

const TYPE_COLOR: Record<string, string> = {
  scooter: '#1B6CA8',
  manual_bike: '#2D6A4F',
  car: '#C47A1E',
  other: '#5B6DAE',
};

// Live distance row — only rendered during an active session
function LiveDistanceRow({ distanceKm }: { distanceKm: number }) {
  const dotOpacity = useSharedValue(0.4);

  useEffect(() => {
    dotOpacity.value = withRepeat(
      withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => cancelAnimation(dotOpacity);
  }, []);

  const dotStyle = useAnimatedStyle(() => ({ opacity: dotOpacity.value }));

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }}>
      <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E' }, dotStyle]} />
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: '#22C55E', letterSpacing: 1.4, textTransform: 'uppercase' }}>
        Live
      </Text>
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 17, color: '#22C55E', marginLeft: 4 }}>
        +{distanceKm.toFixed(1)} km
      </Text>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
        this ride
      </Text>
    </View>
  );
}

export const VehicleCard = React.memo(function VehicleCard({
  vehicle,
  overdueCount = 0,
  dueCount = 0,
  avgConsumption,
  lastRefuelDate,
  onPress,
  trackingMode = 'manual',
  isTracking = false,
  isAnyRideActive = false,
  rideDistanceKm = 0,
  onStartRide,
  onEndRide,
}: Props) {
  const cardColor = TYPE_COLOR[vehicle.type] ?? '#1B6CA8';
  const badgeStatus = getBadgeStatus(overdueCount, dueCount);
  const badgeLabel = getBadgeLabel(overdueCount, dueCount);

  const typeLabel: Record<string, string> = {
    scooter: 'Scooter / CVT',
    manual_bike: 'Manual Motorcycle',
    car: 'Car',
    other: 'Vehicle',
  };

  // ── Glow animation ──────────────────────────────────────────────────────────
  // glowAnim: 0 = idle, pulses between 0.45 and 1.0 when tracking
  const glowAnim = useSharedValue(0);

  useEffect(() => {
    if (isTracking) {
      // Ease in to minimum, then start the pulse loop
      glowAnim.value = withTiming(0.45, { duration: 400, easing: Easing.out(Easing.ease) }, (finished) => {
        'worklet';
        if (finished) {
          glowAnim.value = withRepeat(
            withTiming(1.0, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
            -1,
            true // reverse: pulses 0.45 ↔ 1.0
          );
        }
      });
    } else {
      cancelAnimation(glowAnim);
      glowAnim.value = withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) });
    }
  }, [isTracking]);

  const glowStyle = useAnimatedStyle(() => ({
    shadowOpacity: isTracking ? 0.25 + glowAnim.value * 0.4 : 0.25,
    elevation: isTracking ? 6 + glowAnim.value * 8 : 6,
    borderColor: `rgba(34, 197, 94, ${glowAnim.value * 0.9})`,
  }));

  return (
    <Animated.View
      style={[
        {
          borderRadius: 24,
          marginBottom: 12,
          borderWidth: 2.5,
          shadowColor: isTracking ? '#22C55E' : cardColor,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: isTracking ? 18 : 12,
        },
        glowStyle,
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        style={{
          backgroundColor: cardColor,
          borderRadius: 22, // slightly smaller to sit inside border
          padding: 16,
          overflow: 'hidden',
        }}
        accessibilityRole="button"
        accessibilityLabel={`${vehicle.nickname} vehicle card`}
        activeOpacity={0.92}
      >
        {/* Decorative circles */}
        <View style={{ position: 'absolute', right: -12, bottom: -12, width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.10)' }} />
        <View style={{ position: 'absolute', right: 16, bottom: -24, width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.06)' }} />

        {/* Header row */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.70)', textTransform: 'uppercase', letterSpacing: 1.5, fontFamily: 'Inter_500Medium', marginBottom: 2 }}>
              {typeLabel[vehicle.type] ?? vehicle.type}
            </Text>
            <Text style={{ color: 'white', fontSize: 18, fontFamily: 'PlayfairDisplay_500Medium', lineHeight: 22 }} numberOfLines={1}>
              {vehicle.nickname}
            </Text>
          </View>

          {/* Status badge */}
          <View style={{
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
            borderWidth: 1,
            backgroundColor: badgeStatus === 'overdue' ? 'rgba(239,68,68,0.25)' : badgeStatus === 'due' ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.25)',
            borderColor: badgeStatus === 'overdue' ? 'rgba(252,165,165,0.4)' : badgeStatus === 'due' ? 'rgba(253,230,138,0.4)' : 'rgba(134,239,172,0.4)',
          }}>
            <Text style={{
              fontSize: 10, fontFamily: 'Inter_600SemiBold',
              color: badgeStatus === 'overdue' ? '#FCA5A5' : badgeStatus === 'due' ? '#FDE68A' : '#86EFAC',
            }}>
              {badgeLabel}
            </Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginBottom: 2 }}>Odometer</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: 'white' }}>{formatOdometer(vehicle.current_odometer)}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginBottom: 2 }}>Last refuel</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: 'white' }}>
              {lastRefuelDate ? daysAgoLabel(lastRefuelDate) : '—'}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', marginBottom: 2 }}>Avg L/100km</Text>
            <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: 'white' }}>
              {avgConsumption ? `${avgConsumption.toFixed(1)} L` : '—'}
            </Text>
          </View>
        </View>

        {/* Live distance counter — only during active session */}
        {isTracking && <LiveDistanceRow distanceKm={rideDistanceKm} />}

        {/* Start/End Ride button — only in manual mode */}
        {trackingMode === 'manual' && (
          <RideSessionButton
            isTracking={isTracking}
            isAnyRideActive={isAnyRideActive}
            cardColor={cardColor}
            onStartRide={onStartRide ?? (() => {})}
            onEndRide={onEndRide ?? (() => {})}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});
