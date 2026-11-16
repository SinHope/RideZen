/**
 * fuelRepo — real SQLite (sql.js). The important part is the consumption chain: L/100km is recomputed for the
 * whole vehicle after every add / edit / delete, so back-dated or edited fills never leave neighbours stale.
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { fuelRepo } from '@/repositories/fuelRepo';
import { logToFile } from '@/utils/logger';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import type { FuelLogInput } from '@/types';
import { TestDb, addVehicle, createMigratedDb, freezeClock, getCurrentDb, setCurrentDb, unfreezeClock } from '../helpers/testDb';

const mSync = requestMaintenanceSync as jest.Mock;
const mLog = logToFile as jest.Mock;

let db: TestDb;
let vehicleId: number;

beforeEach(async () => {
  jest.clearAllMocks();
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
  vehicleId = addVehicle(db, { odo: 500 });
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
});

const fill = (over: Partial<FuelLogInput> = {}): FuelLogInput => ({
  vehicle_id: vehicleId,
  date: '2026-11-01',
  odometer: 1000,
  litres: 4,
  is_full_tank: true,
  ...over,
});
const add = async (over: Partial<FuelLogInput> = {}) => {
  const res = await fuelRepo.add(fill(over));
  expect(res.error).toBeNull();
  return res.data as number;
};
const row = (id: number) => db.getFirstSync<any>('SELECT * FROM fuel_logs WHERE id = ?', [id])!;
const odoOf = (id: number) => db.getFirstSync<any>('SELECT current_odometer FROM vehicles WHERE id = ?', [id])!.current_odometer;

// ─── add ──────────────────────────────────────────────────────────────────────

describe('add', () => {
  it('saves every field', async () => {
    const id = await add({ price_per_litre: 2.5, currency: 'MYR', price_home: 0.75, notes: 'Shell', is_full_tank: false });
    expect(row(id)).toMatchObject({
      vehicle_id: vehicleId,
      date: '2026-11-01',
      odometer: 1000,
      litres: 4,
      price_per_litre: 2.5,
      currency: 'MYR',
      price_home: 0.75,
      is_full_tank: 0,
      notes: 'Shell',
    });
  });

  it('stores missing optional fields as NULL', async () => {
    const r = row(await add());
    expect(r.price_per_litre).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.price_home).toBeNull();
    expect(r.notes).toBeNull();
  });

  it('stores a full tank as 1 and a partial as 0', async () => {
    expect(row(await add({ odometer: 1000 })).is_full_tank).toBe(1);
    expect(row(await add({ odometer: 1100, is_full_tank: false })).is_full_tank).toBe(0);
  });

  it('asks the notification planner to re-check (a refuel can raise the odometer)', async () => {
    await add();
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly error and logs when the save fails', async () => {
    jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    const res = await fuelRepo.add(fill());
    expect(res).toEqual({ data: null, error: 'Could not save fuel log. Please try again.' });
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'fuelRepo.add', expect.stringContaining('disk full'));
    expect(mSync).not.toHaveBeenCalled();
  });

  it('rejects a log for a vehicle that does not exist', async () => {
    const res = await fuelRepo.add(fill({ vehicle_id: 999 }));
    expect(res.error).toBe('Could not save fuel log. Please try again.');
  });
});

// ─── consumption chain ────────────────────────────────────────────────────────

describe('consumption (L/100km)', () => {
  it('the first fill has no distance and no consumption yet', async () => {
    const r = row(await add({ odometer: 1000, litres: 4 }));
    expect(r.km_since_last).toBeNull();
    expect(r.consumption).toBeNull();
  });

  it('a full tank after a full tank: litres ÷ km × 100', async () => {
    await add({ odometer: 1000, litres: 4 });
    const second = row(await add({ odometer: 1100, litres: 5, date: '2026-11-05' }));
    expect(second.km_since_last).toBe(100);
    expect(second.consumption).toBe(5); // 5 L over 100 km
  });

  it('rounds to 2 decimals', async () => {
    await add({ odometer: 1000, litres: 4 });
    const second = row(await add({ odometer: 1300, litres: 8 }));
    expect(second.consumption).toBe(2.67); // 8 / 300 × 100
  });

  it('counts partial fills toward the next full tank', async () => {
    await add({ odometer: 1000, litres: 4 }); // full
    const partial = row(await add({ odometer: 1050, litres: 2, is_full_tank: false }));
    const full = row(await add({ odometer: 1100, litres: 3 }));

    expect(partial.km_since_last).toBe(50);
    expect(partial.consumption).toBeNull(); // only full fills get a consumption figure
    expect(full.consumption).toBe(5); // (2 + 3) L over 100 km
  });

  it('ignores partial fills made before the first full tank', async () => {
    await add({ odometer: 900, litres: 2, is_full_tank: false });
    const first = row(await add({ odometer: 1000, litres: 4 }));
    const second = row(await add({ odometer: 1100, litres: 5 }));
    expect(first.consumption).toBeNull();
    expect(second.consumption).toBe(5);
  });

  it('two fills at the same odometer cannot produce a consumption (no distance)', async () => {
    await add({ odometer: 1000, litres: 4 });
    const same = row(await add({ odometer: 1000, litres: 3 }));
    expect(same.km_since_last).toBe(0);
    expect(same.consumption).toBeNull();
  });

  it('a back-dated fill re-computes its neighbours', async () => {
    const first = await add({ odometer: 1000, litres: 4 });
    const last = await add({ odometer: 1200, litres: 10, date: '2026-11-10' });
    expect(row(last).km_since_last).toBe(200);
    expect(row(last).consumption).toBe(5); // 10 / 200

    const middle = await add({ odometer: 1100, litres: 6, date: '2026-11-05' });

    expect(row(first).consumption).toBeNull();
    expect(row(middle)).toMatchObject({ km_since_last: 100, consumption: 6 });
    expect(row(last)).toMatchObject({ km_since_last: 100, consumption: 10 });
  });

  it("each vehicle's chain is independent", async () => {
    const other = addVehicle(db, { nickname: 'Other', odo: 0 });
    await add({ odometer: 1000, litres: 4 });
    await fuelRepo.add(fill({ vehicle_id: other, odometer: 50, litres: 2 }));
    const second = row(await add({ odometer: 1100, litres: 5 }));
    expect(second.km_since_last).toBe(100); // not measured against the other vehicle's 50
  });
});

// ─── vehicle odometer ─────────────────────────────────────────────────────────

describe('vehicle odometer', () => {
  it('rises to the highest fuel-log reading when it lags behind', async () => {
    await add({ odometer: 800 });
    expect(odoOf(vehicleId)).toBe(800); // was 500
  });

  it('never goes down because of an older / lower reading', async () => {
    await add({ odometer: 800 });
    await add({ odometer: 300, date: '2026-10-01' });
    expect(odoOf(vehicleId)).toBe(800);
  });

  it('follows an edit that raises the reading', async () => {
    const id = await add({ odometer: 800 });
    await fuelRepo.update(id, fill({ odometer: 950 }));
    expect(odoOf(vehicleId)).toBe(950);
  });
});

// ─── update / delete ──────────────────────────────────────────────────────────

describe('update', () => {
  it('rewrites the fields and recomputes the chain', async () => {
    await add({ odometer: 1000, litres: 4 });
    const id = await add({ odometer: 1100, litres: 5 });

    const res = await fuelRepo.update(id, fill({ odometer: 1200, litres: 6, notes: 'edited', price_per_litre: 2.2 }));

    expect(res).toEqual({ data: undefined, error: null });
    expect(row(id)).toMatchObject({ odometer: 1200, litres: 6, notes: 'edited', price_per_litre: 2.2, km_since_last: 200, consumption: 3 });
  });

  it('asks the notification planner to re-check', async () => {
    const id = await add();
    jest.clearAllMocks();
    await fuelRepo.update(id, fill({ litres: 6 }));
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('returns a friendly error when the change fails', async () => {
    const id = await add();
    jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.update(id, fill())).toEqual({ data: null, error: 'Could not update fuel log.' });
  });
});

describe('delete', () => {
  it('removes the log and re-measures the neighbours', async () => {
    await add({ odometer: 1000, litres: 4 });
    const middle = await add({ odometer: 1100, litres: 5 });
    const last = await add({ odometer: 1300, litres: 8 });
    expect(row(last).km_since_last).toBe(200);

    expect(await fuelRepo.delete(middle)).toEqual({ data: undefined, error: null });

    expect(db.getFirstSync('SELECT id FROM fuel_logs WHERE id = ?', [middle])).toBeNull();
    expect(row(last)).toMatchObject({ km_since_last: 300, consumption: 2.67 });
  });

  it('does not ask for a notification re-check (deleting a refuel cannot make a service due)', async () => {
    const id = await add();
    jest.clearAllMocks();
    await fuelRepo.delete(id);
    expect(mSync).not.toHaveBeenCalled();
  });

  it('deleting an unknown id is harmless', async () => {
    expect(await fuelRepo.delete(999)).toEqual({ data: undefined, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.delete(1)).toEqual({ data: null, error: 'Could not delete fuel log.' });
  });
});

// ─── reading ──────────────────────────────────────────────────────────────────

describe('getByVehicle', () => {
  it('lists the highest odometer first', async () => {
    await add({ odometer: 1000 });
    await add({ odometer: 1200 });
    await add({ odometer: 1100 });
    const res = await fuelRepo.getByVehicle(vehicleId);
    expect(res.data!.map((l) => l.odometer)).toEqual([1200, 1100, 1000]);
  });

  it('honours the limit (default 50)', async () => {
    for (let i = 0; i < 5; i++) await add({ odometer: 1000 + i * 100 });
    expect((await fuelRepo.getByVehicle(vehicleId, 2)).data).toHaveLength(2);
    expect((await fuelRepo.getByVehicle(vehicleId)).data).toHaveLength(5);
  });

  it('only returns that vehicle', async () => {
    const other = addVehicle(db, { nickname: 'Other' });
    await add();
    await fuelRepo.add(fill({ vehicle_id: other }));
    expect((await fuelRepo.getByVehicle(vehicleId)).data).toHaveLength(1);
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.getByVehicle(vehicleId)).toEqual({ data: null, error: 'Could not load fuel logs.' });
  });
});

describe('getById', () => {
  it('finds a log, or null for an unknown id', async () => {
    const id = await add({ notes: 'hi' });
    expect((await fuelRepo.getById(id)).data).toMatchObject({ id, notes: 'hi' });
    expect(await fuelRepo.getById(999)).toEqual({ data: null, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.getById(1)).toEqual({ data: null, error: 'Could not load fuel log.' });
  });
});

describe('getLastRefuel', () => {
  it('is the log with the highest odometer, not the newest date', async () => {
    await add({ odometer: 1200, date: '2026-11-01' });
    await add({ odometer: 1000, date: '2026-11-15' });
    expect((await fuelRepo.getLastRefuel(vehicleId)).data!.odometer).toBe(1200);
  });

  it('is null when there are no logs', async () => {
    expect(await fuelRepo.getLastRefuel(vehicleId)).toEqual({ data: null, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.getLastRefuel(vehicleId)).toEqual({ data: null, error: 'Could not load last refuel.' });
  });
});

// ─── monthly stats ────────────────────────────────────────────────────────────

describe('getMonthlyStats (today is 17 Nov 2026)', () => {
  it('is all zeros when nothing was logged this month', async () => {
    await add({ date: '2026-10-31' });
    expect(await fuelRepo.getMonthlyStats(vehicleId)).toEqual({
      data: { total_litres: 0, total_cost: 0, avg_consumption: 0 },
      error: null,
    });
  });

  it('counts only this month (from the 1st), totals litres, and averages consumption', async () => {
    await add({ date: '2026-10-31', odometer: 900, litres: 4, price_home: 2.0 }); // last month — excluded
    await add({ date: '2026-11-01', odometer: 1000, litres: 5, price_home: 2.5 }); // 5 L / 100 km
    await add({ date: '2026-11-10', odometer: 1200, litres: 12, price_home: 3.0 }); // 12 L / 200 km = 6

    const { data } = await fuelRepo.getMonthlyStats(vehicleId);

    expect(data!.total_litres).toBe(17);
    expect(data!.total_cost).toBe(5 * 2.5 + 12 * 3.0);
    expect(data!.avg_consumption).toBe(5.5);
  });

  it('leaves foreign-currency fills without a stored conversion out of the cost (never sums mixed currencies)', async () => {
    await add({ date: '2026-11-02', odometer: 1000, litres: 5, price_per_litre: 2.0, currency: 'MYR' }); // price_home NULL
    await add({ date: '2026-11-03', odometer: 1100, litres: 10, price_home: 2.0 });

    const { data } = await fuelRepo.getMonthlyStats(vehicleId);

    expect(data!.total_litres).toBe(15);
    expect(data!.total_cost).toBe(20); // only the converted fill
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.getMonthlyStats(vehicleId)).toEqual({ data: null, error: 'Could not load stats.' });
  });
});

describe('getMonthlyGlobalStats', () => {
  it('returns zeros without touching the database when there are no vehicles', async () => {
    expect(await fuelRepo.getMonthlyGlobalStats([])).toEqual({ totalCost: 0, avgConsumption: null, avgVehicleName: null });
  });

  it('sums cost across the given vehicles and names the most efficient one', async () => {
    const thrifty = addVehicle(db, { nickname: 'Thrifty', odo: 0 });
    const thirsty = addVehicle(db, { nickname: 'Thirsty', odo: 0 });
    const ignored = addVehicle(db, { nickname: 'Ignored', odo: 0 });

    // Thrifty: 4 L / 100 km. Thirsty: 8 L / 100 km. Ignored is not in the list.
    await fuelRepo.add(fill({ vehicle_id: thrifty, date: '2026-11-02', odometer: 1000, litres: 3, price_home: 2 }));
    await fuelRepo.add(fill({ vehicle_id: thrifty, date: '2026-11-05', odometer: 1100, litres: 4, price_home: 2 }));
    await fuelRepo.add(fill({ vehicle_id: thirsty, date: '2026-11-02', odometer: 1000, litres: 3, price_home: 3 }));
    await fuelRepo.add(fill({ vehicle_id: thirsty, date: '2026-11-05', odometer: 1100, litres: 8, price_home: 3 }));
    await fuelRepo.add(fill({ vehicle_id: ignored, date: '2026-11-05', odometer: 1100, litres: 99, price_home: 9 }));

    const res = await fuelRepo.getMonthlyGlobalStats([thrifty, thirsty]);

    expect(res.totalCost).toBe((3 + 4) * 2 + (3 + 8) * 3);
    expect(res.avgConsumption).toBe(4);
    expect(res.avgVehicleName).toBe('Thrifty');
  });

  it('has a cost but no efficiency yet when no vehicle has two full fills', async () => {
    await add({ date: '2026-11-02', litres: 5, price_home: 2 });
    const res = await fuelRepo.getMonthlyGlobalStats([vehicleId]);
    expect(res).toEqual({ totalCost: 10, avgConsumption: null, avgVehicleName: null });
  });

  it('ignores last month', async () => {
    await add({ date: '2026-10-20', litres: 5, price_home: 2 });
    expect((await fuelRepo.getMonthlyGlobalStats([vehicleId])).totalCost).toBe(0);
  });

  it('falls back to zeros when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await fuelRepo.getMonthlyGlobalStats([vehicleId])).toEqual({ totalCost: 0, avgConsumption: null, avgVehicleName: null });
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'fuelRepo.getMonthlyGlobalStats', expect.any(String));
  });
});
