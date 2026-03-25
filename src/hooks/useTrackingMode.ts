// Manages tracking mode selection, permission flows, and launch-time recheck.
// Handles iOS two-step permission, Android hibernation, and silent revocation.

import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { BG_LOCATION_TASK } from '@/services/backgroundLocationTask';
import {
  getTrackingMode,
  setTrackingMode,
  getAutoTrackVehicleId,
  setAutoTrackVehicleId,
  clearBgLastCoords,
} from '@/services/trackingPreferences';
import { logToFile } from '@/utils/logger';

export type TrackingMode = 'manual' | 'auto';

export type SwitchToAutoOutcome =
  | 'granted'
  | 'foreground_denied'
  | 'foreground_never_ask'
  | 'background_only_while_using'
  | 'background_denied'
  | 'background_never_ask';

const BG_TASK_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 10,
  showsBackgroundLocationIndicator: true, // iOS blue top bar
  foregroundService: {
    notificationTitle: 'RideZen is tracking your ride',
    notificationBody: 'Your odometer updates automatically.',
    notificationColor: '#1B6CA8',
  },
};

async function startBgTask(): Promise<boolean> {
  try {
    const isRunning = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (!isRunning) {
      await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, BG_TASK_OPTIONS);
    }
    return true;
  } catch (e) {
    logToFile('TRACKING_MODE', 'startBgTask', String(e));
    return false;
  }
}

async function stopBgTask(): Promise<void> {
  try {
    const isRunning = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch (e) {
    logToFile('TRACKING_MODE', 'stopBgTask', String(e));
  }
}

export function useTrackingMode() {
  const [mode, setMode] = useState<TrackingMode>('manual');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMode(getTrackingMode());
    setLoading(false);
  }, []);

  // ─── Switch to Auto ──────────────────────────────────────────────────────────
  // Returns the outcome so callers can show the appropriate message.
  const switchToAuto = useCallback(async (vehicleId: number): Promise<SwitchToAutoOutcome> => {
    // Step 1: Foreground permission (required before background on both platforms)
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return fg.canAskAgain ? 'foreground_denied' : 'foreground_never_ask';
    }

    // Step 2: Background permission
    // iOS: this triggers the upgrade prompt from "While Using" → "Always"
    // Android: requests ACCESS_BACKGROUND_LOCATION separately
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      // On iOS, user granted "While Using" only (bg.status === 'denied' after fg was granted)
      // On Android, user tapped "Only while using app" or denied
      return bg.canAskAgain ? 'background_only_while_using' : 'background_never_ask';
    }

    // Both permissions granted — start background task and save mode
    setAutoTrackVehicleId(vehicleId);
    const started = await startBgTask();
    if (!started) {
      // Task failed to start — fall back to manual
      return 'background_denied';
    }

    setTrackingMode('auto');
    setMode('auto');
    return 'granted';
  }, []);

  // ─── Switch to Manual ────────────────────────────────────────────────────────
  const switchToManual = useCallback(async (): Promise<void> => {
    await stopBgTask();
    clearBgLastCoords();
    setTrackingMode('manual');
    setMode('manual');
  }, []);

  // ─── Launch recheck ──────────────────────────────────────────────────────────
  // Call this once on every app launch when saved mode is 'auto'.
  // Handles iOS silent revocation and Android hibernation task kill.
  const recheckOnLaunch = useCallback(async (): Promise<{
    changed: boolean;
    reason?: 'permission_revoked' | 'task_restarted';
  }> => {
    if (getTrackingMode() !== 'auto') return { changed: false };

    const bgPerm = await Location.getBackgroundPermissionsAsync();

    // iOS can silently revoke "Always Allow". Android 12+ hibernation resets permissions.
    if (bgPerm.status !== 'granted') {
      setTrackingMode('manual');
      setMode('manual');
      return { changed: true, reason: 'permission_revoked' };
    }

    // Permission is OK. Now check if the task is still registered.
    // Android battery-saver brands (Xiaomi, Samsung, OPPO, Vivo) can kill tasks
    // even when permission is technically still granted.
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (!isRegistered) {
      const vehicleId = getAutoTrackVehicleId();
      if (vehicleId) {
        const restarted = await startBgTask();
        if (restarted) {
          // Silently restarted — no banner needed
          return { changed: false, reason: 'task_restarted' };
        }
      }
      // Could not restart — fall back to manual with banner
      setTrackingMode('manual');
      setMode('manual');
      return { changed: true, reason: 'permission_revoked' };
    }

    // iOS-specific: on iOS 14+ the permission status alone doesn't confirm "Always".
    // Check the precise authorization level.
    if (Platform.OS === 'ios') {
      const precise = await Location.getBackgroundPermissionsAsync();
      if (precise.status !== 'granted') {
        setTrackingMode('manual');
        setMode('manual');
        return { changed: true, reason: 'permission_revoked' };
      }
    }

    return { changed: false };
  }, []);

  return { mode, loading, switchToAuto, switchToManual, recheckOnLaunch };
}
