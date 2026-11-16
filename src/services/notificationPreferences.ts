// Maintenance-notification settings, stored in the app_settings SQLite table (same table as trackingPreferences).
// Synchronous and never throwing: these are also read from background tasks, where a failed read must fall back
// to the defaults rather than crash the task.
//
//   maintenance_notifications_enabled  '1' | '0'   default ON
//   maintenance_notify_time            'HH:MM'     default '09:00' — when date-based reminders fire
//   maintenance_notify_grouped         '1' | '0'   default OFF — several at once → one summary
//   notif_permission_asked             'true'      the first-launch permission prompt was already shown

import { getDb } from '@/db/client';
import { DEFAULT_NOTIFY_TIME, isValidNotifyTime } from '@/utils/notifyTime';

const KEY_ENABLED = 'maintenance_notifications_enabled';
const KEY_TIME = 'maintenance_notify_time';
const KEY_GROUPED = 'maintenance_notify_grouped';
const KEY_PERMISSION_ASKED = 'notif_permission_asked';

function read(key: string): string | null {
  try {
    const row = getDb().getFirstSync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): boolean {
  try {
    getDb().runSync(
      'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
      [key, value, new Date().toISOString()]
    );
    return true;
  } catch {
    return false;
  }
}

// ─── Push notifications switch ────────────────────────────────────────────────

export function getMaintenanceNotifEnabled(): boolean {
  return read(KEY_ENABLED) !== '0';
}

export function setMaintenanceNotifEnabled(enabled: boolean): void {
  write(KEY_ENABLED, enabled ? '1' : '0');
}

// ─── Notification time ────────────────────────────────────────────────────────

export function getNotifyTime(): string {
  const saved = read(KEY_TIME);
  return isValidNotifyTime(saved) ? saved : DEFAULT_NOTIFY_TIME;
}

/** Returns false (and saves nothing) when `time` is not a valid "HH:MM" or could not be written. */
export function setNotifyTime(time: string): boolean {
  if (!isValidNotifyTime(time)) return false;
  return write(KEY_TIME, time);
}

// ─── Group into one summary ───────────────────────────────────────────────────

export function getNotifyGrouped(): boolean {
  return read(KEY_GROUPED) === '1';
}

export function setNotifyGrouped(grouped: boolean): void {
  write(KEY_GROUPED, grouped ? '1' : '0');
}

// ─── First-launch permission prompt ───────────────────────────────────────────

export function hasAskedNotificationPermission(): boolean {
  return read(KEY_PERMISSION_ASKED) === 'true';
}

export function markNotificationPermissionAsked(): void {
  write(KEY_PERMISSION_ASKED, 'true');
}
