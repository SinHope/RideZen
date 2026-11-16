// "Which level did we already tell the rider about?" — maintenance_notify_log access.
// Module under test (NOT YET IMPLEMENTED): src/repositories/notifyLogRepo.ts
//
// Expected export (synchronous; the sync routine catches errors):
//   notifyLogRepo.getAll(): { item_id, level, fire_at }[]
//   notifyLogRepo.upsert(rows)         INSERT OR REPLACE, one statement per row; [] → no DB call
//   notifyLogRepo.remove(refs)         DELETE one row per { itemId, level }; [] → no DB call
//   notifyLogRepo.deleteFuture(nowIso) DELETE rows whose fire_at is after nowIso (cancelled schedules)
// fire_at is an ISO-8601 UTC string, so plain string comparison orders it correctly.

jest.mock('@/db/client', () => ({ getDb: jest.fn() }));

import { getDb } from '@/db/client';
import { notifyLogRepo } from '@/repositories/notifyLogRepo';

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

let db: { getAllSync: jest.Mock; runSync: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  db = { getAllSync: jest.fn().mockReturnValue([]), runSync: jest.fn() };
  (getDb as jest.Mock).mockReturnValue(db);
});

describe('getAll', () => {
  it('reads every row of the log', () => {
    const rows = [{ item_id: 1, level: 'due', fire_at: '2026-11-16T01:00:00.000Z' }];
    db.getAllSync.mockReturnValue(rows);
    expect(notifyLogRepo.getAll()).toEqual(rows);
    expect(norm(db.getAllSync.mock.calls[0][0])).toMatch(
      /^SELECT item_id, level, fire_at FROM maintenance_notify_log$/i
    );
  });
});

describe('upsert', () => {
  it('writes one INSERT OR REPLACE per row', () => {
    notifyLogRepo.upsert([
      { item_id: 1, level: 'due', fire_at: '2026-11-16T01:00:00.000Z' },
      { item_id: 2, level: 'urgent', fire_at: '2026-11-27T01:00:00.000Z' },
    ]);
    expect(db.runSync).toHaveBeenCalledTimes(2);
    expect(norm(db.runSync.mock.calls[0][0])).toMatch(/^INSERT OR REPLACE INTO maintenance_notify_log/i);
    expect(db.runSync.mock.calls[0][1]).toEqual([1, 'due', '2026-11-16T01:00:00.000Z']);
    expect(db.runSync.mock.calls[1][1]).toEqual([2, 'urgent', '2026-11-27T01:00:00.000Z']);
  });

  it('does nothing for an empty list', () => {
    notifyLogRepo.upsert([]);
    expect(db.runSync).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('deletes the exact (item, level) rows', () => {
    notifyLogRepo.remove([
      { itemId: 1, level: 'overdue' },
      { itemId: 5, level: 'due' },
    ]);
    expect(db.runSync).toHaveBeenCalledTimes(2);
    expect(norm(db.runSync.mock.calls[0][0])).toMatch(
      /^DELETE FROM maintenance_notify_log WHERE item_id = \? AND level = \?$/i
    );
    expect(db.runSync.mock.calls[0][1]).toEqual([1, 'overdue']);
    expect(db.runSync.mock.calls[1][1]).toEqual([5, 'due']);
  });

  it('does nothing for an empty list', () => {
    notifyLogRepo.remove([]);
    expect(db.runSync).not.toHaveBeenCalled();
  });
});

describe('deleteFuture', () => {
  it('removes rows scheduled after now (their notifications were just cancelled)', () => {
    notifyLogRepo.deleteFuture('2026-11-16T00:00:00.000Z');
    expect(norm(db.runSync.mock.calls[0][0])).toMatch(
      /^DELETE FROM maintenance_notify_log WHERE fire_at > \?$/i
    );
    expect(db.runSync.mock.calls[0][1]).toEqual(['2026-11-16T00:00:00.000Z']);
  });
});
