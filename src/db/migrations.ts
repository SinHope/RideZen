import { SQLiteDatabase } from 'expo-sqlite';
import { logToFile } from '@/utils/logger';

const CURRENT_VERSION = 1;

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  try {
    const result = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = result?.user_version ?? 0;

    if (currentVersion < 1) {
      await migrateV1(db);
    }

    db.execSync(`PRAGMA user_version = ${CURRENT_VERSION}`);
  } catch (e) {
    logToFile('MIGRATION_ERROR', 'runMigrations', String(e));
    throw e;
  }
}

async function migrateV1(db: SQLiteDatabase): Promise<void> {
  db.execSync(`PRAGMA journal_mode = WAL`);
  db.execSync(`PRAGMA foreign_keys = ON`);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('scooter','manual_bike','car','other')),
      make TEXT,
      model TEXT,
      year INTEGER,
      plate_number TEXT,
      photo_uri TEXT,
      current_odometer REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS fuel_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      odometer REAL NOT NULL,
      litres REAL NOT NULL,
      price_per_litre REAL,
      is_full_tank INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      km_since_last REAL,
      consumption REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS maintenance_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      vehicle_type_scope TEXT NOT NULL,
      last_changed_date TEXT,
      last_changed_odo REAL,
      next_due_date TEXT,
      next_due_odo REAL,
      interval_km REAL,
      interval_days INTEGER,
      notes TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS maintenance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      odometer REAL,
      cost REAL,
      workshop TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.execSync(`
    CREATE TABLE IF NOT EXISTS reminder_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER REFERENCES maintenance_items(id) ON DELETE CASCADE,
      early_km_before REAL,
      early_days_before INTEGER,
      early_enabled INTEGER DEFAULT 1,
      final_km_before REAL,
      final_days_before INTEGER,
      final_enabled INTEGER DEFAULT 1
    );
  `);

  // Indexes for performance
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_logs(vehicle_id, date DESC)`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance_items(vehicle_id)`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_maint_logs_item ON maintenance_logs(item_id)`);
}
