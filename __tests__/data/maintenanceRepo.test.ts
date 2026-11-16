/**
 * maintenanceRepo — real SQLite (sql.js). Covers the status badges, logging a service (which sets the next due
 * km / date), history, and the overdue summary shown on Home.
 * "Today" is frozen at 17 Nov 2026.
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { logToFile } from '@/utils/logger';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import { TestDb, addItem, addVehicle, createMigratedDb, freezeClock, getCurrentDb, setCurrentDb, unfreezeClock } from '../helpers/testDb';

const mSync = requestMaintenanceSync as jest.Mock;
const mLog = logToFile as jest.Mock;

/** YYYY-MM-DD, `n` days after the frozen today (2026-11-17). */
const plusDays = (n: number) => new Date(Date.UTC(2026, 10, 17 + n)).toISOString().slice(0, 10);

let db: TestDb;
let vehicleId: number;

beforeEach(async () => {
  jest.clearAllMocks();
  freezeClock(2026, 10, 17);
  db = await createMigratedDb();
  setCurrentDb(db);
  vehicleId = addVehicle(db, { odo: 5000 });
});
afterEach(() => {
  unfreezeClock();
  setCurrentDb(null);
});

const itemRow = (id: number) => db.getFirstSync<any>('SELECT * FROM maintenance_items WHERE id = ?', [id])!;
const logs = (itemId: number) => db.getAllSync<any>('SELECT * FROM maintenance_logs WHERE item_id = ? ORDER BY id', [itemId]);
const failNextWrite = () =>
  jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
    throw new Error('locked');
  });

// ─── getByVehicle ─────────────────────────────────────────────────────────────

describe('getByVehicle', () => {
  it('lists items A→Z and works out each one\'s status', async () => {
    addItem(db, vehicleId, { category: 'Wash' });
    addItem(db, vehicleId, { category: 'Air Filter', interval_km: 10000, next_due_odo: 4900 }); // already past → overdue
    addItem(db, vehicleId, { category: 'Brake Pads', interval_km: 15000, next_due_odo: 5150 }); // 150 km left → urgent
    addItem(db, vehicleId, { category: 'Chain', interval_km: 5000, next_due_odo: 5900 }); // 900 km left → due
    addItem(db, vehicleId, { category: 'Battery', interval_days: 730, next_due_date: plusDays(400) }); // far off → ok

    const res = await maintenanceRepo.getByVehicle(vehicleId, 5000);

    expect(res.error).toBeNull();
    expect(res.data!.map((i) => [i.category, i.status])).toEqual([
      ['Air Filter', 'overdue'],
      ['Battery', 'ok'],
      ['Brake Pads', 'urgent'],
      ['Chain', 'due'],
      ['Wash', 'ok'],
    ]);
  });

  it('adds km remaining, days remaining and progress to each item', async () => {
    addItem(db, vehicleId, { interval_km: 5000, next_due_odo: 6000, interval_days: 90, next_due_date: plusDays(30) });
    const [item] = (await maintenanceRepo.getByVehicle(vehicleId, 5000)).data!;
    expect(item.km_remaining).toBe(1000);
    expect(item.days_remaining).toBe(30);
    expect(item.progress_pct).toBeCloseTo(80); // 4000 of 5000 km used beats 60 of 90 days
  });

  it('uses the thresholds saved in Settings', async () => {
    addItem(db, vehicleId, { interval_km: 5000, next_due_odo: 5900 }); // 900 km left
    db.runSync(`INSERT INTO app_settings (key, value) VALUES ('early_warning_km', '500')`);
    const [item] = (await maintenanceRepo.getByVehicle(vehicleId, 5000)).data!;
    expect(item.status).toBe('ok'); // 900 km is no longer inside the early-warning window
  });

  it('only returns that vehicle\'s items', async () => {
    const other = addVehicle(db, { nickname: 'Other' });
    addItem(db, vehicleId, { category: 'Mine' });
    addItem(db, other, { category: 'Theirs' });
    expect((await maintenanceRepo.getByVehicle(vehicleId, 0)).data!.map((i) => i.category)).toEqual(['Mine']);
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await maintenanceRepo.getByVehicle(vehicleId, 0)).toEqual({ data: null, error: 'Could not load maintenance items.' });
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'maintenanceRepo.getByVehicle', expect.any(String));
  });
});

describe('getById', () => {
  it('finds an item, or null for an unknown id', async () => {
    const id = addItem(db, vehicleId, { category: 'Oil' });
    expect((await maintenanceRepo.getById(id)).data).toMatchObject({ id, category: 'Oil' });
    expect(await maintenanceRepo.getById(999)).toEqual({ data: null, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await maintenanceRepo.getById(1)).toEqual({ data: null, error: 'Could not load item.' });
  });
});

// ─── logService ───────────────────────────────────────────────────────────────

describe('logService', () => {
  const base = (itemId: number, over: object = {}) => ({
    item_id: itemId,
    vehicle_id: vehicleId,
    date: '2026-11-17',
    odometer: 5000,
    ...over,
  });

  it('records the service in the history with its cost, workshop and notes', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000 });
    await maintenanceRepo.logService(base(id, { cost: 45.5, workshop: 'Ah Seng Motors', notes: 'Used 10W-40' }));

    expect(logs(id)).toHaveLength(1);
    expect(logs(id)[0]).toMatchObject({
      item_id: id,
      vehicle_id: vehicleId,
      date: '2026-11-17',
      odometer: 5000,
      cost: 45.5,
      workshop: 'Ah Seng Motors',
      notes: 'Used 10W-40',
    });
  });

  it('resets the item: last done now, next due = odometer + interval', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000, next_due_odo: 5100 });
    expect(await maintenanceRepo.logService(base(id))).toEqual({ data: undefined, error: null });

    expect(itemRow(id)).toMatchObject({ last_changed_date: '2026-11-17', last_changed_odo: 5000, next_due_odo: 10000, interval_km: 5000 });
  });

  it('day-based items fall due that many days after the service date', async () => {
    const id = addItem(db, vehicleId, { interval_days: 90 });
    await maintenanceRepo.logService(base(id, { odometer: undefined }));
    expect(itemRow(id).next_due_date).toBe(plusDays(90));
  });

  it('keeps both next-due values for an item that has km and day intervals', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000, interval_days: 90 });
    await maintenanceRepo.logService(base(id));
    expect(itemRow(id)).toMatchObject({ next_due_odo: 10000, next_due_date: plusDays(90) });
  });

  it('a new interval replaces the old one', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000, interval_days: 90 });
    await maintenanceRepo.logService(base(id, { new_interval_km: 3000, new_interval_days: 30 }));
    expect(itemRow(id)).toMatchObject({ interval_km: 3000, interval_days: 30, next_due_odo: 8000, next_due_date: plusDays(30) });
  });

  it('an explicit due date wins over the interval', async () => {
    const id = addItem(db, vehicleId, { interval_days: 90 });
    await maintenanceRepo.logService(base(id, { new_due_date: '2027-06-30' }));
    expect(itemRow(id).next_due_date).toBe('2027-06-30');
  });

  it('without an odometer reading the next-due km is left as it was', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000, next_due_odo: 7777 });
    await maintenanceRepo.logService(base(id, { odometer: undefined }));
    expect(itemRow(id).next_due_odo).toBe(7777);
    expect(itemRow(id).last_changed_odo).toBeNull();
  });

  it('an item with no interval at all (e.g. Vehicle Wash) stays without a due date', async () => {
    const id = addItem(db, vehicleId, { category: 'Vehicle Wash' });
    await maintenanceRepo.logService(base(id));
    expect(itemRow(id)).toMatchObject({ next_due_odo: null, next_due_date: null, last_changed_date: '2026-11-17' });
  });

  it('remarks update the item note; without remarks the old note stays', async () => {
    const id = addItem(db, vehicleId, { interval_km: 1000 });
    db.runSync(`UPDATE maintenance_items SET notes = 'old note' WHERE id = ?`, [id]);

    await maintenanceRepo.logService(base(id));
    expect(itemRow(id).notes).toBe('old note');

    await maintenanceRepo.logService(base(id, { remarks: 'new note' }));
    expect(itemRow(id).notes).toBe('new note');
  });

  it('keeps every service in the history, one row each', async () => {
    const id = addItem(db, vehicleId, { interval_km: 1000 });
    await maintenanceRepo.logService(base(id, { date: '2026-06-01' }));
    await maintenanceRepo.logService(base(id, { date: '2026-11-17' }));
    expect(logs(id)).toHaveLength(2);
  });

  it('asks the notification planner to re-check (the item just reset)', async () => {
    const id = addItem(db, vehicleId, { interval_km: 1000 });
    await maintenanceRepo.logService(base(id));
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown item without writing anything', async () => {
    const res = await maintenanceRepo.logService(base(999));
    expect(res).toEqual({ data: null, error: 'Maintenance item not found.' });
    expect(db.count('maintenance_logs')).toBe(0);
    expect(mSync).not.toHaveBeenCalled();
  });

  it('returns a friendly error and logs it when saving fails', async () => {
    const id = addItem(db, vehicleId, { interval_km: 1000 });
    failNextWrite();
    const res = await maintenanceRepo.logService(base(id));
    expect(res).toEqual({ data: null, error: 'Could not save service log. Please try again.' });
    expect(mLog).toHaveBeenCalledWith('DB_ERROR', 'maintenanceRepo.logService', expect.stringContaining('locked'));
    expect(mSync).not.toHaveBeenCalled();
  });
});

// ─── getHistory ───────────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('lists the newest service first', async () => {
    const id = addItem(db, vehicleId, { interval_km: 1000 });
    await maintenanceRepo.logService({ item_id: id, vehicle_id: vehicleId, date: '2026-01-10', odometer: 100 });
    await maintenanceRepo.logService({ item_id: id, vehicle_id: vehicleId, date: '2026-09-05', odometer: 900 });
    await maintenanceRepo.logService({ item_id: id, vehicle_id: vehicleId, date: '2026-05-20', odometer: 500 });

    const res = await maintenanceRepo.getHistory(id);

    expect(res.data!.map((l) => l.date)).toEqual(['2026-09-05', '2026-05-20', '2026-01-10']);
  });

  it('is empty for an item that was never serviced', async () => {
    expect(await maintenanceRepo.getHistory(addItem(db, vehicleId))).toEqual({ data: [], error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await maintenanceRepo.getHistory(1)).toEqual({ data: null, error: 'Could not load service history.' });
  });
});

// ─── overdue counts / summary ─────────────────────────────────────────────────

describe('getOverdueCount', () => {
  it('counts only overdue items (not due or urgent ones)', async () => {
    addItem(db, vehicleId, { category: 'A', interval_km: 1000, next_due_odo: 4000 }); // overdue
    addItem(db, vehicleId, { category: 'B', interval_km: 1000, next_due_odo: 5100 }); // urgent
    addItem(db, vehicleId, { category: 'C', interval_km: 1000, next_due_odo: 5900 }); // due
    addItem(db, vehicleId, { category: 'D', interval_days: 30, next_due_date: plusDays(-1) }); // overdue by date
    expect(await maintenanceRepo.getOverdueCount(vehicleId, 5000)).toBe(2);
  });

  it('is 0 when the lookup fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await maintenanceRepo.getOverdueCount(vehicleId, 5000)).toBe(0);
  });
});

describe('getOverdueSummary', () => {
  const vehicles = () => db.getAllSync<any>('SELECT id, nickname, current_odometer FROM vehicles ORDER BY id');

  it('has no message when nothing is overdue', async () => {
    addItem(db, vehicleId, { interval_km: 1000, next_due_odo: 9000 });
    expect(await maintenanceRepo.getOverdueSummary(vehicles())).toEqual({ total: 0, message: null });
  });

  it('names the item and vehicle when exactly one is overdue', async () => {
    addItem(db, vehicleId, { category: 'Engine Oil', interval_km: 1000, next_due_odo: 4000 });
    expect(await maintenanceRepo.getOverdueSummary(vehicles())).toEqual({
      total: 1,
      message: '1 item overdue — Engine Oil on Beat',
    });
  });

  it('counts across all vehicles when several are overdue', async () => {
    const second = addVehicle(db, { nickname: 'Aerox', odo: 9000 });
    addItem(db, vehicleId, { category: 'Engine Oil', interval_km: 1000, next_due_odo: 4000 });
    addItem(db, vehicleId, { category: 'Chain', interval_km: 1000, next_due_odo: 4500 });
    addItem(db, second, { category: 'Tyre', interval_km: 1000, next_due_odo: 8000 });

    expect(await maintenanceRepo.getOverdueSummary(vehicles())).toEqual({
      total: 3,
      message: '3 items overdue across your vehicles',
    });
  });

  it('judges each vehicle against its own odometer', async () => {
    const fresh = addVehicle(db, { nickname: 'Fresh', odo: 100 });
    addItem(db, fresh, { interval_km: 1000, next_due_odo: 4000 }); // same target as above, but this bike is at 100 km
    expect((await maintenanceRepo.getOverdueSummary(vehicles())).total).toBe(0);
  });

  it('is empty for no vehicles', async () => {
    expect(await maintenanceRepo.getOverdueSummary([])).toEqual({ total: 0, message: null });
  });

  it('is empty when the lookup fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await maintenanceRepo.getOverdueSummary([{ id: 1, nickname: 'x', current_odometer: 0 }])).toEqual({ total: 0, message: null });
  });
});

// ─── updateItem ───────────────────────────────────────────────────────────────

describe('updateItem', () => {
  it('changes the allowed fields and stamps updated_at', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000 });
    jest.setSystemTime(new Date(2026, 10, 20, 9));
    jest.clearAllMocks();

    const res = await maintenanceRepo.updateItem(id, { interval_km: 8000, interval_days: 120, notes: 'hi', next_due_odo: 9000, next_due_date: '2027-01-01' });

    expect(res).toEqual({ data: undefined, error: null });
    expect(itemRow(id)).toMatchObject({
      interval_km: 8000,
      interval_days: 120,
      notes: 'hi',
      next_due_odo: 9000,
      next_due_date: '2027-01-01',
      updated_at: new Date(2026, 10, 20, 9).toISOString(),
    });
    expect(mSync).toHaveBeenCalledTimes(1);
  });

  it('ignores fields it does not allow (e.g. category, vehicle_id)', async () => {
    const id = addItem(db, vehicleId, { category: 'Oil' });
    await maintenanceRepo.updateItem(id, { category: 'Hacked', vehicle_id: 999, notes: 'ok' } as any);
    expect(itemRow(id)).toMatchObject({ category: 'Oil', vehicle_id: vehicleId, notes: 'ok' });
  });

  it('does nothing — and no re-check — when no allowed field is given', async () => {
    const id = addItem(db, vehicleId);
    jest.clearAllMocks();
    expect(await maintenanceRepo.updateItem(id, {})).toEqual({ data: undefined, error: null });
    expect(await maintenanceRepo.updateItem(id, { category: 'x' } as any)).toEqual({ data: undefined, error: null });
    expect(mSync).not.toHaveBeenCalled();
  });

  it('can clear a value back to null', async () => {
    const id = addItem(db, vehicleId, { interval_km: 5000 });
    await maintenanceRepo.updateItem(id, { interval_km: null as any });
    expect(itemRow(id).interval_km).toBeNull();
  });

  it('returns a friendly error when the update fails', async () => {
    failNextWrite();
    expect(await maintenanceRepo.updateItem(1, { notes: 'x' })).toEqual({ data: null, error: 'Could not update item.' });
  });
});
