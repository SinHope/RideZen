/**
 * Database migrations V1–V9, run against a REAL SQLite engine (sql.js) — so the DDL, the data
 * backfills, the constraints and the cascades are actually executed, not string-matched.
 * (The V9-only string checks live in __tests__/maintNotif/migrationV9.test.ts.)
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { runMigrations } from '@/db/migrations';
import { seedMaintenanceItems } from '@/db/seeds';
import { logToFile } from '@/utils/logger';
import {
  TestDb,
  addItem,
  addVehicle,
  createEmptyDb,
  createMigratedDb,
  freezeClock,
  unfreezeClock,
} from '../helpers/testDb';

/** YYYY-MM-DD, `n` days after the frozen "today" (2026-11-17). */
const plusDays = (n: number) => new Date(Date.UTC(2026, 10, 17 + n)).toISOString().slice(0, 10);

let db: TestDb;
const extra: TestDb[] = [];

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  unfreezeClock();
  [db, ...extra].forEach((d) => {
    try {
      d?.close();
    } catch {
      /* already closed */
    }
  });
  extra.length = 0;
});

/** The very first schema (version 1), exactly as the first release created it. */
const LEGACY_V1 = `
  CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('scooter','manual_bike','car','other')),
    make TEXT, model TEXT, year INTEGER, plate_number TEXT, photo_uri TEXT,
    current_odometer REAL NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE fuel_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    date TEXT NOT NULL, odometer REAL NOT NULL, litres REAL NOT NULL, price_per_litre REAL,
    is_full_tank INTEGER NOT NULL DEFAULT 1, notes TEXT, km_since_last REAL, consumption REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE maintenance_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    category TEXT NOT NULL, vehicle_type_scope TEXT NOT NULL,
    last_changed_date TEXT, last_changed_odo REAL, next_due_date TEXT, next_due_odo REAL,
    interval_km REAL, interval_days INTEGER, notes TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    date TEXT NOT NULL, odometer REAL, cost REAL, workshop TEXT, notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE reminder_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER REFERENCES maintenance_items(id) ON DELETE CASCADE,
    early_km_before REAL, early_days_before INTEGER, early_enabled INTEGER DEFAULT 1,
    final_km_before REAL, final_days_before INTEGER, final_enabled INTEGER DEFAULT 1
  );
`;

// ─── Fresh install ────────────────────────────────────────────────────────────

describe('fresh install', () => {
  beforeEach(async () => {
    db = await createMigratedDb();
  });

  it('lands on the current schema version', () => {
    expect(db.version()).toBe(9);
  });

  it('creates every table the app uses', () => {
    expect(db.tables()).toEqual([
      'app_settings',
      'fuel_logs',
      'maintenance_items',
      'maintenance_logs',
      'maintenance_notify_log',
      'reminder_settings',
      'vehicles',
    ]);
  });

  it('adds the currency columns to fuel_logs (v4, v8)', () => {
    expect(db.columns('fuel_logs')).toEqual(
      expect.arrayContaining(['currency', 'price_home', 'km_since_last', 'consumption'])
    );
  });

  it('creates the lookup indexes', () => {
    const idx = db
      .getAllSync<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`)
      .map((i) => i.name);
    expect(idx).toEqual(['idx_fuel_vehicle', 'idx_maint_logs_item', 'idx_maint_vehicle']);
  });

  it('starts with no vehicles and no data', () => {
    expect(db.count('vehicles')).toBe(0);
    expect(db.count('maintenance_items')).toBe(0);
  });

  it('rejects a vehicle type the app does not know', () => {
    expect(() => db.runSync(`INSERT INTO vehicles (nickname, type) VALUES ('Boaty', 'boat')`)).toThrow();
  });

  it('defaults a new vehicle to 0 km and stamps its creation time', () => {
    db.runSync(`INSERT INTO vehicles (nickname, type) VALUES ('Bare', 'car')`);
    const bare = db.getFirstSync<any>(`SELECT * FROM vehicles WHERE nickname = 'Bare'`)!;
    expect(bare.current_odometer).toBe(0);
    expect(bare.created_at).toBeTruthy();
  });

  it('keeps foreign keys on for the migrating session: a child row needs its parent', () => {
    expect(() =>
      db.runSync(`INSERT INTO fuel_logs (vehicle_id, date, odometer, litres) VALUES (999, '2026-01-01', 1, 1)`)
    ).toThrow(/FOREIGN KEY/i);
  });

  it('deleting a vehicle removes everything that belongs to it', () => {
    const v = addVehicle(db);
    const i = addItem(db, v);
    db.runSync(`INSERT INTO fuel_logs (vehicle_id, date, odometer, litres) VALUES (?, '2026-11-01', 1000, 5)`, [v]);
    db.runSync(`INSERT INTO maintenance_logs (item_id, vehicle_id, date) VALUES (?, ?, '2026-11-01')`, [i, v]);
    db.runSync(`INSERT INTO reminder_settings (item_id) VALUES (?)`, [i]);
    db.runSync(`INSERT INTO maintenance_notify_log (item_id, level, fire_at) VALUES (?, 'due', '2026-11-01T00:00:00.000Z')`, [i]);

    db.runSync('DELETE FROM vehicles WHERE id = ?', [v]);

    for (const t of ['fuel_logs', 'maintenance_items', 'maintenance_logs', 'reminder_settings', 'maintenance_notify_log']) {
      expect({ table: t, rows: db.count(t) }).toEqual({ table: t, rows: 0 });
    }
  });

  it('the notify log allows one row per (item, level)', () => {
    const i = addItem(db, addVehicle(db));
    db.runSync(`INSERT INTO maintenance_notify_log (item_id, level, fire_at) VALUES (?, 'due', 'a')`, [i]);
    expect(() =>
      db.runSync(`INSERT INTO maintenance_notify_log (item_id, level, fire_at) VALUES (?, 'due', 'b')`, [i])
    ).toThrow();
    db.runSync(`INSERT INTO maintenance_notify_log (item_id, level, fire_at) VALUES (?, 'urgent', 'c')`, [i]);
    expect(db.count('maintenance_notify_log')).toBe(2);
  });
});

// ─── Re-running / failing ─────────────────────────────────────────────────────

describe('re-running', () => {
  it('is harmless on a fully migrated database that already has data (e.g. a crash mid-upgrade)', async () => {
    freezeClock(2026, 10, 17);
    db = await createMigratedDb();
    const v = addVehicle(db, { type: 'scooter', odo: 8000 });
    seedMaintenanceItems(db as any, v, 'scooter', 8000);
    const before = db.all('maintenance_items', 'id');
    const remindersBefore = db.count('reminder_settings');

    db.execSync('PRAGMA user_version = 0'); // pretend nothing was ever applied
    await runMigrations(db as any);

    expect(db.version()).toBe(9);
    expect(db.all('maintenance_items', 'id')).toEqual(before); // nothing duplicated or changed
    expect(db.count('reminder_settings')).toBe(remindersBefore);
  });

  it('on an up-to-date database only restamps the version', async () => {
    db = await createMigratedDb();
    const tablesBefore = db.tables();
    await runMigrations(db as any);
    expect(db.version()).toBe(9);
    expect(db.tables()).toEqual(tablesBefore);
  });
});

describe('when something goes wrong', () => {
  it('logs the failure and rethrows so the app can show its error screen', async () => {
    const broken = {
      getFirstSync: () => {
        throw new Error('disk full');
      },
    };
    await expect(runMigrations(broken as any)).rejects.toThrow('disk full');
    expect(logToFile).toHaveBeenCalledWith('MIGRATION_ERROR', 'runMigrations', expect.stringContaining('disk full'));
  });
});

// ─── Upgrading old databases ──────────────────────────────────────────────────

describe('upgrading a version-1 database (oldest release)', () => {
  beforeEach(async () => {
    freezeClock(2026, 10, 17);
    db = await createEmptyDb();
    db.execSync(LEGACY_V1);
    db.execSync('PRAGMA user_version = 1');
    db.runSync(`INSERT INTO vehicles (id, nickname, type, current_odometer) VALUES (1, 'Aerox', 'scooter', 20000)`);
    db.runSync(
      `INSERT INTO maintenance_items (vehicle_id, category, vehicle_type_scope, interval_km, next_due_odo)
       VALUES (1, 'Engine Oil', 'universal', 5000, 25000)`
    );
    db.runSync(
      `INSERT INTO fuel_logs (vehicle_id, date, odometer, litres, price_per_litre) VALUES (1, '2026-10-01', 19900, 5, 2.5)`
    );
    await runMigrations(db as any);
  });

  it('ends on the same tables and columns as a fresh install', async () => {
    const fresh = await createMigratedDb();
    extra.push(fresh);
    expect(db.version()).toBe(9);
    expect(db.tables()).toEqual(fresh.tables());
    for (const t of fresh.tables()) {
      expect({ table: t, columns: db.columns(t) }).toEqual({ table: t, columns: fresh.columns(t) });
    }
  });

  it('keeps what the rider already had', () => {
    const oil = db.getFirstSync<any>(`SELECT * FROM maintenance_items WHERE category = 'Engine Oil'`)!;
    expect(oil.next_due_odo).toBe(25000);
    expect(db.getFirstSync<any>('SELECT * FROM vehicles WHERE id = 1')!.nickname).toBe('Aerox');
    expect(db.count('fuel_logs')).toBe(1);
  });

  it('v4: old fuel logs are tagged SGD and v8 backfills their home-currency price', () => {
    const log = db.getFirstSync<any>('SELECT * FROM fuel_logs')!;
    expect(log.currency).toBe('SGD');
    expect(log.price_home).toBe(2.5);
  });

  it('v2: creates the settings table', () => {
    expect(db.tables()).toContain('app_settings');
  });

  it('v3: adds Front Fork Servicing and Vehicle Wash with their due dates and reminder rows', () => {
    const fork = db.getFirstSync<any>(`SELECT * FROM maintenance_items WHERE category = 'Front Fork Servicing'`)!;
    expect(fork.next_due_odo).toBe(44000); // 20,000 + 24,000
    expect(fork.next_due_date).toBe(plusDays(360));
    expect(fork.vehicle_type_scope).toBe('universal');
    const forkReminder = db.getFirstSync<any>('SELECT * FROM reminder_settings WHERE item_id = ?', [fork.id])!;
    expect(forkReminder).toMatchObject({
      early_km_before: 3000,
      early_days_before: 30,
      final_km_before: 500,
      final_days_before: 7,
    });

    const wash = db.getFirstSync<any>(`SELECT * FROM maintenance_items WHERE category = 'Vehicle Wash'`)!;
    expect(wash.next_due_odo).toBeNull();
    expect(wash.next_due_date).toBeNull();
    expect(db.getFirstSync<any>('SELECT * FROM reminder_settings WHERE item_id = ?', [wash.id])).not.toBeNull();
  });

  it('v7: backfills the newer items, including the scooter-only one', () => {
    const cat = (c: string) => db.getFirstSync<any>(`SELECT * FROM maintenance_items WHERE category = ?`, [c]);
    expect(cat('Oil Filter')).toMatchObject({ next_due_odo: 30000, next_due_date: plusDays(365), vehicle_type_scope: 'universal' });
    expect(cat('Throttle Body Cleaning')).toMatchObject({ next_due_odo: 32000 });
    expect(cat('Valve Clearance')).toMatchObject({ next_due_odo: 32000 });
    expect(cat('Engine Overhaul')).toMatchObject({ next_due_odo: null, next_due_date: null });
    expect(cat('CVT Clutch & Bell')).toMatchObject({ next_due_odo: 50000, vehicle_type_scope: 'scooter' });
    expect(cat('Clutch Plates')).toBeNull(); // manual-bike item — not for a scooter
  });
});

describe('upgrade from version 2 (v3 backfill)', () => {
  beforeEach(async () => {
    freezeClock(2026, 10, 17);
    db = await createMigratedDb();
  });

  it('does not duplicate an item the vehicle already has', async () => {
    const v = addVehicle(db, { odo: 1000 });
    addItem(db, v, { category: 'Vehicle Wash' });
    db.execSync('PRAGMA user_version = 2');

    await runMigrations(db as any);

    const washes = db.getAllSync(`SELECT id FROM maintenance_items WHERE vehicle_id = ? AND category = 'Vehicle Wash'`, [v]);
    expect(washes).toHaveLength(1);
    expect(db.getFirstSync(`SELECT id FROM maintenance_items WHERE vehicle_id = ? AND category = 'Front Fork Servicing'`, [v])).not.toBeNull();
  });

  it('adds the items to every vehicle', async () => {
    const a = addVehicle(db, { nickname: 'A', odo: 100 });
    const b = addVehicle(db, { nickname: 'B', odo: 200, type: 'car' });
    db.execSync('PRAGMA user_version = 2');

    await runMigrations(db as any);

    for (const id of [a, b]) {
      const forks = db.getAllSync(`SELECT id FROM maintenance_items WHERE vehicle_id = ? AND category = 'Front Fork Servicing'`, [id]);
      expect(forks).toHaveLength(1);
    }
  });
});

describe('upgrade from version 6 (v7 data changes)', () => {
  beforeEach(async () => {
    freezeClock(2026, 10, 17);
    db = await createMigratedDb();
  });

  const run = async () => {
    db.execSync('PRAGMA user_version = 6');
    await runMigrations(db as any);
  };
  const names = (vehicleId: number) =>
    db
      .getAllSync<{ category: string }>('SELECT category FROM maintenance_items WHERE vehicle_id = ? ORDER BY category', [vehicleId])
      .map((r) => r.category);

  it('renames old item names in place, so service history stays attached', async () => {
    const v = addVehicle(db, { type: 'scooter' });
    const cvt = addItem(db, v, { category: 'CVT Basic Service' });
    const belt = addItem(db, v, { category: 'CVT Variator/Pulley' });
    const chain = addItem(db, addVehicle(db, { nickname: 'Bike', type: 'manual_bike' }), { category: 'Chain Replacement' });
    db.runSync(`INSERT INTO maintenance_logs (item_id, vehicle_id, date) VALUES (?, ?, '2026-01-01')`, [cvt, v]);

    await run();

    const cat = (id: number) => db.getFirstSync<any>('SELECT category FROM maintenance_items WHERE id = ?', [id])!.category;
    expect(cat(cvt)).toBe('CVT Service');
    expect(cat(belt)).toBe('CVT Sliders & Guides');
    expect(cat(chain)).toBe('Chain & Sprocket Set');
    expect(db.getAllSync('SELECT id FROM maintenance_logs WHERE item_id = ?', [cvt])).toHaveLength(1);
  });

  it('does not rename onto a name the vehicle already has', async () => {
    const v = addVehicle(db, { type: 'scooter' });
    addItem(db, v, { category: 'CVT Basic Service' });
    addItem(db, v, { category: 'CVT Service' });

    await run();

    expect(names(v).filter((n) => n === 'CVT Service')).toHaveLength(1);
    expect(names(v)).toContain('CVT Basic Service'); // left alone rather than creating a duplicate
  });

  it('raises the CVT Rollers interval from the old 12,000 to 18,000 km, but only that exact default', async () => {
    const v1 = addVehicle(db, { nickname: 'Default', type: 'scooter' });
    const v2 = addVehicle(db, { nickname: 'Custom', type: 'scooter' });
    const old = addItem(db, v1, { category: 'CVT Rollers', interval_km: 12000 });
    const custom = addItem(db, v2, { category: 'CVT Rollers', interval_km: 15000 });

    await run();

    const km = (id: number) => db.getFirstSync<any>('SELECT interval_km FROM maintenance_items WHERE id = ?', [id])!.interval_km;
    expect(km(old)).toBe(18000);
    expect(km(custom)).toBe(15000);
  });

  it('backfills new items by vehicle type', async () => {
    const scooter = addVehicle(db, { nickname: 'S', type: 'scooter' });
    const manual = addVehicle(db, { nickname: 'M', type: 'manual_bike' });
    const car = addVehicle(db, { nickname: 'C', type: 'car' });

    await run();

    expect(names(scooter)).toEqual(expect.arrayContaining(['Oil Filter', 'CVT Clutch & Bell']));
    expect(names(scooter)).not.toContain('Clutch Plates');
    expect(names(manual)).toEqual(expect.arrayContaining(['Oil Filter', 'Clutch Plates']));
    expect(names(manual)).not.toContain('CVT Clutch & Bell');
    expect(names(car)).toEqual(['Engine Overhaul', 'Oil Filter', 'Throttle Body Cleaning', 'Valve Clearance']);
  });

  it('leaves a vehicle that is already complete alone', async () => {
    const v = addVehicle(db, { type: 'car' });
    seedMaintenanceItems(db as any, v, 'car', 0);
    const before = db.count('maintenance_items');

    await run();

    expect(db.count('maintenance_items')).toBe(before);
  });
});

describe('upgrade from version 7 (v8 price_home backfill)', () => {
  let vehicleId: number;
  beforeEach(async () => {
    db = await createMigratedDb();
    vehicleId = addVehicle(db);
  });

  const log = (currency: string | null, price: number, priceHome: number | null = null) =>
    db.runSync(
      `INSERT INTO fuel_logs (vehicle_id, date, odometer, litres, price_per_litre, currency, price_home)
       VALUES (?, '2026-10-01', 1000, 5, ?, ?, ?)`,
      [vehicleId, price, currency, priceHome]
    ).lastInsertRowId;
  const priceHome = (id: number) => db.getFirstSync<any>('SELECT price_home FROM fuel_logs WHERE id = ?', [id])!.price_home;
  const run = async () => {
    db.execSync('PRAGMA user_version = 7');
    await runMigrations(db as any);
  };

  it('copies the price 1:1 for logs in the home currency (SGD by default) or with no currency', async () => {
    const sgd = log('SGD', 2.4);
    const none = log(null, 2.6);
    await run();
    expect(priceHome(sgd)).toBe(2.4);
    expect(priceHome(none)).toBe(2.6);
  });

  it('leaves foreign-currency logs empty — their historical rate is unknown', async () => {
    const myr = log('MYR', 2.05);
    await run();
    expect(priceHome(myr)).toBeNull();
  });

  it('follows the rider\'s saved home currency', async () => {
    db.runSync(`INSERT INTO app_settings (key, value) VALUES ('home_currency', 'MYR')`);
    const myr = log('MYR', 2.05);
    const sgd = log('SGD', 2.4);
    await run();
    expect(priceHome(myr)).toBe(2.05);
    expect(priceHome(sgd)).toBeNull();
  });

  it('never overwrites a price_home that is already set', async () => {
    const converted = log('MYR', 2.05, 0.61);
    await run();
    expect(priceHome(converted)).toBe(0.61);
  });
});
