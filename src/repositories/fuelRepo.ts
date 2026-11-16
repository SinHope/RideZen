import { getDb } from '@/db/client';
import { FuelLog, FuelLogInput, Result } from '@/types';
import { toLocalDateString } from '@/utils/consumption';
import { logToFile } from '@/utils/logger';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';

type Db = ReturnType<typeof getDb>;

/**
 * Recompute km_since_last and consumption for every log of a vehicle,
 * walking the odometer chain in order. Called after any add/update/delete so
 * back-dated entries, edits, and deletions never leave neighbours stale.
 *
 * Consumption (L/100km) is calculated at each full-tank fill: all litres added
 * since the previous full-tank fill (partials included) divided by the km
 * driven between the two full fills.
 */
function recalcConsumptionChain(db: Db, vehicleId: number): void {
  const rows = db.getAllSync<Pick<FuelLog, 'id' | 'odometer' | 'litres' | 'is_full_tank' | 'km_since_last' | 'consumption'>>(
    `SELECT id, odometer, litres, is_full_tank, km_since_last, consumption
     FROM fuel_logs WHERE vehicle_id = ?
     ORDER BY odometer ASC, date ASC, id ASC`,
    [vehicleId]
  );

  let prevOdo: number | null = null;
  let lastFullOdo: number | null = null;
  let litresSinceFull = 0;

  for (const row of rows) {
    const kmSinceLast = prevOdo != null ? row.odometer - prevOdo : null;
    let consumption: number | null = null;

    if (row.is_full_tank === 1) {
      if (lastFullOdo != null) {
        const km = row.odometer - lastFullOdo;
        const litres = litresSinceFull + row.litres;
        if (km > 0) consumption = parseFloat(((litres / km) * 100).toFixed(2));
      }
      lastFullOdo = row.odometer;
      litresSinceFull = 0;
    } else {
      litresSinceFull += row.litres;
    }

    if (kmSinceLast !== (row.km_since_last ?? null) || consumption !== (row.consumption ?? null)) {
      db.runSync(
        'UPDATE fuel_logs SET km_since_last = ?, consumption = ? WHERE id = ?',
        [kmSinceLast, consumption, row.id]
      );
    }
    prevOdo = row.odometer;
  }
}

/** Raise the vehicle's odometer to its highest fuel-log reading if it lags behind. */
function syncVehicleOdometer(db: Db, vehicleId: number): void {
  db.runSync(
    `UPDATE vehicles
     SET current_odometer = (SELECT MAX(odometer) FROM fuel_logs WHERE vehicle_id = ?),
         updated_at = ?
     WHERE id = ?
       AND current_odometer < (SELECT COALESCE(MAX(odometer), 0) FROM fuel_logs WHERE vehicle_id = ?)`,
    [vehicleId, new Date().toISOString(), vehicleId, vehicleId]
  );
}

/** First day of the current month as YYYY-MM-DD in local time. */
function monthStartLocal(): string {
  const d = new Date();
  d.setDate(1);
  return toLocalDateString(d);
}

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

      const result = db.runSync(
        `INSERT INTO fuel_logs
         (vehicle_id, date, odometer, litres, price_per_litre, currency, price_home, is_full_tank, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.vehicle_id, input.date, input.odometer, input.litres,
         input.price_per_litre ?? null, input.currency ?? null, input.price_home ?? null,
         input.is_full_tank ? 1 : 0, input.notes ?? null,
         new Date().toISOString()]
      );

      recalcConsumptionChain(db, input.vehicle_id);
      syncVehicleOdometer(db, input.vehicle_id);

      requestMaintenanceSync(); // a refuel can raise the odometer
      return { data: result.lastInsertRowId, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.add', String(e));
      return { data: null, error: 'Could not save fuel log. Please try again.' };
    }
  },

  async getById(id: number): Promise<Result<FuelLog | null>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<FuelLog>('SELECT * FROM fuel_logs WHERE id = ?', [id]);
      return { data: row ?? null, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getById', String(e));
      return { data: null, error: 'Could not load fuel log.' };
    }
  },

  async update(id: number, input: FuelLogInput): Promise<Result<void>> {
    try {
      const db = getDb();

      db.runSync(
        `UPDATE fuel_logs SET date=?, odometer=?, litres=?, price_per_litre=?, currency=?, price_home=?, is_full_tank=?, notes=? WHERE id=?`,
        [input.date, input.odometer, input.litres, input.price_per_litre ?? null,
         input.currency ?? null, input.price_home ?? null, input.is_full_tank ? 1 : 0,
         input.notes ?? null, id]
      );

      recalcConsumptionChain(db, input.vehicle_id);
      syncVehicleOdometer(db, input.vehicle_id);

      requestMaintenanceSync();
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.update', String(e));
      return { data: null, error: 'Could not update fuel log.' };
    }
  },

  async delete(id: number): Promise<Result<void>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<{ vehicle_id: number }>(
        'SELECT vehicle_id FROM fuel_logs WHERE id = ?',
        [id]
      );
      db.runSync('DELETE FROM fuel_logs WHERE id = ?', [id]);
      if (row) recalcConsumptionChain(db, row.vehicle_id);
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.delete', String(e));
      return { data: null, error: 'Could not delete fuel log.' };
    }
  },

  async getMonthlyStats(vehicleId: number): Promise<Result<{ total_litres: number; total_cost: number; avg_consumption: number }>> {
    try {
      const db = getDb();
      // Cost totals use price_home so foreign-currency fills without a stored
      // conversion are excluded rather than summed as raw mixed-currency values.
      const row = db.getFirstSync<{ total_litres: number; total_cost: number; avg_consumption: number }>(
        `SELECT
           COALESCE(SUM(litres), 0) as total_litres,
           COALESCE(SUM(litres * COALESCE(price_home, 0)), 0) as total_cost,
           COALESCE(AVG(CASE WHEN consumption IS NOT NULL THEN consumption END), 0) as avg_consumption
         FROM fuel_logs
         WHERE vehicle_id = ? AND date >= ?`,
        [vehicleId, monthStartLocal()]
      );
      return { data: row ?? { total_litres: 0, total_cost: 0, avg_consumption: 0 }, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getMonthlyStats', String(e));
      return { data: null, error: 'Could not load stats.' };
    }
  },

  async getMonthlyGlobalStats(vehicleIds: number[]): Promise<{
    totalCost: number;
    avgConsumption: number | null;
    avgVehicleName: string | null;
  }> {
    if (vehicleIds.length === 0) return { totalCost: 0, avgConsumption: null, avgVehicleName: null };
    try {
      const db = getDb();
      const monthStr = monthStartLocal();
      const placeholders = vehicleIds.map(() => '?').join(', ');

      const costRow = db.getFirstSync<{ total_cost: number }>(
        `SELECT COALESCE(SUM(litres * COALESCE(price_home, 0)), 0) as total_cost
         FROM fuel_logs WHERE date >= ? AND vehicle_id IN (${placeholders})`,
        [monthStr, ...vehicleIds]
      );

      // Per-vehicle avg L/100km this month — pick first with data
      const perVehicle = db.getAllSync<{ nickname: string; avg_consumption: number }>(
        `SELECT v.nickname, AVG(fl.consumption) as avg_consumption
         FROM fuel_logs fl
         JOIN vehicles v ON v.id = fl.vehicle_id
         WHERE fl.date >= ? AND fl.consumption IS NOT NULL AND fl.vehicle_id IN (${placeholders})
         GROUP BY fl.vehicle_id
         ORDER BY avg_consumption ASC`,
        [monthStr, ...vehicleIds]
      );

      const best = perVehicle[0] ?? null;
      return {
        totalCost: costRow?.total_cost ?? 0,
        avgConsumption: best ? best.avg_consumption : null,
        avgVehicleName: best ? best.nickname : null,
      };
    } catch (e) {
      logToFile('DB_ERROR', 'fuelRepo.getMonthlyGlobalStats', String(e));
      return { totalCost: 0, avgConsumption: null, avgVehicleName: null };
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
