// App-level ride session state for Manual Ride Session mode.
// Lives at the root (_layout.tsx) so the active session survives navigation
// between tabs — the GPS subscription is not tied to any single screen.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { Alert } from 'react-native';
import { haversineKm, addRideDistance } from '@/services/rideSession';
import { armIdleReminder, cancelIdleReminder } from '@/notifications/idleReminder';
import { onManualRideStopRequested } from '@/notifications/idleResponseHandler';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';

const MIN_DELTA_KM = 0.01; // 10 metres — same guard as background task

interface RideSessionState {
  isTracking: boolean;
  activeVehicleId: number | null;
  distanceKm: number;
  startRide: (vehicleId: number) => Promise<boolean>;
  endRide: () => Promise<void>;
}

const RideSessionContext = createContext<RideSessionState>({
  isTracking: false,
  activeVehicleId: null,
  distanceKm: 0,
  startRide: async () => false,
  endRide: async () => {},
});

export function RideSessionProvider({ children }: { children: React.ReactNode }) {
  const [isTracking, setIsTracking] = useState(false);
  const [activeVehicleId, setActiveVehicleId] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState(0);

  // Refs hold mutable values that don't need to trigger re-renders
  const lastCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const accumulatedKmRef = useRef(0);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const startRide = useCallback(async (vehicleId: number): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Location needed',
        'Please allow location access to track your ride distance.',
        [{ text: 'OK' }]
      );
      return false;
    }

    // Reset state for fresh session
    lastCoordsRef.current = null;
    accumulatedKmRef.current = 0;
    setDistanceKm(0);
    setActiveVehicleId(vehicleId);
    setIsTracking(true);

    subscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 10, // OS fires update only after 10m of movement
      },
      (location) => {
        const { latitude, longitude } = location.coords;
        if (lastCoordsRef.current) {
          const delta = haversineKm(
            lastCoordsRef.current.latitude,
            lastCoordsRef.current.longitude,
            latitude,
            longitude
          );
          // Secondary guard: ignore if delta is noise (< 10m)
          if (delta >= MIN_DELTA_KM) {
            accumulatedKmRef.current += delta;
            // Round to 1 decimal place for the live counter display
            setDistanceKm(Math.round(accumulatedKmRef.current * 10) / 10);
            // Real movement → push the "still tracking?" reminder back
            void armIdleReminder();
          }
        }
        lastCoordsRef.current = { latitude, longitude };
      }
    );

    // Arm right away so a rider who starts a session and never moves still gets reminded
    void armIdleReminder();

    return true;
  }, []);

  const endRide = useCallback(async (): Promise<void> => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;

    // Capture before resetting state
    const vehicleId = activeVehicleId;
    const km = accumulatedKmRef.current;

    void cancelIdleReminder();

    setIsTracking(false);
    setActiveVehicleId(null);
    setDistanceKm(0);
    accumulatedKmRef.current = 0;
    lastCoordsRef.current = null;

    if (vehicleId && km > 0) {
      addRideDistance(vehicleId, km);
      // The odometer just moved — a service may have crossed due / urgent / overdue
      requestMaintenanceSync();
    }
  }, [activeVehicleId]);

  // "Turn off GPS" on the idle-reminder notification (manual mode). The listener is registered
  // once, so it must call the LATEST endRide (which closes over the current activeVehicleId) —
  // hence the ref. Otherwise it would end a stale ride and lose the distance.
  const endRideRef = useRef(endRide);
  endRideRef.current = endRide;

  useEffect(() => {
    return onManualRideStopRequested(() => {
      if (!subscriptionRef.current) return; // no active ride
      void endRideRef.current();
    });
  }, []);

  // Clean up subscription if provider unmounts (should not happen in practice)
  useEffect(() => {
    return () => { subscriptionRef.current?.remove(); };
  }, []);

  return (
    <RideSessionContext.Provider value={{ isTracking, activeVehicleId, distanceKm, startRide, endRide }}>
      {children}
    </RideSessionContext.Provider>
  );
}

export function useRideSession() {
  return useContext(RideSessionContext);
}
