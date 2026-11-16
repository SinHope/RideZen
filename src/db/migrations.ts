import { SQLiteDatabase } from 'expo-sqlite';
import { logToFile } from '@/utils/logger';

const CURRENT_VERSION = 9;

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
    if (currentVersion < 6) {
      migrateV4(db);
    }
    if (currentVersion < 7) {
      migrateV7(db);
    }
    if (currentVersion < 8) {
      migrateV8(db);
    }
    if (currentVersion < 9) {
      migrateV9(db);
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

function migrateV4(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(fuel_logs)');
  const hasCurrency = cols.some(c => c.name === 'currency');
  if (!hasCurrency) {
    db.execSync(`ALTER TABLE fuel_logs ADD COLUMN currency TEXT DEFAULT 'SGD'`);
  }
}

// Adds price_home: the per-litre price converted to the user's home currency at
// log time, so monthly/lifetime cost totals never mix currencies. Existing logs
// recorded in the home currency are backfilled 1:1; foreign-currency logs stay
// NULL (their historical rate is unknown) and are excluded from cost totals.
function migrateV8(db: SQLiteDatabase): void {
  const cols = db.getAllSync<{ name: string }>('PRAGMA table_info(fuel_logs)');
  if (!cols.some(c => c.name === 'price_home')) {
    db.execSync(`ALTER TABLE fuel_logs ADD COLUMN price_home REAL`);
  }

  let home = 'SGD';
  try {
    const row = db.getFirstSync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'home_currency'`
    );
    if (row?.value) home = row.value;
  } catch {
    // app_settings may not exist yet on a fresh install — default stands
  }

  db.runSync(
    `UPDATE fuel_logs SET price_home = price_per_litre
     WHERE price_home IS NULL AND (currency IS NULL OR currency = ?)`,
    [home]
  );
}

// maintenance_notify_log remembers which level (due / urgent / overdue) of each service item the rider was already
// notified about, so a level is announced once and never repeated. fire_at is an ISO UTC string: in the past it was
// delivered, in the future it is a pending schedule. Rows go away with their item (ON DELETE CASCADE).
function migrateV9(db: SQLiteDatabase): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS maintenance_notify_log (
      item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
      level TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      PRIMARY KEY (item_id, level)
    );
  `);
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

// Backfills the v7 maintenance items onto pre-existing vehicles (new vehicles get
// these from seeds.ts at creation). Mirrors migrateV3: idempotent, scope-aware.
function migrateV7(db: SQLiteDatabase): void {
  const today = new Date().toISOString().split('T')[0];

  // 1. Rename items in place so existing vehicles match the new seed names.
  //    item_id is preserved, so maintenance_logs and reminder_settings stay linked.
  const renames: { from: string; to: string }[] = [
    { from: 'CVT Basic Service',   to: 'CVT Service' },
    { from: 'CVT Variator/Pulley', to: 'CVT Sliders & Guides' },
    { from: 'Chain Replacement',   to: 'Chain & Sprocket Set' },
  ];
  for (const r of renames) {
    db.runSync(
      `UPDATE maintenance_items SET category = ?, updated_at = ?
       WHERE category = ?
         AND NOT EXISTS (
           SELECT 1 FROM maintenance_items existing
           WHERE existing.vehicle_id = maintenance_items.vehicle_id
             AND existing.category = ?
         )`,
      [r.to, today, r.from, r.to]
    );
  }

  // 2. Bring CVT Rollers up to the revised 18,000 km default (was 12,000).
  db.runSync(
    `UPDATE maintenance_items SET interval_km = 18000, updated_at = ?
     WHERE category = 'CVT Rollers' AND interval_km = 12000`,
    [today]
  );

  // 3. Backfill brand-new items onto existing vehicles, respecting vehicle type.
  const vehicles = db.getAllSync<{ id: number; type: string; current_odometer: number }>(
    'SELECT id, type, current_odometer FROM vehicles'
  );

  type NewItem = {
    category: string; scope: string;
    interval_km: number | null; interval_days: number | null;
    early_km: number | null; early_days: number | null;
    final_km: number | null; final_days: number | null;
  };

  const universalItems: NewItem[] = [
    { category: 'Oil Filter',             scope: 'universal', interval_km: 10000, interval_days: 365, early_km: 1500, early_days: 30, final_km: 300, final_days: 7 },
    { category: 'Throttle Body Cleaning', scope: 'universal', interval_km: 12000, interval_days: 365, early_km: 1500, early_days: 30, final_km: 300, final_days: 7 },
    { category: 'Valve Clearance',        scope: 'universal', interval_km: 12000, interval_days: 365, early_km: 1500, early_days: 30, final_km: 300, final_days: 7 },
    { category: 'Engine Overhaul',        scope: 'universal', interval_km: null,  interval_days: null, early_km: null, early_days: null, final_km: null, final_days: null },
  ];
  const scooterItems: NewItem[] = [
    { category: 'CVT Clutch & Bell',      scope: 'scooter',   interval_km: 30000, interval_days: null, early_km: 3000, early_days: null, final_km: 500, final_days: null },
  ];
  const manualItems: NewItem[] = [
    { category: 'Clutch Plates',          scope: 'manual_bike', interval_km: 35000, interval_days: null, early_km: 3000, early_days: null, final_km: 500, final_days: null },
  ];

  for (const vehicle of vehicles) {
    const items = [...universalItems];
    if (vehicle.type === 'scooter') items.push(...scooterItems);
    else if (vehicle.type === 'manual_bike') items.push(...manualItems);

    for (const item of items) {
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [vehicle.id, item.category, item.scope, item.interval_km, item.interval_days, nextDueOdo, nextDueDate, today]
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
