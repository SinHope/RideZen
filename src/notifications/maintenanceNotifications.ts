// Maintenance notifications — the I/O around the pure planner (maintenancePlanner.ts).
//
// syncMaintenanceNotifications() is the ONE function that makes the phone's pending notifications match the data:
// it is called on app launch / resume, after a ride, after any write that can change a due level, from the daily
// background task, and from Settings. It is idempotent: it cancels what it scheduled before, re-plans, and
// sends / schedules afresh, remembering what was already announced in maintenance_notify_log.
//
// Safe to call from headless contexts (background GPS task, daily WorkManager task): it never throws, never
// touches React, and only CHECKS the notification permission — a permission prompt needs the UI and is shown
// elsewhere (maintenanceBootstrap.ts on first launch, and the Settings switch).
// It never touches the GPS idle reminder: only identifiers starting with "maint-" (or data.type maintenance*).

import * as Notifications from 'expo-notifications';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { notifyLogRepo } from '@/repositories/notifyLogRepo';
import { loadStatusThresholds } from '@/utils/reminderCheck';
import {
  getMaintenanceNotifEnabled,
  getNotifyTime,
  getNotifyGrouped,
} from '@/services/notificationPreferences';
import { planMaintenanceNotifications, isMaintenanceIdentifier } from '@/notifications/maintenancePlanner';
import type { PlannedNotification, PlannerEntry } from '@/notifications/maintenancePlanner';
import { registerMaintenanceSyncRequester } from '@/notifications/maintenanceSyncSignal';
import { logToFile } from '@/utils/logger';

export const MAINTENANCE_CHANNEL = 'maintenance';
export const MAINT_SYNC_DEBOUNCE_MS = 2000;

function logError(where: string, e: unknown): void {
  void logToFile('MAINT_NOTIF', where, String(e));
}

// ─── Cancelling ───────────────────────────────────────────────────────────────

/** Cancels our pending notifications. cancelAllScheduledNotificationsAsync() would also wipe the GPS idle reminder. */
export async function cancelMaintenanceNotifications(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of pending) {
      const type = (n.content?.data as { type?: string } | undefined)?.type;
      const ours = isMaintenanceIdentifier(n.identifier) || type === 'maintenance' || type === 'maintenance_summary';
      if (!ours) continue;
      try {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      } catch (e) {
        logError(`cancel ${n.identifier}`, e);
      }
    }
  } catch (e) {
    logError('cancelMaintenanceNotifications', e);
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Every maintenance item with its vehicle's odometer, or null if anything could not be read (then change nothing). */
async function loadEntries(): Promise<PlannerEntry[] | null> {
  const vehicles = await vehicleRepo.getAll();
  if (!vehicles.data) {
    logError('loadEntries.vehicles', vehicles.error);
    return null;
  }
  const entries: PlannerEntry[] = [];
  for (const v of vehicles.data) {
    const items = await maintenanceRepo.getByVehicle(v.id, v.current_odometer);
    if (!items.data) {
      logError(`loadEntries.items(vehicle ${v.id})`, items.error);
      return null;
    }
    for (const item of items.data) {
      entries.push({ item, vehicleId: v.id, vehicleNickname: v.nickname, odometer: v.current_odometer });
    }
  }
  return entries;
}

// ─── Delivering ───────────────────────────────────────────────────────────────

/** Send now (fireAt null) or hand to Android for later; log it only when the OS accepted it. */
async function deliver(n: PlannedNotification, fireAt: Date | null, nowIso: string): Promise<void> {
  const loggedAt = fireAt ? fireAt.toISOString() : nowIso;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: n.identifier,
      content: { title: n.payload.title, body: n.payload.body, data: n.payload.data },
      // channelId belongs on the TRIGGER in expo-notifications (not on content)
      trigger: fireAt
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: MAINTENANCE_CHANNEL }
        : { channelId: MAINTENANCE_CHANNEL },
    });
  } catch (e) {
    logError(`deliver ${n.identifier}`, e); // not logged → the next sync tries again
    return;
  }
  try {
    notifyLogRepo.upsert(n.items.map((i) => ({ item_id: i.itemId, level: i.level, fire_at: loggedAt })));
  } catch (e) {
    logError(`log ${n.identifier}`, e);
  }
}

// ─── One sync run ─────────────────────────────────────────────────────────────

async function runSync(): Promise<void> {
  try {
    if (!getMaintenanceNotifEnabled()) {
      await cancelMaintenanceNotifications();
      return;
    }

    // Only CHECK the permission — this may run headless, where a prompt cannot be shown.
    const permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted') {
      await cancelMaintenanceNotifications();
      return;
    }

    // Read everything BEFORE cancelling: if a read fails we leave the existing schedules untouched.
    const entries = await loadEntries();
    if (!entries) return;

    const now = new Date();
    const nowIso = now.toISOString();

    // Start from a clean slate: cancel our pending notifications and forget their schedule rows.
    await cancelMaintenanceNotifications();
    notifyLogRepo.deleteFuture(nowIso);

    const plan = planMaintenanceNotifications({
      entries,
      thresholds: loadStatusThresholds(),
      log: notifyLogRepo.getAll(),
      now,
      notifyTime: getNotifyTime(),
      grouped: getNotifyGrouped(),
    });

    if (plan.clearLog.length) notifyLogRepo.remove(plan.clearLog);
    if (plan.markSent.length) {
      notifyLogRepo.upsert(plan.markSent.map((r) => ({ item_id: r.itemId, level: r.level, fire_at: nowIso })));
    }

    for (const n of plan.notifyNow) await deliver(n, null, nowIso);
    for (const s of plan.schedule) await deliver(s, s.fireAt, nowIso);
  } catch (e) {
    logError('syncMaintenanceNotifications', e);
  }
}

// ─── Public entry points ──────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let rerunRequested = false;
let lastFinishedAt: number | null = null;

/**
 * Re-checks everything. Never throws. Only one run at a time: a call while one is running does not start a
 * second in parallel — it asks for one more run afterwards, so changes made meanwhile are picked up.
 */
export function syncMaintenanceNotifications(): Promise<void> {
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerunRequested = false;
        await runSync();
        lastFinishedAt = Date.now();
      } while (rerunRequested);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** For hot paths (the background GPS task): only syncs when the last sync finished more than `maxAgeMs` ago. */
export function syncIfStale(maxAgeMs: number): Promise<void> {
  if (running) return running;
  if (lastFinishedAt !== null && Date.now() - lastFinishedAt < maxAgeMs) return Promise.resolve();
  return syncMaintenanceNotifications();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: a burst of writes (e.g. saving a vehicle, then its items) collapses into one sync. */
export function requestMaintenanceSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncMaintenanceNotifications();
  }, MAINT_SYNC_DEBOUNCE_MS);
}

// Repositories call the dependency-free signal module (they can't import this file without a cycle).
registerMaintenanceSyncRequester(requestMaintenanceSync);
