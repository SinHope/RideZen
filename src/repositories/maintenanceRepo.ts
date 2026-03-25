import { getDb } from '@/db/client';
import { MaintenanceItem, MaintenanceLog, ServiceLogInput, Result, MaintenanceStatus } from '@/types';
import { computeMaintenanceStatus } from '@/utils/reminderCheck';
import { logToFile } from '@/utils/logger';

export const maintenanceRepo = {
  async getByVehicle(vehicleId: number, currentOdometer: number): Promise<Result<MaintenanceItem[]>> {
    try {
      const db = getDb();
      const rows = db.getAllSync<MaintenanceItem>(
        'SELECT * FROM maintenance_items WHERE vehicle_id = ? ORDER BY category ASC',
        [vehicleId]
      );

      // Compute status for each item
      const enriched = rows.map(item => computeMaintenanceStatus(item, currentOdometer));
      return { data: enriched, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'maintenanceRepo.getByVehicle', String(e));
      return { data: null, error: 'Could not load maintenance items.' };
    }
  },

  async getById(id: number): Promise<Result<MaintenanceItem | null>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<MaintenanceItem>('SELECT * FROM maintenance_items WHERE id = ?', [id]);
      return { data: row ?? null, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'maintenanceRepo.getById', String(e));
      return { data: null, error: 'Could not load item.' };
    }
  },

  async logService(input: ServiceLogInput): Promise<Result<void>> {
    try {
      const db = getDb();
      const today = input.date;
      const odometer = input.odometer;

      // Get current item
      const item = db.getFirstSync<MaintenanceItem>(
        'SELECT * FROM maintenance_items WHERE id = ?',
        [input.item_id]
      );
      if (!item) return { data: null, error: 'Maintenance item not found.' };

      const intervalKm = input.new_interval_km ?? item.interval_km;
      const intervalDays = input.new_interval_days ?? item.interval_days;

      // Calculate next due
      const nextDueOdo = odometer && intervalKm ? odometer + intervalKm : item.next_due_odo;
      const nextDueDate = intervalDays
        ? (() => {
            const d = new Date(today);
            d.setDate(d.getDate() + intervalDays);
            return d.toISOString().split('T')[0];
          })()
        : item.next_due_date;

      // Insert log
      db.runSync(
        `INSERT INTO maintenance_logs (item_id, vehicle_id, date, odometer, cost, workshop, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.item_id, input.vehicle_id, today, odometer ?? null,
         input.cost ?? null, input.workshop ?? null, input.notes ?? null,
         new Date().toISOString()]
      );

      // Update maintenance item
      db.runSync(
        `UPDATE maintenance_items SET
           last_changed_date = ?,
           last_changed_odo = ?,
           next_due_date = ?,
           next_due_odo = ?,
           interval_km = ?,
           interval_days = ?,
           notes = ?,
           updated_at = ?
         WHERE id = ?`,
        [today, odometer ?? null, nextDueDate, nextDueOdo,
         intervalKm ?? null, intervalDays ?? null,
         input.notes ?? item.notes, new Date().toISOString(),
         input.item_id]
      );

      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'maintenanceRepo.logService', String(e));
      return { data: null, error: 'Could not save service log. Please try again.' };
    }
  },

  async getHistory(itemId: number): Promise<Result<MaintenanceLog[]>> {
    try {
      const db = getDb();
      const rows = db.getAllSync<MaintenanceLog>(
        'SELECT * FROM maintenance_logs WHERE item_id = ? ORDER BY date DESC',
        [itemId]
      );
      return { data: rows, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'maintenanceRepo.getHistory', String(e));
      return { data: null, error: 'Could not load service history.' };
    }
  },

  async getOverdueCount(vehicleId: number, currentOdometer: number): Promise<number> {
    try {
      const result = await maintenanceRepo.getByVehicle(vehicleId, currentOdometer);
      if (!result.data) return 0;
      return result.data.filter(i => i.status === 'overdue').length;
    } catch {
      return 0;
    }
  },

  async updateItem(id: number, fields: Partial<MaintenanceItem>): Promise<Result<void>> {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const allowed = ['interval_km', 'interval_days', 'notes', 'next_due_odo', 'next_due_date'];
      const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
      if (!entries.length) return { data: undefined, error: null };

      const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => v);

      db.runSync(
        `UPDATE maintenance_items SET ${setClause}, updated_at = ? WHERE id = ?`,
        [...values, now, id]
      );
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'maintenanceRepo.updateItem', String(e));
      return { data: null, error: 'Could not update item.' };
    }
  },
};
