import { getDb } from '@/db/client';
import { ReminderSettings, Result } from '@/types';
import { logToFile } from '@/utils/logger';

export const reminderRepo = {
  async getByItem(itemId: number): Promise<Result<ReminderSettings | null>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<ReminderSettings>(
        'SELECT * FROM reminder_settings WHERE item_id = ?',
        [itemId]
      );
      return { data: row ?? null, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'reminderRepo.getByItem', String(e));
      return { data: null, error: 'Could not load reminder settings.' };
    }
  },

  async update(itemId: number, settings: Partial<ReminderSettings>): Promise<Result<void>> {
    try {
      const db = getDb();
      const allowed = ['early_km_before', 'early_days_before', 'early_enabled', 'final_km_before', 'final_days_before', 'final_enabled'];
      const entries = Object.entries(settings).filter(([k]) => allowed.includes(k));
      if (!entries.length) return { data: undefined, error: null };

      const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => v);

      db.runSync(
        `UPDATE reminder_settings SET ${setClause} WHERE item_id = ?`,
        [...values, itemId]
      );
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'reminderRepo.update', String(e));
      return { data: null, error: 'Could not update reminder settings.' };
    }
  },

  async getAll(): Promise<Result<(ReminderSettings & { item_id: number; next_due_odo: number | null; next_due_date: string | null; category: string; vehicle_nickname: string })[]>> {
    try {
      const db = getDb();
      const rows = db.getAllSync<any>(
        `SELECT rs.*, mi.next_due_odo, mi.next_due_date, mi.category, v.nickname as vehicle_nickname
         FROM reminder_settings rs
         JOIN maintenance_items mi ON rs.item_id = mi.id
         JOIN vehicles v ON mi.vehicle_id = v.id`,
      );
      return { data: rows, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'reminderRepo.getAll', String(e));
      return { data: null, error: 'Could not load reminders.' };
    }
  },
};
