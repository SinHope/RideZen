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
import { armIdleReminder } from '@/notifications/idleReminder';
import { syncIfStale } from '@/notifications/maintenanceNotifications';
import { logToFile } from '@/utils/logger';

export const BG_LOCATION_TASK = 'RIDEZEN_BG_LOCATION';

// Minimum delta before writing to DB — guards against GPS noise when stationary.
const MIN_DELTA_KM = 0.01; // 10 metres

// The odometer moves on every real fix, so a km-based service level (due / urgent / overdue) can be crossed
// mid-ride. Re-checking on every fix would be wasteful, so at most once per 5 minutes.
const MAINT_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;

TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
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
      // Real movement (past the 10 m noise guard) → push the "still tracking?" reminder back.
      // Deliberately NOT armed on the first fix / task start: auto mode starts on every app
      // launch, which would nag riders sitting at home. Awaited so a headless task finishes it.
      await armIdleReminder();
      // Awaited like the line above: a headless task must finish its work before it returns.
      try {
        await syncIfStale(MAINT_CHECK_MIN_INTERVAL_MS);
      } catch (e) {
        logToFile('BG_LOCATION', 'maintenance_check', String(e)); // never let it break distance tracking
      }
    }
  }

  // Always update last known coords so the next update has a reference point
  setBgLastCoords(latitude, longitude);
});
