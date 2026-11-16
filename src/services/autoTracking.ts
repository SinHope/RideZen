// Stops auto-track mode WITHOUT React — callable from the notification button handler,
// which may run when no screen is mounted.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { BG_LOCATION_TASK } from '@/services/backgroundLocationTask';
import { setTrackingMode, clearBgLastCoords } from '@/services/trackingPreferences';
import { cancelIdleReminder } from '@/notifications/idleReminder';
import { logToFile } from '@/utils/logger';

export async function stopBgTask(): Promise<void> {
  try {
    const isRunning = await TaskManager.isTaskRegisteredAsync(BG_LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch (e) {
    logToFile('AUTO_TRACKING', 'stopBgTask', String(e));
  }
}

// Safe to call twice, or when nothing is running.
export async function disableAutoTracking(): Promise<void> {
  await stopBgTask();
  // Always persist manual mode, even if stopping the task failed above —
  // the launch recheck will clean up a half-stopped task.
  try {
    clearBgLastCoords();
    setTrackingMode('manual');
  } catch (e) {
    logToFile('AUTO_TRACKING', 'disableAutoTracking', String(e));
  }
  await cancelIdleReminder();
}
