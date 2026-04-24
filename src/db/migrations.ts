import { SQLiteDatabase } from 'expo-sqlite';
import { logToFile } from '@/utils/logger';

const CURRENT_VERSION = 3;

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  try {
    const result = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
    const currentVersion = result?.user_version ?? 0;

    if (currentVersion < 1) {
      await migrateV1(db);
    }
    if (currentVersion < 2) {
      migrateV2(db);
    }
    if (currentVersion < 3) {
      migrateV3(db);
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

function migrateV2(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function migrateV3(db: SQLiteDatabase): void {
  const today = new Date().toISOString().split('T')[0];
  const vehicles = db.getAllSync<{ id: number; current_odometer: number }>(
    'SELECT id, current_odometer FROM vehicles'
  );

  const newItems = [
    {
      category: 'Front Fork Servicing',
      interval_km: 24000,
      interval_days: 360,
      early_km: 3000, early_days: 30,
      final_km: 500,  final_days: 7,
    },
    {
      category: 'Vehicle Wash',
      interval_km: null,
      interval_days: null,
      early_km: null, early_days: null,
      final_km: null, final_days: null,
    },
  ];

  for (const vehicle of vehicles) {
    for (const item of newItems) {
      const exists = db.getFirstSync(
        'SELECT id FROM maintenance_items WHERE vehicle_id = ? AND category = ?',
        [vehicle.id, item.category]
      );
      if (exists) continue;

      const nextDueOdo = item.interval_km ? vehicle.current_odometer + item.interval_km : null;
      const nextDueDate = item.interval_days
        ? (() => {
            const d = new Date();
            d.setDate(d.getDate() + item.interval_days!);
            return d.toISOString().split('T')[0];
          })()
        : null;

      const result = db.runSync(
        `INSERT INTO maintenance_items
         (vehicle_id, category, vehicle_type_scope, interval_km, interval_days, next_due_odo, next_due_date, updated_at)
         VALUES (?, ?, 'universal', ?, ?, ?, ?, ?)`,
        [vehicle.id, item.category, item.interval_km, item.interval_days, nextDueOdo, nextDueDate, today]
      );

      db.runSync(
        `INSERT INTO reminder_settings
         (item_id, early_km_before, early_days_before, early_enabled, final_km_before, final_days_before, final_enabled)
         VALUES (?, ?, ?, 1, ?, ?, 1)`,
        [result.lastInsertRowId, item.early_km, item.early_days, item.final_km, item.final_days]
      );
    }
  }
}
