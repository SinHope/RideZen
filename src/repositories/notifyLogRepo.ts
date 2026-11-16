// maintenance_notify_log — "which level did we already tell the rider about, per service item?"
//   fire_at in the PAST   = delivered (sent now, or scheduled earlier and Android has fired it since)
//   fire_at in the FUTURE = scheduled with Android and still pending
// fire_at is an ISO-8601 UTC string, so plain string comparison orders it correctly.
//
// Synchronous and allowed to throw: the only caller is the sync routine in maintenanceNotifications.ts,
// which catches, logs and carries on (like trackingPreferences.ts, not the Result-returning async repos).

import { getDb } from '@/db/client';
import type { ItemRef, NotifyLogRow } from '@/notifications/maintenancePlanner';

export const notifyLogRepo = {
  getAll(): NotifyLogRow[] {
    return getDb().getAllSync<NotifyLogRow>(
      'SELECT item_id, level, fire_at FROM maintenance_notify_log'
    );
  },

  upsert(rows: NotifyLogRow[]): void {
    if (!rows.length) return;
    const db = getDb();
    for (const r of rows) {
      db.runSync(
        'INSERT OR REPLACE INTO maintenance_notify_log (item_id, level, fire_at) VALUES (?, ?, ?)',
        [r.item_id, r.level, r.fire_at]
      );
    }
  },

  remove(refs: ItemRef[]): void {
    if (!refs.length) return;
    const db = getDb();
    for (const r of refs) {
      db.runSync('DELETE FROM maintenance_notify_log WHERE item_id = ? AND level = ?', [r.itemId, r.level]);
    }
  },

  /** Drops rows that were only schedules (their notifications are cancelled just before a re-plan). */
  deleteFuture(nowIso: string): void {
    getDb().runSync('DELETE FROM maintenance_notify_log WHERE fire_at > ?', [nowIso]);
  },
};
