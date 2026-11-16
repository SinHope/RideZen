// Handles taps on the idle reminder's buttons.
// MUST be imported at the top of app/_layout.tsx (like backgroundLocationTask): importing it
// registers the listener and the background task at bundle-load time.
//
// Two delivery paths, both routed to handleIdleReminderResponse():
//   1. addNotificationResponseReceivedListener — app process is alive.
//   2. A registered background task — Android, when the app is backgrounded/killed and the
//      button has opensAppToForeground:false (listeners do NOT fire in that case).
// Both can fire for one tap, so the handler dedupes.

import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getTrackingMode } from '@/services/trackingPreferences';
import { disableAutoTracking } from '@/services/autoTracking';
import { ACTION_TURN_OFF_GPS, ACTION_LEAVE_IT, IDLE_REMINDER_ID } from '@/notifications/idleReminder';
import { logToFile } from '@/utils/logger';

export const IDLE_RESPONSE_TASK = 'RIDEZEN_IDLE_RESPONSE';

// ─── Manual-ride stop requests ────────────────────────────────────────────────
// A manual ride lives in React state (RideSessionContext), so we can't stop it from here —
// the context subscribes and ends the ride itself (which also saves the distance).

const manualStopListeners = new Set<() => void>();

export function onManualRideStopRequested(listener: () => void): () => void {
  manualStopListeners.add(listener);
  return () => {
    manualStopListeners.delete(listener);
  };
}

// ─── Response handling ────────────────────────────────────────────────────────

let lastHandledKey: string | null = null;

export async function handleIdleReminderResponse(
  response: Notifications.NotificationResponse
): Promise<void> {
  try {
    const data = response.notification?.request?.content?.data as { type?: string } | undefined;
    if (data?.type !== 'gps_idle') return; // someone else's notification

    // Body tap (default action) just opens the app — nothing to do
    if (
      response.actionIdentifier !== ACTION_TURN_OFF_GPS &&
      response.actionIdentifier !== ACTION_LEAVE_IT
    ) {
      return;
    }

    // Dedupe BEFORE any await so the listener and the task can't both pass
    const key = `${response.actionIdentifier}:${response.notification.date}`;
    if (key === lastHandledKey) return;
    lastHandledKey = key;

    if (response.actionIdentifier === ACTION_TURN_OFF_GPS) {
      if (getTrackingMode() === 'auto') {
        await disableAutoTracking();
      } else {
        for (const listener of [...manualStopListeners]) listener();
      }
    }

    await Notifications.dismissNotificationAsync(IDLE_REMINDER_ID);
  } catch (e) {
    logToFile('IDLE_RESPONSE', 'handleIdleReminderResponse', String(e));
  }
}

// ─── Registration (runs on import) ────────────────────────────────────────────

Notifications.addNotificationResponseReceivedListener((response) => {
  void handleIdleReminderResponse(response);
});

TaskManager.defineTask(IDLE_RESPONSE_TASK, async ({ data, error }) => {
  if (error) {
    logToFile('IDLE_RESPONSE', 'task_error', error.message);
    return;
  }
  // For notification-response tasks the payload is the NotificationResponse itself
  if (data && typeof data === 'object' && 'actionIdentifier' in data) {
    await handleIdleReminderResponse(data as unknown as Notifications.NotificationResponse);
  }
});

Notifications.registerTaskAsync(IDLE_RESPONSE_TASK).catch((e: unknown) => {
  logToFile('IDLE_RESPONSE', 'registerTaskAsync', String(e));
});
