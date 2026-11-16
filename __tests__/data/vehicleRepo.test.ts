/**
 * vehicleRepo — against a real SQLite engine (sql.js) with the app's real migrations.
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { vehicleRepo } from '@/repositories/vehicleRepo';
import { logToFile } from '@/utils/logger';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import { TestDb, createMigratedDb, freezeClock, getCurrentDb, setCurrentDb, unfreezeClock } from '../helpers/testDb';

const mSync = requestMaintenanceSync as jest.Mock;
const mLog = logToFile as jest.Mock;

let db: TestDb;

beforeEach(async () => {
  jest.clearAllMocks();
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
});

const input = (over: object = {}) => ({ nickname: 'Beat', type: 'scooter' as const, current_odometer: 1000, ...over });

describe('create', () => {
  it('saves the vehicle and returns its id', async () => {
    const res = await vehicleRepo.create(input({ make: 'Honda', model: 'Beat', year: 2020, plate_number: 'FBR1234A' }));
    expect(res.error).toBeNull();
    const row = db.getFirstSync<any>('SELECT * FROM vehicles WHERE id = ?', [res.data])!;
    expect(row).toMatchObject({
      nickname: 'Beat',
      type: 'scooter',
      make: 'Honda',
      model: 'Beat',
      year: 2020,
      plate_number: 'FBR1234A',
      current_odometer: 1000,
    });
  });

  it('stores missing optional fields as NULL', async () => {
    const res = await vehicleRepo.create(input());
    const row = db.getFirstSync<any>('SELECT * FROM vehicles WHERE id = ?', [res.data])!;
    expect(row.make).toBeNull();
    expect(row.photo_uri).toBeNull();
  });

  it('gives the new vehicle its starter maintenance schedule, due from the starting odometer', async () => {
    const res = await vehicleRepo.create(input({ type: 'scooter', current_odometer: 2000 }));
    const items = db.getAllSync<any>('SELECT * FROM maintenance_items WHERE vehicle_id = ?', [res.data]);
    expect(items).toHaveLength(22);
    expect(items.find((i) => i.category === 'Engine Oil').next_due_odo).toBe(7000);
  });

  it('asks the notification planner to re-check', async () => {
    await vehicleRepo.create(input());
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('reports a friendly error (and logs it) when the type is invalid — nothing is saved', async () => {
    const res = await vehicleRepo.create(input({ type: 'boat' }));
    expect(res).toEqual({ data: null, error: 'Could not save vehicle. Please try again.' });
    expect(db.count('vehicles')).toBe(0);
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'vehicleRepo.create', expect.any(String));
    expect(mSync).not.toHaveBeenCalled();
  });
});

describe('getAll', () => {
  it('lists newest first', async () => {
    jest.setSystemTime(new Date(2026, 10, 1, 9));
    await vehicleRepo.create(input({ nickname: 'Old' }));
    jest.setSystemTime(new Date(2026, 10, 10, 9));
    await vehicleRepo.create(input({ nickname: 'New' }));

    const res = await vehicleRepo.getAll();
    expect(res.data!.map((v) => v.nickname)).toEqual(['New', 'Old']);
  });

  it('returns an empty list for a new install', async () => {
    expect(await vehicleRepo.getAll()).toEqual({ data: [], error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await vehicleRepo.getAll()).toEqual({ data: null, error: 'Could not load your vehicles.' });
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'vehicleRepo.getAll', expect.stringContaining('locked'));
  });
});

describe('getById', () => {
  it('finds a vehicle', async () => {
    const { data: id } = await vehicleRepo.create(input({ nickname: 'Aerox' }));
    const res = await vehicleRepo.getById(id!);
    expect(res.data).toMatchObject({ id, nickname: 'Aerox' });
  });

  it('returns null (not an error) for an unknown id', async () => {
    expect(await vehicleRepo.getById(999)).toEqual({ data: null, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await vehicleRepo.getById(1)).toEqual({ data: null, error: 'Could not load vehicle.' });
  });
});

describe('update', () => {
  it('changes only the fields given and refreshes updated_at', async () => {
    const { data: id } = await vehicleRepo.create(input({ nickname: 'Beat', make: 'Honda' }));
    jest.setSystemTime(new Date(2026, 10, 20, 9));
    jest.clearAllMocks();

    const res = await vehicleRepo.update(id!, { nickname: 'Beat Blue' });
    expect(res).toEqual({ data: undefined, error: null });

    const row = db.getFirstSync<any>('SELECT * FROM vehicles WHERE id = ?', [id])!;
    expect(row.nickname).toBe('Beat Blue');
    expect(row.make).toBe('Honda');
    expect(row.updated_at).toBe(new Date(2026, 10, 20, 9).toISOString());
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('skips fields that are undefined (so an untouched odometer keeps its precise value)', async () => {
    const { data: id } = await vehicleRepo.create(input({ current_odometer: 12345.678 }));
    await vehicleRepo.update(id!, { nickname: 'X', current_odometer: undefined });
    expect(db.getFirstSync<any>('SELECT current_odometer FROM vehicles WHERE id = ?', [id])!.current_odometer).toBe(12345.678);
  });

  it('does nothing — and does not trigger a re-check — when there is nothing to change', async () => {
    const { data: id } = await vehicleRepo.create(input());
    jest.clearAllMocks();
    expect(await vehicleRepo.update(id!, {})).toEqual({ data: undefined, error: null });
    expect(await vehicleRepo.update(id!, { make: undefined })).toEqual({ data: undefined, error: null });
    expect(mSync).not.toHaveBeenCalled();
  });

  it('returns a friendly error when the change is rejected (e.g. an invalid type)', async () => {
    const { data: id } = await vehicleRepo.create(input());
    const res = await vehicleRepo.update(id!, { type: 'boat' as any });
    expect(res).toEqual({ data: null, error: 'Could not update vehicle.' });
    expect(db.getFirstSync<any>('SELECT type FROM vehicles WHERE id = ?', [id])!.type).toBe('scooter');
  });
});

describe('updateOdometer', () => {
  it('saves the new reading and asks for a re-check (services may now be due)', async () => {
    const { data: id } = await vehicleRepo.create(input({ current_odometer: 1000 }));
    jest.clearAllMocks();

    expect(await vehicleRepo.updateOdometer(id!, 1500.5)).toEqual({ data: undefined, error: null });

    expect(db.getFirstSync<any>('SELECT current_odometer FROM vehicles WHERE id = ?', [id])!.current_odometer).toBe(1500.5);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await vehicleRepo.updateOdometer(1, 5)).toEqual({ data: null, error: 'Could not update odometer.' });
  });
});

describe('delete', () => {
  it('removes the vehicle and everything that belongs to it, then asks for a re-check', async () => {
    const { data: id } = await vehicleRepo.create(input());
    const item = db.getFirstSync<any>('SELECT id FROM maintenance_items WHERE vehicle_id = ? LIMIT 1', [id])!.id;
    db.runSync(`INSERT INTO fuel_logs (vehicle_id, date, odometer, litres) VALUES (?, '2026-11-01', 1100, 4)`, [id]);
    db.runSync(`INSERT INTO maintenance_logs (item_id, vehicle_id, date) VALUES (?, ?, '2026-11-01')`, [item, id]);
    jest.clearAllMocks();

    expect(await vehicleRepo.delete(id!)).toEqual({ data: undefined, error: null });

    expect(db.count('vehicles')).toBe(0);
    expect(db.count('maintenance_items')).toBe(0);
    expect(db.count('fuel_logs')).toBe(0);
    expect(db.count('maintenance_logs')).toBe(0);
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it("only removes that vehicle's data", async () => {
    const { data: keep } = await vehicleRepo.create(input({ nickname: 'Keep' }));
    const { data: drop } = await vehicleRepo.create(input({ nickname: 'Drop' }));
    await vehicleRepo.delete(drop!);

    expect((await vehicleRepo.getAll()).data!.map((v) => v.nickname)).toEqual(['Keep']);
    expect(db.getAllSync('SELECT 1 FROM maintenance_items WHERE vehicle_id = ?', [keep])).toHaveLength(22);
  });

  it('deleting an unknown id is harmless', async () => {
    expect(await vehicleRepo.delete(999)).toEqual({ data: undefined, error: null });
  });

  // KNOWN GAP — documented with it.failing so the suite stays green but flags the day it is fixed.
  // `PRAGMA foreign_keys = ON` is only executed inside migration V1 (first install). SQLite resets it for every
  // new connection, so on every later app launch ON DELETE CASCADE is NOT enforced and deleting a vehicle leaves
  // its fuel logs / service items / history behind as orphans. (The notification planner defends against orphans
  // itself.) Fix: run `PRAGMA foreign_keys = ON` whenever the database is opened (src/db/client.ts getDb()).
  // When fixed, this test starts failing: change `it.failing` to `it`.
  it.failing('removes its data even on a later app launch (foreign keys are off on a new connection)', async () => {
    const { data: id } = await vehicleRepo.create(input());
    db.execSync('PRAGMA foreign_keys = OFF'); // what a fresh connection looks like after the app restarts

    await vehicleRepo.delete(id!);

    expect(db.count('maintenance_items')).toBe(0);
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await vehicleRepo.delete(1)).toEqual({ data: null, error: 'Could not delete vehicle.' });
  });
});
