/**
 * reminderCheck — the rules behind the due / urgent / overdue badges (and, through the notification planner,
 * behind every maintenance push notification). Defaults: due ≤ 1000 km / 14 days, urgent ≤ 200 km / 3 days.
 */
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import type { MaintenanceItem } from '@/types';
import {
  DEFAULT_THRESHOLDS,
  STATUS_RANK,
  addLocalDays,
  computeMaintenanceStatus,
  loadStatusThresholds,
  localDaysBetween,
  parseLocalDate,
} from '@/utils/reminderCheck';
import { TestDb, createMigratedDb, getCurrentDb, setCurrentDb } from '../helpers/testDb';

const NOW = new Date(2026, 10, 17, 12, 0, 0); // 17 Nov 2026, local noon

/** YYYY-MM-DD, n calendar days from NOW. */
const dateIn = (n: number) => {
  const d = new Date(2026, 10, 17 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const item = (over: Partial<MaintenanceItem> = {}): MaintenanceItem => ({
  id: 1,
  vehicle_id: 1,
  category: 'Engine Oil',
  vehicle_type_scope: 'universal',
  updated_at: '2026-01-01',
  ...over,
});
const status = (over: Partial<MaintenanceItem>, odo = 5000) => computeMaintenanceStatus(item(over), odo, DEFAULT_THRESHOLDS, NOW);

// ─── local-date helpers ───────────────────────────────────────────────────────

describe('parseLocalDate', () => {
  it('reads YYYY-MM-DD as that calendar day at local midnight', () => {
    const d = parseLocalDate('2026-11-20')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 20, 0, 0]);
  });

  it('reads an ISO date-time as the local calendar day of that moment', () => {
    const iso = '2026-11-20T23:30:00.000Z';
    const asDate = new Date(iso);
    expect(parseLocalDate(iso)).toEqual(new Date(asDate.getFullYear(), asDate.getMonth(), asDate.getDate()));
  });

  it.each([null, undefined, '', 'not a date', '2026-13-45T99:99'])('returns null for %p', (value) => {
    expect(parseLocalDate(value as any)).toBeNull();
  });
});

describe('addLocalDays', () => {
  it('moves by whole calendar days and stays at midnight', () => {
    const d = addLocalDays(new Date(2026, 10, 17, 15, 30), 14);
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([11, 1, 0, 0]); // 1 Dec, midnight
  });

  it('crosses month and year ends', () => {
    expect(addLocalDays(new Date(2026, 11, 30), 3)).toEqual(new Date(2027, 0, 2));
    expect(addLocalDays(new Date(2026, 1, 27), 2)).toEqual(new Date(2026, 2, 1));
  });

  it('goes backwards with a negative number', () => {
    expect(addLocalDays(new Date(2026, 0, 1), -1)).toEqual(new Date(2025, 11, 31));
  });
});

describe('localDaysBetween', () => {
  it('counts whole days, positive going forward and negative going back', () => {
    expect(localDaysBetween(new Date(2026, 10, 17), new Date(2026, 10, 20))).toBe(3);
    expect(localDaysBetween(new Date(2026, 10, 20), new Date(2026, 10, 17))).toBe(-3);
    expect(localDaysBetween(new Date(2026, 10, 17), new Date(2026, 10, 17))).toBe(0);
  });

  it('counts across a year end', () => {
    expect(localDaysBetween(new Date(2026, 11, 31), new Date(2027, 0, 1))).toBe(1);
  });
});

// ─── status by km ─────────────────────────────────────────────────────────────

describe('status by kilometres (odometer 5,000)', () => {
  const kmStatus = (nextDue: number) => status({ interval_km: 5000, next_due_odo: nextDue }).status;

  it.each([
    [6001, 'ok'], // 1,001 km left
    [6000, 'due'], // exactly 1,000 km left → early-warning window opens
    [5201, 'due'],
    [5200, 'urgent'], // exactly 200 km left → final window
    [5001, 'urgent'],
    [5000, 'overdue'], // 0 km left
    [4000, 'overdue'],
  ])('next due at %i km → %s', (nextDue, expected) => {
    expect(kmStatus(nextDue)).toBe(expected);
  });

  it('reports km remaining (negative once past)', () => {
    expect(status({ interval_km: 5000, next_due_odo: 5700 }).km_remaining).toBe(700);
    expect(status({ interval_km: 5000, next_due_odo: 4900 }).km_remaining).toBe(-100);
  });

  it('only counts km when the item has BOTH a next-due km and an interval', () => {
    expect(status({ next_due_odo: 4000 }).status).toBe('ok'); // no interval_km
    expect(status({ interval_km: 5000 }).status).toBe('ok'); // no next_due_odo
    expect(status({ next_due_odo: 4000 }).km_remaining).toBeUndefined();
  });
});

// ─── status by date ───────────────────────────────────────────────────────────

describe('status by date (today is 17 Nov 2026)', () => {
  const dateStatus = (days: number) => status({ next_due_date: dateIn(days) }).status;

  it.each([
    [15, 'ok'],
    [14, 'due'], // 14 days → early-warning window opens
    [4, 'due'],
    [3, 'urgent'], // 3 days → final window
    [0, 'urgent'], // due TODAY is urgent, not yet overdue
    [-1, 'overdue'], // yesterday
    [-30, 'overdue'],
  ])('due in %i days → %s', (days, expected) => {
    expect(dateStatus(days)).toBe(expected);
  });

  it('reports days remaining (negative once past)', () => {
    expect(status({ next_due_date: dateIn(10) }).days_remaining).toBe(10);
    expect(status({ next_due_date: dateIn(-2) }).days_remaining).toBe(-2);
  });

  it('is not thrown off by the time of day', () => {
    const late = computeMaintenanceStatus(item({ next_due_date: dateIn(0) }), 0, DEFAULT_THRESHOLDS, new Date(2026, 10, 17, 23, 59));
    const early = computeMaintenanceStatus(item({ next_due_date: dateIn(0) }), 0, DEFAULT_THRESHOLDS, new Date(2026, 10, 17, 0, 1));
    expect(late.status).toBe('urgent');
    expect(early.status).toBe('urgent');
  });

  it('ignores an unreadable date', () => {
    expect(status({ next_due_date: 'garbage' })).toMatchObject({ status: 'ok', days_remaining: undefined });
  });
});

// ─── combining km and date ────────────────────────────────────────────────────

describe('items with both a km and a date due', () => {
  it('shows the more severe of the two', () => {
    expect(status({ interval_km: 5000, next_due_odo: 9000, next_due_date: dateIn(-1) }).status).toBe('overdue'); // date is overdue
    expect(status({ interval_km: 5000, next_due_odo: 4000, next_due_date: dateIn(100) }).status).toBe('overdue'); // km is overdue
    expect(status({ interval_km: 5000, next_due_odo: 5100, next_due_date: dateIn(10) }).status).toBe('urgent'); // urgent beats due
    expect(status({ interval_km: 5000, next_due_odo: 5900, next_due_date: dateIn(2) }).status).toBe('urgent');
  });

  it('is ok only when both are comfortably far off', () => {
    expect(status({ interval_km: 5000, next_due_odo: 9000, next_due_date: dateIn(200) }).status).toBe('ok');
  });
});

describe('items with nothing to track', () => {
  it('stay ok with no progress (e.g. Vehicle Wash)', () => {
    expect(status({})).toMatchObject({ status: 'ok', progress_pct: 0, km_remaining: undefined, days_remaining: undefined });
  });
});

// ─── progress bar ─────────────────────────────────────────────────────────────

describe('progress_pct', () => {
  it('is the share of the km interval already used', () => {
    expect(status({ interval_km: 5000, next_due_odo: 6000 }).progress_pct).toBeCloseTo(80); // 4,000 of 5,000
    expect(status({ interval_km: 5000, next_due_odo: 10000 }).progress_pct).toBeCloseTo(0);
  });

  it('is the share of the day interval already used', () => {
    expect(status({ interval_days: 90, next_due_date: dateIn(45) }).progress_pct).toBeCloseTo(50);
  });

  it('takes the larger of km and date progress', () => {
    const r = status({ interval_km: 5000, next_due_odo: 9000, interval_days: 100, next_due_date: dateIn(10) });
    expect(r.progress_pct).toBeCloseTo(90); // date: 90 of 100 days beats km: 1,000 of 5,000
  });

  it('stops at 100% once overdue and never goes below 0%', () => {
    expect(status({ interval_km: 5000, next_due_odo: 4000 }).progress_pct).toBe(100);
    expect(status({ interval_km: 5000, next_due_odo: 99999 }).progress_pct).toBe(0);
    expect(status({ interval_days: 30, next_due_date: dateIn(-10) }).progress_pct).toBe(100);
    expect(status({ interval_days: 30, next_due_date: dateIn(500) }).progress_pct).toBe(0);
  });

  it('is 0 for a date with no interval to measure against', () => {
    expect(status({ next_due_date: dateIn(5) }).progress_pct).toBe(0);
  });
});

describe('thresholds and result shape', () => {
  it('uses the thresholds it is given', () => {
    const custom = { earlyKm: 100, earlyDays: 2, finalKm: 10, finalDays: 1 };
    const r = computeMaintenanceStatus(item({ interval_km: 5000, next_due_odo: 5500 }), 5000, custom, NOW);
    expect(r.status).toBe('ok'); // 500 km left is outside a 100 km window
  });

  it('does not change the item it was given, and keeps its other fields', () => {
    const original = item({ category: 'Chain', interval_km: 5000, next_due_odo: 4000 });
    const r = computeMaintenanceStatus(original, 5000, DEFAULT_THRESHOLDS, NOW);
    expect(r.category).toBe('Chain');
    expect(original.status).toBeUndefined();
  });

  it('ranks statuses from calm to severe', () => {
    expect(STATUS_RANK).toEqual({ ok: 0, due: 1, urgent: 2, overdue: 3 });
  });
});

// ─── thresholds saved in Settings ─────────────────────────────────────────────

describe('loadStatusThresholds', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createMigratedDb();
    setCurrentDb(db);
  });
  afterEach(() => setCurrentDb(null));

  const save = (key: string, value: string) => db.runSync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);

  it('falls back to the defaults when nothing was saved', () => {
    expect(loadStatusThresholds()).toEqual({ earlyKm: 1000, earlyDays: 14, finalKm: 200, finalDays: 3 });
  });

  it('reads what Settings saved', () => {
    save('early_warning_km', '1500');
    save('early_warning_days', '30');
    save('final_reminder_km', '300');
    save('final_reminder_days', '7');
    expect(loadStatusThresholds()).toEqual({ earlyKm: 1500, earlyDays: 30, finalKm: 300, finalDays: 7 });
  });

  it('accepts decimals', () => {
    save('early_warning_km', '750.5');
    expect(loadStatusThresholds().earlyKm).toBe(750.5);
  });

  it('uses the default for any value that is zero, negative or not a number', () => {
    save('early_warning_km', '0');
    save('early_warning_days', '-5');
    save('final_reminder_km', 'abc');
    save('final_reminder_days', '');
    expect(loadStatusThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('mixes saved and default values', () => {
    save('final_reminder_days', '5');
    expect(loadStatusThresholds()).toEqual({ ...DEFAULT_THRESHOLDS, finalDays: 5 });
  });

  it('falls back to the defaults (never throws) when the database fails', () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(loadStatusThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('returns a copy, so callers cannot change the shared defaults', () => {
    jest.spyOn(getCurrentDb(), 'getFirstSync').mockImplementation(() => {
      throw new Error('locked');
    });
    const t = loadStatusThresholds();
    t.earlyKm = 1;
    expect(DEFAULT_THRESHOLDS.earlyKm).toBe(1000);
  });
});
