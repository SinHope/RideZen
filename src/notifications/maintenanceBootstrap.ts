// App start-up and app-resume hooks for maintenance notifications (kept out of maintenanceNotifications.ts
// so that module stays free of UI-time concerns and import cycles).

import { AppState } from 'react-native';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import { registerMaintenanceCheck } from '@/services/maintenanceBackgroundTask';
import {
  getMaintenanceNotifEnabled,
  hasAskedNotificationPermission,
  markNotificationPermissionAsked,
} from '@/services/notificationPreferences';
import { logToFile } from '@/utils/logger';

/**
 * Call once from the root layout's init(), AFTER migrations and the Android channel setup (Android 13+ only shows
 * the permission prompt once a channel exists). Never throws.
 *   - first launch: ask for notification permission once (a later "Don't allow" is not nagged again; the
 *     Settings switch is where it can be turned on again)
 *   - register the daily background check
 *   - run the first sync, after the answer so it can send straight away
 */
export async function initMaintenanceNotifications(): Promise<void> {
  try {
    if (getMaintenanceNotifEnabled() && !hasAskedNotificationPermission()) {
      markNotificationPermissionAsked(); // mark first: if the prompt is interrupted we still don't ask twice
      await requestNotificationPermissions();
    }
  } catch (e) {
    void logToFile('MAINT_NOTIF', 'initMaintenanceNotifications.permission', String(e));
  }

  try {
    await registerMaintenanceCheck();
  } catch (e) {
    void logToFile('MAINT_NOTIF', 'initMaintenanceNotifications.register', String(e));
  }

  try {
    await syncMaintenanceNotifications();
  } catch (e) {
    void logToFile('MAINT_NOTIF', 'initMaintenanceNotifications.sync', String(e));
  }
}

/** Re-check whenever the app returns to the foreground (the odometer or the date may have moved on). */
export function attachMaintenanceAppStateSync(): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') requestMaintenanceSync();
  });
  return () => subscription.remove();
}
