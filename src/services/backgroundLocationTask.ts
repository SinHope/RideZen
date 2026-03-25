// Background GPS task for auto-track mode.
// This file MUST be imported at the module top-level in app/_layout.tsx.
// The import itself registers the task — TaskManager.defineTask() runs immediately
// when the JS bundle loads, before any component renders.

import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import {
  getTrackingMode,
  getAutoTrackVehicleId,
  getBgLastCoords,
  setBgLastCoords,
} from '@/services/trackingPreferences';
import { haversineKm, addRideDistance } from '@/services/rideSession';
import { logToFile } from '@/utils/logger';

export const BG_LOCATION_TASK = 'RIDEZEN_BG_LOCATION';

// Minimum delta before writing to DB — guards against GPS noise when stationary.
const MIN_DELTA_KM = 0.01; // 10 metres

TaskManager.defineTask(BG_LOCATION_TASK, ({ data, error }) => {
  if (error) {
    logToFile('BG_LOCATION', 'task_error', error.message);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations?.length) return;

  // Double-check mode is still 'auto' — user may have switched while app was backgrounded
  if (getTrackingMode() !== 'auto') return;

  const vehicleId = getAutoTrackVehicleId();
  if (!vehicleId) return;

  const latest = locations[locations.length - 1];
  const { latitude, longitude } = latest.coords;

  const last = getBgLastCoords();
  if (last) {
    const km = haversineKm(last.lat, last.lon, latitude, longitude);
    if (km >= MIN_DELTA_KM) {
      addRideDistance(vehicleId, km);
    }
  }

  // Always update last known coords so the next update has a reference point
  setBgLastCoords(latitude, longitude);
});
