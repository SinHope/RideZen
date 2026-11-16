// Migration V9 adds the maintenance_notify_log table.
// Module under test (EXISTS, needs change): src/db/migrations.ts  (CURRENT_VERSION 8 → 9)

jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { runMigrations } from '@/db/migrations';

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

function fakeDb(version: number) {
  const executed: string[] = [];
  return {
    executed,
    getFirstSync: jest.fn(() => ({ user_version: version })),
    getAllSync: jest.fn(() => []),
    execSync: jest.fn((sql: string) => {
      executed.push(norm(sql));
    }),
    runSync: jest.fn(),
  };
}

describe('upgrading from v8', () => {
  it('creates maintenance_notify_log with its key and cascade', async () => {
    const db = fakeDb(8);
    await runMigrations(db as any);

    const create = db.executed.find((s) => /CREATE TABLE IF NOT EXISTS maintenance_notify_log/i.test(s));
    expect(create).toBeDefined();
    expect(create).toMatch(/item_id INTEGER NOT NULL REFERENCES maintenance_items\(id\) ON DELETE CASCADE/i);
    expect(create).toMatch(/level TEXT NOT NULL/i);
    expect(create).toMatch(/fire_at TEXT NOT NULL/i);
    expect(create).toMatch(/PRIMARY KEY \(item_id, level\)/i);
  });

  it('ends on schema version 9', async () => {
    const db = fakeDb(8);
    await runMigrations(db as any);
    expect(db.executed[db.executed.length - 1]).toBe('PRAGMA user_version = 9');
  });

  it('does not rerun the older migrations', async () => {
    const db = fakeDb(8);
    await runMigrations(db as any);
    expect(db.executed.filter((s) => /CREATE TABLE IF NOT EXISTS (vehicles|fuel_logs|app_settings)/i.test(s))).toEqual([]);
  });
});

describe('already on v9', () => {
  it('only restamps the version', async () => {
    const db = fakeDb(9);
    await runMigrations(db as any);
    expect(db.executed).toEqual(['PRAGMA user_version = 9']);
  });
});
