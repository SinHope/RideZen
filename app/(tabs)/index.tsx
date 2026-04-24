// index.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Animated, TextInput } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVehicles } from '@/hooks/useVehicles';
import { useMaintenance } from '@/hooks/useMaintenance';
import { fuelRepo } from '@/repositories/fuelRepo';
import { VehicleCard } from '@/components/VehicleCard';
import { ConfirmModal } from '@/components/ConfirmModal';
import { TrackingOnboardingModal } from '@/components/TrackingOnboardingModal';
import { AutoTrackBanner } from '@/components/AutoTrackBanner';
import { PlusIcon, SearchIcon, ChevronRightIcon } from '@/components/icons';
import { Vehicle } from '@/types';
import { consumeMaintenancePromptPending, consumeTrackingOnboardingPending } from '@/utils/flags';
import { useRideSession } from '@/contexts/RideSessionContext';
import { useTrackingMode, SwitchToAutoOutcome } from '@/hooks/useTrackingMode';
import { getTrackingMode } from '@/services/trackingPreferences';
import { Alert } from 'react-native';

// Alert strip with pulse animation
function AlertStrip({ message, onPress }: { message: string; onPress: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-2.5 bg-zen-danger-bg border border-zen-danger/15 rounded-2xl px-3.5 py-2.5 mb-3"
      accessibilityRole="button"
      accessibilityLabel={message}
      activeOpacity={0.85}
    >
      <Animated.View style={{ opacity }} className="w-2 h-2 rounded-full bg-zen-danger" />
      <Text className="flex-1 text-sm font-inter-medium text-zen-danger">{message}</Text>
      <ChevronRightIcon color="#CC0000" size={16} />
    </TouchableOpacity>
  );
}

// Quick stat card
function QuickStatCard({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <View
      className="flex-1 bg-zen-surface rounded-2xl p-3.5 border border-zen-primary/[0.07]"
      style={{ shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }}
    >
      <Text className="text-xs text-zen-muted font-inter mb-1.5">{label}</Text>
      <Text className="text-xl font-inter-semibold text-zen-text leading-tight">
        {value}
        {unit ? <Text className="text-xs font-inter text-zen-muted"> {unit}</Text> : null}
      </Text>
      {sub ? <Text className="text-xs text-zen-muted font-inter mt-1">{sub}</Text> : null}
    </View>
  );
}

// Per-vehicle enriched data loader — extended with ride session props
interface WrapperProps {
  vehicle: Vehicle;
  trackingMode: 'manual' | 'auto';
  isTracking: boolean;
  isAnyRideActive: boolean;
  rideDistanceKm: number;
  onStartRide: () => void;
  onEndRide: () => void;
  onPress: () => void;
}

function VehicleCardWrapper({
  vehicle,
  trackingMode,
  isTracking,
  isAnyRideActive,
  rideDistanceKm,
  onStartRide,
  onEndRide,
  onPress,
}: WrapperProps) {
  const { overdueCount, dueCount } = useMaintenance(vehicle.id, vehicle.current_odometer);
  const [lastRefuelDate, setLastRefuelDate] = useState<string | undefined>();
  const [avgConsumption, setAvgConsumption] = useState<number | undefined>();

  useEffect(() => {
    fuelRepo.getLastRefuel(vehicle.id).then(r => {
      if (r.data) setLastRefuelDate(r.data.date);
    });
    fuelRepo.getMonthlyStats(vehicle.id).then(r => {
      if (r.data?.avg_consumption) setAvgConsumption(r.data.avg_consumption);
    });
  }, [vehicle.id]);

  return (
    <VehicleCard
      vehicle={vehicle}
      overdueCount={overdueCount}
      dueCount={dueCount}
      avgConsumption={avgConsumption}
      lastRefuelDate={lastRefuelDate}
      onPress={onPress}
      trackingMode={trackingMode}
      isTracking={isTracking}
      isAnyRideActive={isAnyRideActive}
      rideDistanceKm={rideDistanceKm}
      onStartRide={onStartRide}
      onEndRide={onEndRide}
    />
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { vehicles, loading, reload } = useVehicles();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [showMaintenancePrompt, setShowMaintenancePrompt] = useState(false);
  const [showTrackingOnboarding, setShowTrackingOnboarding] = useState(false);
  const pendingMaintenanceAfterOnboarding = useRef(false);
  const [trackingMode, setTrackingModeState] = useState<'manual' | 'auto'>('manual');
  const [banner, setBanner] = useState<{ message: string; showSettingsLink: boolean } | null>(null);

  // Ride session — app-level context, survives navigation
  const { isTracking, activeVehicleId, distanceKm, startRide, endRide } = useRideSession();
  const { recheckOnLaunch, switchToAuto } = useTrackingMode();

  useFocusEffect(useCallback(() => {
    reload();
    // Reload tracking mode from SQLite (may have changed in Settings)
    setTrackingModeState(getTrackingMode());
    const hasOnboarding = consumeTrackingOnboardingPending();
    if (hasOnboarding) {
      if (consumeMaintenancePromptPending()) {
        pendingMaintenanceAfterOnboarding.current = true;
      }
      setShowTrackingOnboarding(true);
    } else {
      setTimeout(() => {
        if (consumeMaintenancePromptPending()) {
          setShowMaintenancePrompt(true);
        }
      }, 1200);
    }
  }, []));

  // Launch recheck for auto-track mode — runs once on first focus
  const launchRecheckDone = useRef(false);
  useFocusEffect(useCallback(() => {
    if (launchRecheckDone.current) return;
    launchRecheckDone.current = true;
    recheckOnLaunch().then(result => {
      if (result.changed && result.reason === 'permission_revoked') {
        setBanner({
          message: 'Background location was turned off. Switched to Manual Ride Session.',
          showSettingsLink: false,
        });
        setTrackingModeState('manual');
      }
    }).catch(() => {});
  }, []));

  const handleStartRide = async (vehicleId: number) => {
    const ok = await startRide(vehicleId);
    if (!ok) return;
    Alert.alert('', "Tap 'End Ride' when you're done to save your distance.", [{ text: 'Got it' }]);
  };

  const handleEndRide = async () => {
    await endRide();
    Alert.alert('Ride saved!', 'Your odometer has been updated.', [{ text: 'OK' }]);
    reload(); // refresh odometer display
  };

  const handleBannerReEnable = async () => {
    const vehicleId = vehicles[0]?.id;
    if (!vehicleId) return;
    const outcome: SwitchToAutoOutcome = await switchToAuto(vehicleId);
    if (outcome === 'granted') {
      setBanner(null);
      setTrackingModeState('auto');
    } else if (outcome === 'foreground_never_ask' || outcome === 'background_never_ask') {
      setBanner({ message: 'Please enable "Always Allow" location in Settings.', showSettingsLink: true });
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const filteredVehicles = searchQuery.trim()
    ? vehicles.filter(v => v.nickname.toLowerCase().includes(searchQuery.toLowerCase()))
    : vehicles;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <View className="flex-1 bg-zen-bg">
      {/* Header */}
      <View
        className="bg-zen-primary px-5 pb-5"
        style={{
          paddingTop: insets.top + 8,
          shadowColor: '#1B6CA8',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <View className="flex-row justify-between items-center mb-0.5">
          <View className="flex-1">
            <Text className="text-xs text-white/75 font-inter">{greeting}, Nasmer</Text>
            <Text className="text-2xl text-white font-playfair-medium leading-tight">My Garage</Text>
          </View>
          <TouchableOpacity
            className="w-9 h-9 rounded-full bg-white/15 items-center justify-center"
            accessibilityRole="button"
            accessibilityLabel="Search"
            onPress={() => { setSearchVisible(v => !v); setSearchQuery(''); }}
          >
            <SearchIcon color="white" size={16} />
          </TouchableOpacity>
        </View>
        {searchVisible && (
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search vehicles..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoFocus
            style={{
              marginTop: 10,
              backgroundColor: 'rgba(255,255,255,0.15)',
              borderRadius: 12,
              paddingHorizontal: 14,
              paddingVertical: 8,
              color: 'white',
              fontFamily: 'Inter_400Regular',
              fontSize: 14,
            }}
          />
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1B6CA8" />}
      >
        {/* Auto-track revocation banner */}
        {banner && (
          <AutoTrackBanner
            message={banner.message}
            showSettingsLink={banner.showSettingsLink}
            onReEnable={handleBannerReEnable}
            onDismiss={() => setBanner(null)}
          />
        )}

        {/* Alert strip for overdue items */}
        {vehicles.length > 0 && (
          <AlertStrip
            message="1 item overdue — Engine Oil on Yamaha NVX"
            onPress={() => router.push('/(tabs)/maintenance')}
          />
        )}

        {/* Vehicles section */}
        <Text className="text-xs uppercase tracking-widest text-zen-muted font-inter-medium mb-2.5 mt-1">
          Your vehicles
        </Text>

        {loading ? (
          [1, 2].map(i => (
            <View key={i} className="h-28 rounded-3xl bg-gray-200 mb-3 animate-pulse" />
          ))
        ) : vehicles.length === 0 ? (
          <View className="items-center py-8">
            <Text className="text-zen-muted text-base font-inter text-center mb-4">
              Add your first vehicle to get started
            </Text>
            <TouchableOpacity
              className="bg-zen-primary px-6 py-3 rounded-2xl flex-row items-center gap-2"
              onPress={() => router.push('/vehicle/add')}
              accessibilityRole="button"
              accessibilityLabel="Add vehicle"
            >
              <PlusIcon color="white" size={16} />
              <Text className="text-white font-inter-medium">Add Vehicle</Text>
            </TouchableOpacity>
          </View>
        ) : filteredVehicles.length === 0 ? (
          <View className="items-center py-6">
            <Text className="text-zen-muted text-sm font-inter text-center">No vehicles match your search.</Text>
          </View>
        ) : (
          filteredVehicles.map(vehicle => (
            <VehicleCardWrapper
              key={vehicle.id}
              vehicle={vehicle}
              trackingMode={trackingMode}
              isTracking={isTracking && activeVehicleId === vehicle.id}
              isAnyRideActive={isTracking}
              rideDistanceKm={activeVehicleId === vehicle.id ? distanceKm : 0}
              onStartRide={() => handleStartRide(vehicle.id)}
              onEndRide={handleEndRide}
              onPress={() => router.push(`/vehicle/${vehicle.id}`)}
            />
          ))
        )}

        {/* Add vehicle button */}
        {vehicles.length > 0 && (
          <TouchableOpacity
            className="border-2 border-dashed border-zen-primary/30 rounded-3xl p-4 flex-row items-center gap-3 mb-4"
            onPress={() => router.push('/vehicle/add')}
            accessibilityRole="button"
            accessibilityLabel="Add another vehicle"
            activeOpacity={0.7}
          >
            <View className="w-9 h-9 rounded-full bg-zen-primary-pale items-center justify-center">
              <PlusIcon color="#1B6CA8" size={16} />
            </View>
            <Text className="text-zen-primary font-inter-medium text-sm">Add another vehicle</Text>
          </TouchableOpacity>
        )}

        {/* This month stats */}
        {vehicles.length > 0 && (
          <>
            <Text className="text-xs uppercase tracking-widest text-zen-muted font-inter-medium mb-2.5">
              This month
            </Text>
            <View className="flex-row gap-2.5">
              <QuickStatCard label="Fuel spent" value="SGD 68" sub="across all vehicles" />
              <QuickStatCard label="Avg consumption" value="3.6" unit="L/100km" sub="Yamaha NVX" />
            </View>
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={showMaintenancePrompt}
        title="Set up maintenance?"
        message="Would you like to review your maintenance schedule for this vehicle now?"
        confirmLabel="Let's go"
        confirmColor="#1B6CA8"
        cancelColor="#F4A035"
        onConfirm={() => { setShowMaintenancePrompt(false); router.push('/(tabs)/maintenance'); }}
        onCancel={() => setShowMaintenancePrompt(false)}
      />

      <TrackingOnboardingModal
        visible={showTrackingOnboarding}
        vehicleId={vehicles[0]?.id ?? 0}
        onComplete={() => {
          setShowTrackingOnboarding(false);
          setTrackingModeState(getTrackingMode());
          Alert.alert('', 'You can change your tracking mode anytime in Settings.', [{ text: 'Got it' }]);
          if (pendingMaintenanceAfterOnboarding.current) {
            pendingMaintenanceAfterOnboarding.current = false;
            setTimeout(() => setShowMaintenancePrompt(true), 600);
          }
        }}
      />
    </View>
  );
}
