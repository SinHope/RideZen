import { getDb } from '@/db/client';
import { FuelLog, FuelLogInput, Result } from '@/types';
import { calcConsumption } from '@/utils/consumption';
import { logToFile } from '@/utils/logger';

export const fuelRepo = {
  async getByVehicle(vehicleId: number, limit = 50): Promise<Result<FuelLog[]>> {
    try {
      const db = getDb();
      const rows = db.getAllSync<FuelLog>(
        'SELECT * FROM fuel_logs WHERE vehicle_id = ? ORDER BY odometer DESC LIMIT ?',
        [vehicleId, limit]
      );
      return { data: rows, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getByVehicle', String(e));
      return { data: null, error: 'Could not load fuel logs.' };
    }
  },

  async add(input: FuelLogInput): Promise<Result<number>> {
    try {
      const db = getDb();

      // Get previous entry to calculate consumption
      const prev = db.getFirstSync<FuelLog>(
        'SELECT odometer, is_full_tank FROM fuel_logs WHERE vehicle_id = ? ORDER BY odometer DESC LIMIT 1',
        [input.vehicle_id]
      );

      const kmSinceLast = prev ? input.odometer - prev.odometer : null;
      const consumption = calcConsumption(
        input.litres,
        input.odometer,
        prev?.odometer ?? 0,
        (prev?.is_full_tank ?? 0) === 1,
        input.is_full_tank
      );

      const result = db.runSync(
        `INSERT INTO fuel_logs
         (vehicle_id, date, odometer, litres, price_per_litre, is_full_tank, notes, km_since_last, consumption, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.vehicle_id, input.date, input.odometer, input.litres,
         input.price_per_litre ?? null, input.is_full_tank ? 1 : 0,
         input.notes ?? null, kmSinceLast, consumption,
         new Date().toISOString()]
      );

      // Update vehicle odometer
      db.runSync(
        'UPDATE vehicles SET current_odometer = ?, updated_at = ? WHERE id = ? AND current_odometer < ?',
        [input.odometer, new Date().toISOString(), input.vehicle_id, input.odometer]
      );

      return { data: result.lastInsertRowId, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.add', String(e));
      return { data: null, error: 'Could not save fuel log. Please try again.' };
    }
  },

  async delete(id: number): Promise<Result<void>> {
    try {
      const db = getDb();
      db.runSync('DELETE FROM fuel_logs WHERE id = ?', [id]);
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.delete', String(e));
      return { data: null, error: 'Could not delete fuel log.' };
    }
  },

  async getMonthlyStats(vehicleId: number): Promise<Result<{ total_litres: number; total_cost: number; avg_consumption: number }>> {
    try {
      const db = getDb();
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      const monthStr = startOfMonth.toISOString().split('T')[0];

      const row = db.getFirstSync<{ total_litres: number; total_cost: number; avg_consumption: number }>(
        `SELECT
           COALESCE(SUM(litres), 0) as total_litres,
           COALESCE(SUM(litres * COALESCE(price_per_litre, 0)), 0) as total_cost,
           COALESCE(AVG(CASE WHEN consumption IS NOT NULL THEN consumption END), 0) as avg_consumption
         FROM fuel_logs
         WHERE vehicle_id = ? AND date >= ?`,
        [vehicleId, monthStr]
      );
      return { data: row ?? { total_litres: 0, total_cost: 0, avg_consumption: 0 }, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getMonthlyStats', String(e));
      return { data: null, error: 'Could not load stats.' };
    }
  },

  async getLastRefuel(vehicleId: number): Promise<Result<FuelLog | null>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<FuelLog>(
        'SELECT * FROM fuel_logs WHERE vehicle_id = ? ORDER BY odometer DESC LIMIT 1',
        [vehicleId]
      );
      return { data: row ?? null, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getLastRefuel', String(e));
      return { data: null, error: 'Could not load last refuel.' };
    }
  },
};
