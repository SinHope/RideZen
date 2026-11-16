/**
 * @jest-environment <rootDir>/__tests__/helpers/tzLosAngelesEnv.js
 */

// Due dates are stored as plain "YYYY-MM-DD" strings. `new Date('2026-11-20')` is UTC midnight,
// which in a negative-UTC timezone (e.g. Los Angeles) is still the 19th — so a due date could be read
// one day early. Notifications and badges must both read it as the LOCAL calendar day.
//
// The environment above runs this file in America/Los_Angeles (see __tests__/helpers/tzLosAngelesEnv.js).
// Every other test file runs in the machine's own timezone (Singapore on the dev machine, UTC+8), so both
// signs of the UTC offset are covered.

import type { MaintenanceItem } from '@/types';
import { DEFAULT_THRESHOLDS, computeMaintenanceStatus } from '@/utils/reminderCheck';
import { planMaintenanceNotifications } from '@/notifications/maintenancePlanner';

const item = (due: string): MaintenanceItem =>
  ({
    id: 1,
    vehicle_id: 1,
    category: 'Chain Lube',
    vehicle_type_scope: 'universal',
    next_due_date: due,
    interval_days: 365,
    updated_at: '',
  }) as MaintenanceItem;

describe('running in a negative-UTC timezone', () => {
  it('sanity: the test really runs in Los Angeles', () => {
    // January → UTC-8 (480 minutes behind). If TZ switching ever stops working this flags it.
    expect(new Date(2026, 0, 15, 12, 0).getTimezoneOffset()).toBe(480);
  });

  it('the badge reads the due date as that local day (due today is not overdue)', () => {
    const noon = new Date(2026, 10, 20, 12, 0);
    const r = computeMaintenanceStatus(item('2026-11-20'), 0, DEFAULT_THRESHOLDS, noon);
    expect(r.days_remaining).toBe(0);
    expect(r.status).toBe('urgent');
  });

  it('the day after the due date is overdue', () => {
    const r = computeMaintenanceStatus(item('2026-11-20'), 0, DEFAULT_THRESHOLDS, new Date(2026, 10, 21, 12, 0));
    expect(r.days_remaining).toBe(-1);
    expect(r.status).toBe('overdue');
  });

  it('schedules on the right local days', () => {
    const r = planMaintenanceNotifications({
      entries: [{ item: item('2026-11-20'), vehicleId: 1, vehicleNickname: 'Beat', odometer: 0 }],
      thresholds: DEFAULT_THRESHOLDS,
      log: [],
      now: new Date(2026, 10, 1, 8, 0),
      notifyTime: '09:00',
      grouped: false,
    });
    const days = r.schedule.map((s) => [s.items[0].level, s.fireAt.getMonth(), s.fireAt.getDate(), s.fireAt.getHours()]);
    expect(days).toEqual([
      ['due', 10, 6, 9], //     20 Nov − 14 days = 6 Nov
      ['urgent', 10, 17, 9], // 20 Nov − 3 days  = 17 Nov
      ['overdue', 10, 21, 9], // 20 Nov + 1 day   = 21 Nov
    ]);
  });
});
