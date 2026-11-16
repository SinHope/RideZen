/**
 * reminderRepo — the legacy per-item reminder_settings table. The app no longer reads it for notifications
 * (levels now come from the Settings thresholds), but seeds still write it and the repo stays available.
 */
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import { reminderRepo } from '@/repositories/reminderRepo';
import { logToFile } from '@/utils/logger';
import { TestDb, addItem, addVehicle, createMigratedDb, getCurrentDb, setCurrentDb } from '../helpers/testDb';

let db: TestDb;
let itemId: number;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createMigratedDb();
  setCurrentDb(db);
  const v = addVehicle(db, { nickname: 'Beat' });
  itemId = addItem(db, v, { category: 'Engine Oil', next_due_odo: 6000, next_due_date: '2027-01-01' });
  db.runSync(
    `INSERT INTO reminder_settings (item_id, early_km_before, early_days_before, final_km_before, final_days_before)
     VALUES (?, 1000, 14, 200, 3)`,
    [itemId]
  );
});
afterEach(() => setCurrentDb(null));

describe('getByItem', () => {
  it('reads the settings for an item', async () => {
    const res = await reminderRepo.getByItem(itemId);
    expect(res.data).toMatchObject({ item_id: itemId, early_km_before: 1000, early_days_before: 14, final_km_before: 200, final_days_before: 3 });
  });

  it('is null (not an error) for an item without settings', async () => {
    expect(await reminderRepo.getByItem(999)).toEqual({ data: null, error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await reminderRepo.getByItem(itemId)).toEqual({ data: null, error: 'Could not load reminder settings.' });
    expect(logToFile).toHaveBeenCalledWith('DB_ERROR', 'reminderRepo.getByItem', expect.any(String));
  });
});

describe('update', () => {
  it('changes only the allowed reminder fields', async () => {
    const res = await reminderRepo.update(itemId, { early_km_before: 1500, final_enabled: 0 });
    expect(res).toEqual({ data: undefined, error: null });
    expect(db.getFirstSync<any>('SELECT * FROM reminder_settings WHERE item_id = ?', [itemId])).toMatchObject({
      early_km_before: 1500,
      final_enabled: 0,
      early_days_before: 14, // untouched
    });
  });

  it('ignores anything else (e.g. item_id, id)', async () => {
    await reminderRepo.update(itemId, { item_id: 999, early_km_before: 1 } as any);
    expect(db.getFirstSync<any>('SELECT item_id FROM reminder_settings WHERE early_km_before = 1')!.item_id).toBe(itemId);
  });

  it('does nothing when there is nothing allowed to change', async () => {
    const spy = jest.spyOn(getCurrentDb(), 'runSync');
    expect(await reminderRepo.update(itemId, {})).toEqual({ data: undefined, error: null });
    expect(await reminderRepo.update(itemId, { id: 5 } as any)).toEqual({ data: undefined, error: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns a friendly error when the update fails', async () => {
    jest.spyOn(getCurrentDb(), 'runSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await reminderRepo.update(itemId, { early_km_before: 5 })).toEqual({ data: null, error: 'Could not update reminder settings.' });
  });
});

describe('getAll', () => {
  it('joins each reminder with its item and vehicle', async () => {
    const res = await reminderRepo.getAll();
    expect(res.data).toHaveLength(1);
    expect(res.data![0]).toMatchObject({
      item_id: itemId,
      category: 'Engine Oil',
      vehicle_nickname: 'Beat',
      next_due_odo: 6000,
      next_due_date: '2027-01-01',
      early_km_before: 1000,
    });
  });

  it('is empty when there are no reminders', async () => {
    db.runSync('DELETE FROM reminder_settings');
    expect(await reminderRepo.getAll()).toEqual({ data: [], error: null });
  });

  it('returns a friendly error when the database fails', async () => {
    jest.spyOn(getCurrentDb(), 'getAllSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(await reminderRepo.getAll()).toEqual({ data: null, error: 'Could not load reminders.' });
  });
});
