/**
 * A REAL SQLite database (sql.js, WebAssembly) behind the same synchronous API as expo-sqlite
 * (execSync / runSync / getAllSync / getFirstSync), so repository, seed and migration tests run the
 * app's actual SQL — constraints, cascades, aggregates — instead of string-matching it.
 *
 * Usage in a test file:
 *   jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));
 *   beforeEach(async () => { setCurrentDb(await createMigratedDb()); });
 */
import fs from 'fs';
import path from 'path';
import { runMigrations } from '@/db/migrations';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const initSqlJs = require('sql.js');

let SQL: any;

async function loadEngine() {
  if (!SQL) {
    // jest-expo's setup (expo/src/winter) replaces the global TextDecoder with a polyfill that cannot decode
    // WebAssembly memory — sql.js then fails to open ANY database, with an empty error message. Use Node's own
    // decoder while the engine initialises (it captures the decoder once, at start-up), then put the polyfill back.
    const g = global as any;
    const util = require('util');
    const saved = { decoder: g.TextDecoder, encoder: g.TextEncoder };
    g.TextDecoder = util.TextDecoder;
    g.TextEncoder = util.TextEncoder;
    try {
      const wasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
      SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
    } finally {
      g.TextDecoder = saved.decoder;
      g.TextEncoder = saved.encoder;
    }
  }
  return SQL;
}

export class TestDb {
  constructor(private raw: any) {}

  execSync(sql: string): void {
    this.raw.exec(sql);
  }

  runSync(sql: string, params: any[] = []): { lastInsertRowId: number; changes: number } {
    this.raw.run(sql, params);
    const changes: number = this.raw.getRowsModified();
    const lastInsertRowId: number = this.raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { lastInsertRowId, changes };
  }

  getAllSync<T = any>(sql: string, params: any[] = []): T[] {
    const stmt = this.raw.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  getFirstSync<T = any>(sql: string, params: any[] = []): T | null {
    return this.getAllSync<T>(sql, params)[0] ?? null;
  }

  /** Test-only: list a table's rows without writing SQL at every call site. */
  all<T = any>(table: string, orderBy = 'rowid'): T[] {
    return this.getAllSync<T>(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
  }

  count(table: string): number {
    return this.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
  }

  version(): number {
    return this.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version;
  }

  columns(table: string): string[] {
    return this.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
  }

  tables(): string[] {
    return this.getAllSync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).map((t) => t.name);
  }

  close(): void {
    this.raw.close();
  }
}

/** An empty database (user_version 0, no tables). */
export async function createEmptyDb(): Promise<TestDb> {
  const engine = await loadEngine();
  return new TestDb(new engine.Database());
}

/** A fresh install: every migration applied, exactly as the app does on first launch. */
export async function createMigratedDb(): Promise<TestDb> {
  const db = await createEmptyDb();
  await runMigrations(db as any);
  return db;
}

// ─── The "current" database the mocked `@/db/client` hands out ────────────────

// Held on globalThis (not a module variable) so it survives jest.resetModules() / isolateModules, which
// re-evaluate this file and would otherwise hand the mocked `@/db/client` a different, empty holder.
const HOLDER = '__ridezenTestDb';

export function setCurrentDb(db: TestDb | null): void {
  const previous: TestDb | null = (globalThis as any)[HOLDER] ?? null;
  if (previous && previous !== db) {
    try {
      previous.close();
    } catch {
      // already closed
    }
  }
  (globalThis as any)[HOLDER] = db;
}

export function getCurrentDb(): TestDb {
  const current: TestDb | null = (globalThis as any)[HOLDER] ?? null;
  if (!current) throw new Error('testDb: no current database — call setCurrentDb() in beforeEach');
  return current;
}

// ─── Small fixtures ───────────────────────────────────────────────────────────

export function addVehicle(
  db: TestDb,
  over: Partial<{ nickname: string; type: string; odo: number }> = {}
): number {
  return db.runSync(
    `INSERT INTO vehicles (nickname, type, current_odometer) VALUES (?, ?, ?)`,
    [over.nickname ?? 'Beat', over.type ?? 'scooter', over.odo ?? 1000]
  ).lastInsertRowId;
}

export function addItem(
  db: TestDb,
  vehicleId: number,
  over: Partial<{
    category: string;
    interval_km: number | null;
    interval_days: number | null;
    next_due_odo: number | null;
    next_due_date: string | null;
  }> = {}
): number {
  return db.runSync(
    `INSERT INTO maintenance_items
       (vehicle_id, category, vehicle_type_scope, interval_km, interval_days, next_due_odo, next_due_date)
     VALUES (?, ?, 'universal', ?, ?, ?, ?)`,
    [
      vehicleId,
      over.category ?? 'Engine Oil',
      over.interval_km ?? null,
      over.interval_days ?? null,
      over.next_due_odo ?? null,
      over.next_due_date ?? null,
    ]
  ).lastInsertRowId;
}

/**
 * Freeze ONLY the clock (Date / new Date()). Timers and promises keep running normally, so async code
 * under test still works. Local noon is used so the UTC and local calendar dates agree in any timezone.
 */
export function freezeClock(year: number, monthIndex: number, day: number, hour = 12, minute = 0): void {
  jest.useFakeTimers({
    now: new Date(year, monthIndex, day, hour, minute, 0),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

export function unfreezeClock(): void {
  jest.useRealTimers();
}
