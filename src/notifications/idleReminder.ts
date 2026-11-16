// "Still tracking your ride?" reminder — a dead-man's switch.
//
// Every time the rider really moves we (re)schedule ONE local notification 60 s ahead
// under a fixed identifier. Re-scheduling replaces the pending one, so while the rider keeps
// moving it never fires. 60 s after they stop, the OS fires it — even if our JS is asleep.
// "Leave it" needs no logic: nothing re-arms until the rider moves again.
//
// All functions here are safe to call from the background GPS task: they never throw.

import * as Notifications from 'expo-notifications';
import { logToFile } from '@/utils/logger';

export const IDLE_REMINDER_ID = 'ridezen-gps-idle';
export const IDLE_REMINDER_CATEGORY = 'gps_idle';
export const IDLE_REMINDER_CHANNEL = 'ride_tracking';
export const IDLE_REMINDER_SECONDS = 60;
// Location updates arrive ~1/s at riding speed. Re-arming on every one would flood the OS,
// so skip if we armed less than this long ago. Effect: reminder fires 50–60 s after stopping.
export const IDLE_REARM_THROTTLE_MS = 10_000;

export const ACTION_TURN_OFF_GPS = 'TURN_OFF_GPS';
export const ACTION_LEAVE_IT = 'LEAVE_IT';

let lastArmedAt: number | null = null;

export async function setupIdleReminderCategory(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(IDLE_REMINDER_CATEGORY, [
      {
        identifier: ACTION_TURN_OFF_GPS,
        buttonTitle: 'Turn off GPS',
        // Handled in the background — the rider shouldn't be thrown into the app
        options: { opensAppToForeground: false },
      },
      {
        identifier: ACTION_LEAVE_IT,
        buttonTitle: 'Leave it',
        options: { opensAppToForeground: false },
      },
    ]);
  } catch (e) {
    logToFile('IDLE_REMINDER', 'setupIdleReminderCategory', String(e));
  }
}

export async function armIdleReminder(): Promise<void> {
  const now = Date.now();
  if (lastArmedAt !== null && now - lastArmedAt < IDLE_REARM_THROTTLE_MS) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: IDLE_REMINDER_ID, // same ID → replaces the previously scheduled reminder
      content: {
        title: 'Still tracking your ride?',
        body: "You haven't moved for a minute. Turn off GPS to save battery.",
        data: { type: 'gps_idle' },
        categoryIdentifier: IDLE_REMINDER_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: IDLE_REMINDER_SECONDS,
        repeats: false,
        // channelId belongs on the TRIGGER in expo-notifications (not on content)
        channelId: IDLE_REMINDER_CHANNEL,
      },
    });
    // Only start the throttle window after a successful schedule
    lastArmedAt = now;
  } catch (e) {
    logToFile('IDLE_REMINDER', 'armIdleReminder', String(e));
  }
}

export async function cancelIdleReminder(): Promise<void> {
  lastArmedAt = null; // next ride must be able to arm immediately

  try {
    await Notifications.cancelScheduledNotificationAsync(IDLE_REMINDER_ID);
  } catch (e) {
    logToFile('IDLE_REMINDER', 'cancelScheduled', String(e));
  }
  try {
    // Also remove it from the shade if it already fired
    await Notifications.dismissNotificationAsync(IDLE_REMINDER_ID);
  } catch (e) {
    logToFile('IDLE_REMINDER', 'dismiss', String(e));
  }
}
