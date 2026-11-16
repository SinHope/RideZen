import { getDb } from '@/db/client';
import { seedMaintenanceItems } from '@/db/seeds';
import { Vehicle, VehicleInput, Result } from '@/types';
import { logToFile } from '@/utils/logger';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';

export const vehicleRepo = {
  async getAll(): Promise<Result<Vehicle[]>> {
    try {
      const db = getDb();
      const rows = db.getAllSync<Vehicle>('SELECT * FROM vehicles ORDER BY created_at DESC');
      return { data: rows, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.getAll', String(e));
      return { data: null, error: 'Could not load your vehicles.' };
    }
  },

  async getById(id: number): Promise<Result<Vehicle | null>> {
    try {
      const db = getDb();
      const row = db.getFirstSync<Vehicle>('SELECT * FROM vehicles WHERE id = ?', [id]);
      return { data: row ?? null, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.getById', String(e));
      return { data: null, error: 'Could not load vehicle.' };
    }
  },

  async create(input: VehicleInput): Promise<Result<number>> {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const result = db.runSync(
        `INSERT INTO vehicles (nickname, type, make, model, year, plate_number, photo_uri, current_odometer, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.nickname, input.type, input.make ?? null, input.model ?? null,
         input.year ?? null, input.plate_number ?? null, input.photo_uri ?? null,
         input.current_odometer, now, now]
      );
      const vehicleId = result.lastInsertRowId;

      // Seed maintenance items for this vehicle type
      seedMaintenanceItems(db, vehicleId, input.type, input.current_odometer);

      requestMaintenanceSync();
      return { data: vehicleId, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.create', String(e));
      return { data: null, error: 'Could not save vehicle. Please try again.' };
    }
  },

  async update(id: number, input: Partial<VehicleInput>): Promise<Result<void>> {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const fields = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => `${k} = ?`)
        .join(', ');
      const values = Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([, v]) => v);

      if (!fields) return { data: undefined, error: null };

      db.runSync(
        `UPDATE vehicles SET ${fields}, updated_at = ? WHERE id = ?`,
        [...values, now, id]
      );
      requestMaintenanceSync();
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.update', String(e));
      return { data: null, error: 'Could not update vehicle.' };
    }
  },

  async updateOdometer(id: number, odometer: number): Promise<Result<void>> {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.runSync(
        'UPDATE vehicles SET current_odometer = ?, updated_at = ? WHERE id = ?',
        [odometer, now, id]
      );
      requestMaintenanceSync();
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.updateOdometer', String(e));
      return { data: null, error: 'Could not update odometer.' };
    }
  },

  async delete(id: number): Promise<Result<void>> {
    try {
      const db = getDb();
      db.runSync('DELETE FROM vehicles WHERE id = ?', [id]);
      requestMaintenanceSync();
      return { data: undefined, error: null };
    } catch (e) {
      logToFile('DB_ERROR', 'vehicleRepo.delete', String(e));
      return { data: null, error: 'Could not delete vehicle.' };
    }
  },
};
