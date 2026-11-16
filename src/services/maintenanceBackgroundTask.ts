// Daily safety-net check for maintenance notifications, run by Android's WorkManager even when the app is
// closed (expo-background-task). It catches the cases the other layers can't: pre-scheduled alarms wiped by a
// phone restart or battery manager, or an app that hasn't been opened for days.
//
// This file MUST be imported at the top level of app/_layout.tsx — TaskManager.defineTask() has to run when the
// JS bundle loads, before the OS wakes the app headlessly (same rule as backgroundLocationTask.ts).
//
// Android treats the interval as a minimum and may delay or skip it (battery managers such as Vivo's are
// aggressive), which is why this is only a safety net behind the event-driven re-checks.

import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { logToFile } from '@/utils/logger';

export const MAINT_CHECK_TASK = 'RIDEZEN_MAINT_CHECK';
export const MAINT_CHECK_INTERVAL_MINUTES = 24 * 60;

TaskManager.defineTask(MAINT_CHECK_TASK, async ({ error }) => {
  if (error) {
    void logToFile('MAINT_CHECK', 'task_error', error.message);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
  try {
    await syncMaintenanceNotifications();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    void logToFile('MAINT_CHECK', 'task_failed', String(e));
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Idempotent. Registering again would restart the 24 h timer (WorkManager CANCEL_AND_REENQUEUE), so skip if registered. */
export async function registerMaintenanceCheck(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;
    if (await TaskManager.isTaskRegisteredAsync(MAINT_CHECK_TASK)) return;
    await BackgroundTask.registerTaskAsync(MAINT_CHECK_TASK, { minimumInterval: MAINT_CHECK_INTERVAL_MINUTES });
  } catch (e) {
    void logToFile('MAINT_CHECK', 'registerMaintenanceCheck', String(e));
  }
}
