/**
 * seedMaintenanceItems — the starter service schedule every new vehicle gets. Real SQLite (sql.js).
 */
import { seedMaintenanceItems } from '@/db/seeds';
import type { VehicleType } from '@/types';
import { TestDb, addVehicle, createMigratedDb, freezeClock, unfreezeClock } from '../helpers/testDb';

const plusDays = (n: number) => new Date(Date.UTC(2026, 10, 17 + n)).toISOString().slice(0, 10);

let db: TestDb;

beforeEach(async () => {
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
});
afterEach(() => {
  unfreezeClock();
  db.close();
});

function seed(type: VehicleType, odo = 10000) {
  const id = addVehicle(db, { type, odo });
  seedMaintenanceItems(db as any, id, type, odo);
  return id;
}
const items = (vehicleId: number) =>
  db.getAllSync<any>('SELECT * FROM maintenance_items WHERE vehicle_id = ? ORDER BY category', [vehicleId]);
const byCategory = (vehicleId: number, category: string) =>
  items(vehicleId).find((i) => i.category === category);

describe('which items each vehicle type gets', () => {
  it.each<[VehicleType, number]>([
    ['other', 16],
    ['scooter', 22],
    ['manual_bike', 22],
    ['car', 21],
  ])('%s gets %i items', (type, expected) => {
    expect(items(seed(type))).toHaveLength(expected);
  });

  it('everyone gets the universal basics', () => {
    const names = items(seed('other')).map((i) => i.category);
    expect(names).toEqual(
      expect.arrayContaining(['Engine Oil', 'Air Filter', 'Spark Plug', 'Brake Fluid', 'Front Tyre', 'Battery', 'Vehicle Wash'])
    );
  });

  it('only scooters get CVT items', () => {
    const scooter = items(seed('scooter')).map((i) => i.category);
    const manual = items(seed('manual_bike')).map((i) => i.category);
    expect(scooter).toEqual(expect.arrayContaining(['CVT Service', 'CVT Rollers', 'CVT V Belt', 'CVT Sliders & Guides', 'CVT Clutch & Bell']));
    expect(manual.some((c) => c.startsWith('CVT'))).toBe(false);
  });

  it('only manual bikes get chain and clutch items', () => {
    const manual = items(seed('manual_bike')).map((i) => i.category);
    const scooter = items(seed('scooter')).map((i) => i.category);
    expect(manual).toEqual(expect.arrayContaining(['Chain Lubrication', 'Chain Adjustment', 'Chain & Sprocket Set', 'Clutch Cable Inspection', 'Clutch Plates']));
    expect(scooter).not.toContain('Chain Lubrication');
  });

  it('only cars get car items', () => {
    const car = items(seed('car')).map((i) => i.category);
    expect(car).toEqual(expect.arrayContaining(['Transmission Oil', 'Timing Belt/Chain', 'Cabin Air Filter', 'Power Steering Fluid', 'Wiper Blades']));
  });

  it.each<VehicleType>(['scooter', 'manual_bike', 'car', 'other'])('%s has no duplicate categories', (type) => {
    const names = items(seed(type)).map((i) => i.category);
    expect(new Set(names).size).toBe(names.length);
  });

  it('tags each item with the scope it came from', () => {
    const id = seed('scooter');
    expect(byCategory(id, 'Engine Oil').vehicle_type_scope).toBe('universal');
    expect(byCategory(id, 'CVT Rollers').vehicle_type_scope).toBe('scooter');
  });
});

describe('due dates and kilometres', () => {
  it('km-based items fall due at current odometer + interval', () => {
    const id = seed('scooter', 10000);
    const oil = byCategory(id, 'Engine Oil');
    expect(oil.interval_km).toBe(5000);
    expect(oil.next_due_odo).toBe(15000);
    expect(byCategory(id, 'CVT V Belt').next_due_odo).toBe(35000);
  });

  it('works from a brand-new vehicle at 0 km', () => {
    const id = seed('scooter', 0);
    expect(byCategory(id, 'Engine Oil').next_due_odo).toBe(5000);
  });

  it('day-based items fall due that many days from today', () => {
    const id = seed('scooter');
    const oil = byCategory(id, 'Engine Oil');
    expect(oil.interval_days).toBe(90);
    expect(oil.next_due_date).toBe(plusDays(90));
    expect(byCategory(id, 'Battery').next_due_date).toBe(plusDays(730));
  });

  it('items with only a km interval have no date, and vice versa', () => {
    const id = seed('scooter', 10000);
    expect(byCategory(id, 'Front Tyre')).toMatchObject({ interval_days: null, next_due_date: null });
    expect(byCategory(id, 'Battery')).toMatchObject({ interval_km: null, next_due_odo: null });
  });

  it('on-demand items (Engine Overhaul, Vehicle Wash) never fall due on their own', () => {
    const id = seed('scooter');
    for (const c of ['Engine Overhaul', 'Vehicle Wash']) {
      expect(byCategory(id, c)).toMatchObject({ interval_km: null, interval_days: null, next_due_odo: null, next_due_date: null });
    }
  });

  it('stamps updated_at with today', () => {
    expect(byCategory(seed('car'), 'Wiper Blades').updated_at).toBe('2026-11-17');
  });
});

describe('reminder settings', () => {
  it('creates exactly one reminder row per item', () => {
    const id = seed('scooter');
    const rows = db.getAllSync<any>(
      `SELECT rs.* FROM reminder_settings rs JOIN maintenance_items mi ON mi.id = rs.item_id WHERE mi.vehicle_id = ?`,
      [id]
    );
    expect(rows).toHaveLength(items(id).length);
  });

  it('stores the early / final thresholds from the catalogue', () => {
    const id = seed('scooter');
    const oil = byCategory(id, 'Engine Oil');
    const row = db.getFirstSync<any>('SELECT * FROM reminder_settings WHERE item_id = ?', [oil.id])!;
    expect(row).toMatchObject({
      early_km_before: 1000,
      early_days_before: 14,
      early_enabled: 1,
      final_km_before: 200,
      final_days_before: 3,
      final_enabled: 1,
    });
  });

  it('leaves thresholds empty for items without them', () => {
    const id = seed('scooter');
    const wash = byCategory(id, 'Vehicle Wash');
    const row = db.getFirstSync<any>('SELECT * FROM reminder_settings WHERE item_id = ?', [wash.id])!;
    expect(row.early_km_before).toBeNull();
    expect(row.final_days_before).toBeNull();
  });
});

describe('two vehicles', () => {
  it('each get their own independent set', () => {
    const a = seed('scooter', 1000);
    const b = seed('scooter', 9000);
    expect(items(a)).toHaveLength(22);
    expect(items(b)).toHaveLength(22);
    expect(byCategory(a, 'Engine Oil').next_due_odo).toBe(6000);
    expect(byCategory(b, 'Engine Oil').next_due_odo).toBe(14000);
  });
});
