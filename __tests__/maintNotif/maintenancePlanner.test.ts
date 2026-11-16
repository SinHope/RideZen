// Maintenance notification planner — the pure decision logic (no I/O).
// Module under test (NOT YET IMPLEMENTED): src/notifications/maintenancePlanner.ts
//
// Expected exports:
//   LEVELS                       = ['due', 'urgent', 'overdue']
//   MAINT_ID_PREFIX              = 'maint-'
//   maintenanceIdentifier(itemId, level) → 'maint-<itemId>-<level>'
//   isMaintenanceIdentifier(id)  → id starts with 'maint-'
//   planMaintenanceNotifications({ entries, thresholds, log, now, notifyTime, grouped }) → {
//     notifyNow: PlannedNotification[]      // send immediately (km reached, or a date level whose time has passed)
//     schedule:  ScheduledNotification[]    // future date levels, with fireAt
//     clearLog:  { itemId, level }[]        // log rows to delete (item back to ok / dropped a level / orphan)
//     markSent:  { itemId, level }[]        // item dropped a level: record the lower level as already told
//   }
//   PlannedNotification = { identifier, payload: { title, body, data }, items: { itemId, level }[] }
//
// Rules (agreed in docs/maintenance-notifications-plan.md):
//   - Level = the same Settings thresholds that drive the badge (computeMaintenanceStatus).
//   - One notification per level; no repeats while overdue; reset when the item is ok again.
//   - Date-based levels fire at the user's notify time on the day the level starts.
//   - km-based levels fire as soon as they are noticed.

import type { MaintenanceItem } from '@/types';
import { DEFAULT_THRESHOLDS } from '@/utils/reminderCheck';
import {
  planMaintenanceNotifications,
  maintenanceIdentifier,
  isMaintenanceIdentifier,
  MAINT_ID_PREFIX,
  LEVELS,
} from '@/notifications/maintenancePlanner';
import type {
  PlannerEntry,
  PlanInput,
  NotifyLogRow,
} from '@/notifications/maintenancePlanner';

// Mon 16 Nov 2026, 08:00 local. Defaults: early 1000 km / 14 d, final 200 km / 3 d.
const NOW = new Date(2026, 10, 16, 8, 0, 0);

function makeItem(over: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: 1,
    vehicle_id: 1,
    category: 'Oil Change',
    vehicle_type_scope: 'universal',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  } as MaintenanceItem;
}
const kmItem = (over: Partial<MaintenanceItem> = {}) =>
  makeItem({ next_due_odo: 2000, interval_km: 2000, ...over });
const dateItem = (due: string, over: Partial<MaintenanceItem> = {}) =>
  makeItem({ next_due_date: due, interval_days: 365, ...over });

function entry(item: MaintenanceItem, odometer = 0, nickname = 'Beat'): PlannerEntry {
  return { item, vehicleId: item.vehicle_id, vehicleNickname: nickname, odometer };
}

function plan(entries: PlannerEntry[], over: Partial<PlanInput> = {}) {
  return planMaintenanceNotifications({
    entries,
    thresholds: DEFAULT_THRESHOLDS,
    log: [],
    now: NOW,
    notifyTime: '09:00',
    grouped: false,
    ...over,
  });
}

// local date-time helper, month is 1-based for readability
const at = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const row = (itemId: number, level: string, when: Date): NotifyLogRow => ({
  item_id: itemId,
  level: level as NotifyLogRow['level'],
  fire_at: when.toISOString(),
});
const levelsOf = (list: { items: { level: string }[] }[]) => list.map((n) => n.items.map((i) => i.level));
const fireTimes = (r: ReturnType<typeof plan>) =>
  r.schedule.map((s) => [s.items[0].level, s.fireAt.getTime()]);

describe('identifiers', () => {
  it('uses the maint- prefix and item + level', () => {
    expect(MAINT_ID_PREFIX).toBe('maint-');
    expect(maintenanceIdentifier(7, 'urgent')).toBe('maint-7-urgent');
    expect(isMaintenanceIdentifier('maint-7-urgent')).toBe(true);
    expect(isMaintenanceIdentifier('maint-summary-123')).toBe(true);
    expect(isMaintenanceIdentifier('ridezen-gps-idle')).toBe(false);
  });

  it('knows the three levels in order', () => {
    expect([...LEVELS]).toEqual(['due', 'urgent', 'overdue']);
  });
});

// ─── Level comes from the Settings thresholds ─────────────────────────────────

describe('level follows the Settings thresholds (same as the badge)', () => {
  // Oil change due at 2000 km; early warning 1000 km, final reminder 200 km
  it.each([
    [999, null], // 1001 km left → ok
    [1000, 'due'], // exactly the early threshold
    [1799, 'due'],
    [1800, 'urgent'], // exactly the final threshold
    [1999, 'urgent'],
    [2000, 'overdue'], // 0 km left
    [2150, 'overdue'],
  ])('odometer %i → %s', (odo, level) => {
    const r = plan([entry(kmItem(), odo)]);
    if (level === null) {
      expect(r.notifyNow).toHaveLength(0);
    } else {
      expect(r.notifyNow).toHaveLength(1);
      expect(r.notifyNow[0].items).toEqual([{ itemId: 1, level }]);
    }
  });

  it('moves with the thresholds: final reminder 300 km → urgent from 1700', () => {
    const t = { ...DEFAULT_THRESHOLDS, finalKm: 300 };
    expect(levelsOf(plan([entry(kmItem(), 1700)], { thresholds: t }).notifyNow)).toEqual([['urgent']]);
    expect(levelsOf(plan([entry(kmItem(), 1699)], { thresholds: t }).notifyNow)).toEqual([['due']]);
  });

  it('a km-only item never schedules anything for later', () => {
    expect(plan([entry(kmItem(), 500)]).schedule).toEqual([]);
  });

  it('an item with no due values is ignored', () => {
    const r = plan([entry(makeItem(), 5000)]);
    expect(r.notifyNow).toEqual([]);
    expect(r.schedule).toEqual([]);
    expect(r.clearLog).toEqual([]);
  });

  it('no entries, no work', () => {
    expect(plan([])).toEqual({ notifyNow: [], schedule: [], clearLog: [], markSent: [] });
  });
});

// ─── Wording ──────────────────────────────────────────────────────────────────

describe('notification content', () => {
  it('due soon (km)', () => {
    const [n] = plan([entry(kmItem(), 1000)]).notifyNow;
    expect(n.identifier).toBe('maint-1-due');
    expect(n.payload.title).toBe('Service due soon');
    expect(n.payload.body).toBe('Oil Change on Beat: 1000 km left');
    expect(n.payload.data).toEqual({ type: 'maintenance', itemId: 1, vehicleId: 1 });
  });

  it('urgent (km)', () => {
    const [n] = plan([entry(kmItem(), 1850)]).notifyNow;
    expect(n.identifier).toBe('maint-1-urgent');
    expect(n.payload.title).toBe('Service urgent');
    expect(n.payload.body).toBe('Oil Change on Beat: 150 km left');
  });

  it('overdue (km) has its own title and wording', () => {
    const [n] = plan([entry(kmItem(), 2120)]).notifyNow;
    expect(n.identifier).toBe('maint-1-overdue');
    expect(n.payload.title).toBe('Service overdue');
    expect(n.payload.body).toBe('Oil Change on Beat: overdue by 120 km');
  });

  it('rounds partial km up so it never says "0 km left" before it is overdue', () => {
    expect(plan([entry(kmItem(), 1850.4)]).notifyNow[0].payload.body).toBe('Oil Change on Beat: 150 km left');
    expect(plan([entry(kmItem(), 1999.7)]).notifyNow[0].payload.body).toBe('Oil Change on Beat: 1 km left');
  });

  it('exactly at the due odometer reads "due now"', () => {
    expect(plan([entry(kmItem(), 2000)]).notifyNow[0].payload.body).toBe('Oil Change on Beat: due now');
  });

  it('uses the vehicle nickname', () => {
    const [n] = plan([entry(kmItem(), 1850, 'NMAX')]).notifyNow;
    expect(n.payload.body).toBe('Oil Change on NMAX: 150 km left');
  });

  it.each([
    ['2026-11-17', 'due tomorrow'],
    ['2026-11-16', 'due today'],
    ['2026-11-18', 'due in 2 days'],
    ['2026-11-14', 'overdue by 2 days'],
  ])('date-based wording for due date %s → %s', (due, words) => {
    // 10:00 so every level that started on a past day, or today at 09:00, is already notifiable
    const r = plan([entry(dateItem(due))], { now: new Date(2026, 10, 16, 10, 0) });
    expect(r.notifyNow).toHaveLength(1);
    expect(r.notifyNow[0].payload.body).toBe(`Oil Change on Beat: ${words}`);
  });

  it('shows both km and days when both have reached the level', () => {
    // km: 150 left (urgent). date: due in 2 days (urgent, started 13 Nov)
    const item = kmItem({ next_due_date: '2026-11-18', interval_days: 365 });
    const [n] = plan([entry(item, 1850)]).notifyNow;
    expect(n.items).toEqual([{ itemId: 1, level: 'urgent' }]);
    expect(n.payload.body).toBe('Oil Change on Beat: 150 km left · due in 2 days');
  });

  it('only mentions the criterion that actually reached the level', () => {
    // km: urgent (150 left). date: far away (not reached)
    const item = kmItem({ next_due_date: '2027-06-01', interval_days: 365 });
    const [n] = plan([entry(item, 1850)]).notifyNow;
    expect(n.payload.body).toBe('Oil Change on Beat: 150 km left');
  });
});

// ─── Once per level ───────────────────────────────────────────────────────────

describe('one notification per level', () => {
  const past = new Date(2026, 10, 10, 9, 0);

  it('does not repeat a level that was already sent', () => {
    const r = plan([entry(kmItem(), 1200)], { log: [row(1, 'due', past)] });
    expect(r.notifyNow).toEqual([]);
  });

  it('riding on within the same level sends nothing more', () => {
    const log = [row(1, 'due', past)];
    expect(plan([entry(kmItem(), 1300)], { log }).notifyNow).toEqual([]);
    expect(plan([entry(kmItem(), 1700)], { log }).notifyNow).toEqual([]);
  });

  it('sends the next level when it is reached', () => {
    const r = plan([entry(kmItem(), 1850)], { log: [row(1, 'due', past)] });
    expect(levelsOf(r.notifyNow)).toEqual([['urgent']]);
    expect(r.clearLog).toEqual([]);
  });

  it('due → urgent → overdue each notify once', () => {
    const r1 = plan([entry(kmItem(), 1200)]);
    expect(levelsOf(r1.notifyNow)).toEqual([['due']]);
    const r2 = plan([entry(kmItem(), 1850)], { log: [row(1, 'due', past)] });
    expect(levelsOf(r2.notifyNow)).toEqual([['urgent']]);
    const r3 = plan([entry(kmItem(), 2100)], { log: [row(1, 'due', past), row(1, 'urgent', past)] });
    expect(levelsOf(r3.notifyNow)).toEqual([['overdue']]);
  });

  it('jumping straight to overdue sends one notification, not three', () => {
    const r = plan([entry(kmItem(), 2300)]);
    expect(r.notifyNow).toHaveLength(1);
    expect(levelsOf(r.notifyNow)).toEqual([['overdue']]);
  });

  it('no repeat reminders while an item stays overdue', () => {
    const log = [row(1, 'overdue', past)];
    const r = plan([entry(kmItem(), 2500)], { log });
    expect(r.notifyNow).toEqual([]);
    expect(r.schedule).toEqual([]);
    expect(r.clearLog).toEqual([]);
  });

  it('a log row dated in the future does not count as sent', () => {
    const future = row(1, 'due', new Date(2026, 10, 17, 9, 0));
    const r = plan([entry(kmItem(), 1200)], { log: [future] });
    expect(levelsOf(r.notifyNow)).toEqual([['due']]);
    expect(r.clearLog).toEqual([]); // the sync deletes future rows itself
  });

  it('only the levels of its own item count', () => {
    const r = plan([entry(kmItem({ id: 2 }), 1200)], { log: [row(1, 'due', past)] });
    expect(r.notifyNow.map((n) => n.items[0].itemId)).toEqual([2]);
  });
});

// ─── Reset and downgrade ──────────────────────────────────────────────────────

describe('after a service is logged (or the status drops)', () => {
  const past = new Date(2026, 10, 10, 9, 0);

  it('back to ok clears the memory so the next cycle notifies again', () => {
    const r = plan([entry(kmItem(), 100)], { log: [row(1, 'overdue', past)] });
    expect(r.notifyNow).toEqual([]);
    expect(r.clearLog).toEqual([{ itemId: 1, level: 'overdue' }]);
    expect(r.markSent).toEqual([]);
  });

  it('back to ok clears every level row of that item', () => {
    const r = plan([entry(kmItem(), 100)], { log: [row(1, 'due', past), row(1, 'urgent', past)] });
    expect(r.clearLog).toEqual(
      expect.arrayContaining([
        { itemId: 1, level: 'due' },
        { itemId: 1, level: 'urgent' },
      ])
    );
    expect(r.clearLog).toHaveLength(2);
  });

  it('an ok item with nothing logged has nothing to clear', () => {
    expect(plan([entry(kmItem(), 100)]).clearLog).toEqual([]);
  });

  it('dropping from overdue to urgent: forget overdue, remember urgent, send nothing', () => {
    const r = plan([entry(kmItem(), 1850)], { log: [row(1, 'overdue', past)] });
    expect(r.notifyNow).toEqual([]);
    expect(r.clearLog).toEqual([{ itemId: 1, level: 'overdue' }]);
    expect(r.markSent).toEqual([{ itemId: 1, level: 'urgent' }]);
  });

  it('dropping from urgent to due: the next sync must not re-announce "due soon"', () => {
    const r = plan([entry(kmItem(), 1200)], { log: [row(1, 'urgent', past)] });
    expect(r.notifyNow).toEqual([]);
    expect(r.clearLog).toEqual([{ itemId: 1, level: 'urgent' }]);
    expect(r.markSent).toEqual([{ itemId: 1, level: 'due' }]);
  });

  it('rows of items that no longer exist are cleaned up', () => {
    const r = plan([entry(kmItem({ id: 1 }), 100)], { log: [row(99, 'due', past)] });
    expect(r.clearLog).toEqual([{ itemId: 99, level: 'due' }]);
  });
});

// ─── Date-based items: pre-scheduled at the user's time ───────────────────────

describe('date-based items are scheduled for the notify time', () => {
  // Due Mon 30 Nov. Defaults: early 14 d → starts 16 Nov; final 3 d → 27 Nov; overdue → 1 Dec.
  const due = '2026-11-30';

  it('schedules due soon / urgent / overdue on the right days at 09:00', () => {
    const r = plan([entry(dateItem(due))]);
    expect(r.notifyNow).toEqual([]); // 16 Nov 09:00 is still in the future (it is 08:00)
    expect(fireTimes(r)).toEqual([
      ['due', at(2026, 11, 16, 9).getTime()],
      ['urgent', at(2026, 11, 27, 9).getTime()],
      ['overdue', at(2026, 12, 1, 9).getTime()],
    ]);
  });

  it('gives each scheduled notification its own identifier, content and item', () => {
    const r = plan([entry(dateItem(due))]);
    expect(r.schedule.map((s) => s.identifier)).toEqual(['maint-1-due', 'maint-1-urgent', 'maint-1-overdue']);
    expect(r.schedule.map((s) => s.payload.title)).toEqual([
      'Service due soon',
      'Service urgent',
      'Service overdue',
    ]);
    expect(r.schedule.map((s) => s.payload.body)).toEqual([
      'Oil Change on Beat: due in 14 days',
      'Oil Change on Beat: due in 3 days',
      'Oil Change on Beat: overdue by 1 day',
    ]);
    expect(r.schedule[0].payload.data).toEqual({ type: 'maintenance', itemId: 1, vehicleId: 1 });
    expect(r.schedule[1].items).toEqual([{ itemId: 1, level: 'urgent' }]);
  });

  it("uses the user's chosen time", () => {
    const r = plan([entry(dateItem(due))], { notifyTime: '20:30' });
    expect(fireTimes(r)).toEqual([
      ['due', at(2026, 11, 16, 20, 30).getTime()],
      ['urgent', at(2026, 11, 27, 20, 30).getTime()],
      ['overdue', at(2026, 12, 1, 20, 30).getTime()],
    ]);
  });

  it('falls back to 09:00 when the saved time is invalid', () => {
    const r = plan([entry(dateItem(due))], { notifyTime: '25:99' });
    expect(r.schedule[0].fireAt.getTime()).toBe(at(2026, 11, 16, 9).getTime());
  });

  it('follows the Settings thresholds (final reminder 5 days → urgent on 25 Nov)', () => {
    const t = { ...DEFAULT_THRESHOLDS, finalDays: 5 };
    const r = plan([entry(dateItem(due))], { thresholds: t });
    expect(fireTimes(r)[1]).toEqual(['urgent', at(2026, 11, 25, 9).getTime()]);
  });

  it('a far-off date schedules all three levels in the future (365-day service)', () => {
    const r = plan([entry(dateItem('2027-11-16'))]);
    expect(fireTimes(r)).toEqual([
      ['due', at(2027, 11, 2, 9).getTime()],
      ['urgent', at(2027, 11, 13, 9).getTime()],
      ['overdue', at(2027, 11, 17, 9).getTime()],
    ]);
  });

  it('a level whose time has already passed today is sent now instead of skipped', () => {
    const r = plan([entry(dateItem(due))], { now: new Date(2026, 10, 16, 10, 0) });
    expect(levelsOf(r.notifyNow)).toEqual([['due']]);
    expect(r.notifyNow[0].payload.body).toBe('Oil Change on Beat: due in 14 days');
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });

  it('never schedules a time in the past', () => {
    const now = new Date(2026, 11, 2, 12, 0); // after the due date
    const r = plan([entry(dateItem(due))], { now });
    for (const s of r.schedule) expect(s.fireAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('an item that is already overdue by date sends one overdue notice and schedules nothing', () => {
    const r = plan([entry(dateItem('2026-11-01'))]);
    expect(levelsOf(r.notifyNow)).toEqual([['overdue']]);
    expect(r.schedule).toEqual([]);
  });

  it('a level Android already delivered (scheduled earlier, time now passed) is not sent twice', () => {
    const delivered = row(1, 'due', at(2026, 11, 16, 9));
    const r = plan([entry(dateItem(due))], { now: new Date(2026, 10, 16, 10, 0), log: [delivered] });
    expect(r.notifyNow).toEqual([]);
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });

  it('moving the notify time later on the day a level starts does not re-send what was delivered', () => {
    // due soon went out at 09:00; at 10:00 the user changes the time to 20:00
    const delivered = row(1, 'due', at(2026, 11, 16, 9));
    const r = plan([entry(dateItem(due))], {
      now: new Date(2026, 10, 16, 10, 0),
      notifyTime: '20:00',
      log: [delivered],
    });
    expect(r.notifyNow).toEqual([]);
    expect(r.clearLog).toEqual([]);
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });

  it('skips levels that are not above what was already sent', () => {
    // 28 Nov: 2 days left → urgent, and the urgent notice already went out on the 27th at 09:00
    const r = plan([entry(dateItem(due))], {
      now: new Date(2026, 10, 28, 8, 0),
      log: [row(1, 'urgent', at(2026, 11, 27, 9))],
    });
    expect(r.notifyNow).toEqual([]);
    expect(fireTimes(r)).toEqual([['overdue', at(2026, 12, 1, 9).getTime()]]);
  });

  it('a level sent for an earlier due date is re-announced once the due date moves out', () => {
    // urgent was sent on 1 Nov, but the due date has since moved to 30 Nov (status is only "due" now)
    const r = plan([entry(dateItem(due))], { log: [row(1, 'urgent', at(2026, 11, 1, 9))] });
    expect(r.clearLog).toEqual([{ itemId: 1, level: 'urgent' }]);
    expect(r.markSent).toEqual([{ itemId: 1, level: 'due' }]);
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });

  it('ignores a date it cannot read', () => {
    const r = plan([entry(dateItem('not-a-date'))]);
    expect(r.notifyNow).toEqual([]);
    expect(r.schedule).toEqual([]);
  });

  it('early days equal to final days leaves only the higher level', () => {
    const t = { ...DEFAULT_THRESHOLDS, earlyDays: 3, finalDays: 3 };
    const r = plan([entry(dateItem(due))], { thresholds: t });
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });

  it('a final window longer than the early window leaves urgent only (no later "due soon")', () => {
    const t = { ...DEFAULT_THRESHOLDS, earlyDays: 3, finalDays: 14 };
    const r = plan([entry(dateItem(due))], { thresholds: t });
    expect(fireTimes(r).map((f) => f[0])).toEqual(['urgent', 'overdue']);
  });
});

describe('items with both km and a date', () => {
  it('the higher level wins now, and only higher levels are scheduled', () => {
    // km: 150 left → urgent now. date 20 Dec: due 6 Dec, urgent 17 Dec, overdue 21 Dec
    const item = kmItem({ next_due_date: '2026-12-20', interval_days: 365 });
    const r = plan([entry(item, 1850)]);
    expect(levelsOf(r.notifyNow)).toEqual([['urgent']]);
    expect(fireTimes(r)).toEqual([['overdue', at(2026, 12, 21, 9).getTime()]]);
  });

  it('km far away but the date close: the date levels are scheduled as usual', () => {
    const item = kmItem({ next_due_date: '2026-11-30', interval_days: 365 });
    const r = plan([entry(item, 100)]);
    expect(r.notifyNow).toEqual([]);
    expect(fireTimes(r).map((f) => f[0])).toEqual(['due', 'urgent', 'overdue']);
  });
});

// ─── Grouping ─────────────────────────────────────────────────────────────────

describe('one each vs one summary', () => {
  const three = () => [
    entry(kmItem({ id: 1, category: 'Oil Change' }), 1000),
    entry(kmItem({ id: 2, category: 'Tyres' }), 1000),
    entry(kmItem({ id: 3, category: 'Brake Pads' }), 1000),
  ];

  it('grouped OFF: one notification per item', () => {
    const r = plan(three(), { grouped: false });
    expect(r.notifyNow.map((n) => n.identifier)).toEqual(['maint-1-due', 'maint-2-due', 'maint-3-due']);
  });

  it('grouped ON: several items become one summary', () => {
    const r = plan(three(), { grouped: true });
    expect(r.notifyNow).toHaveLength(1);
    const [n] = r.notifyNow;
    expect(n.payload.title).toBe('3 services need attention');
    expect(n.payload.body).toBe('Oil Change (Beat), Tyres (Beat), Brake Pads (Beat)');
    expect(n.payload.data).toEqual({ type: 'maintenance_summary' });
    expect(n.identifier.startsWith('maint-summary-')).toBe(true);
    expect(isMaintenanceIdentifier(n.identifier)).toBe(true);
    expect(n.items).toEqual([
      { itemId: 1, level: 'due' },
      { itemId: 2, level: 'due' },
      { itemId: 3, level: 'due' },
    ]);
  });

  it('grouped ON: a single item is never turned into a summary', () => {
    const r = plan([entry(kmItem(), 1000)], { grouped: true });
    expect(r.notifyNow[0].identifier).toBe('maint-1-due');
    expect(r.notifyNow[0].payload.data).toEqual({ type: 'maintenance', itemId: 1, vehicleId: 1 });
  });

  it('a long summary lists three items and counts the rest', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((c, i) => entry(kmItem({ id: i + 1, category: c }), 1000));
    const [n] = plan(many, { grouped: true }).notifyNow;
    expect(n.payload.title).toBe('5 services need attention');
    expect(n.payload.body).toBe('A (Beat), B (Beat), C (Beat), +2 more');
    expect(n.items).toHaveLength(5);
  });

  it('items with different levels still share one summary', () => {
    const mixed = [entry(kmItem({ id: 1 }), 1000), entry(kmItem({ id: 2 }), 1900)];
    const [n] = plan(mixed, { grouped: true }).notifyNow;
    expect(n.items).toEqual([
      { itemId: 1, level: 'due' },
      { itemId: 2, level: 'urgent' },
    ]);
  });

  it('scheduled notifications that fire at the same moment are merged when grouped', () => {
    const items = [
      entry(dateItem('2026-11-30', { id: 1, category: 'Chain Lube' })),
      entry(dateItem('2026-11-30', { id: 2, category: 'Air Filter' })),
    ];
    const r = plan(items, { grouped: true });
    expect(r.schedule).toHaveLength(3); // due / urgent / overdue moments
    for (const s of r.schedule) {
      expect(s.items).toHaveLength(2);
      expect(s.payload.title).toBe('2 services need attention');
      expect(s.payload.data).toEqual({ type: 'maintenance_summary' });
      expect(s.identifier.startsWith('maint-summary-')).toBe(true);
    }
  });

  it('scheduled notifications are never merged when grouping is off', () => {
    const items = [
      entry(dateItem('2026-11-30', { id: 1 })),
      entry(dateItem('2026-11-30', { id: 2 })),
    ];
    expect(plan(items, { grouped: false }).schedule).toHaveLength(6);
  });

  it('scheduled notifications at different moments stay separate even when grouped', () => {
    const items = [
      entry(dateItem('2026-11-30', { id: 1 })),
      entry(dateItem('2026-12-05', { id: 2 })),
    ];
    const r = plan(items, { grouped: true });
    expect(r.schedule).toHaveLength(6);
    for (const s of r.schedule) expect(s.items).toHaveLength(1);
  });

  it('summary identifiers are unique per fire time', () => {
    const items = [
      entry(dateItem('2026-11-30', { id: 1 })),
      entry(dateItem('2026-11-30', { id: 2 })),
    ];
    const ids = plan(items, { grouped: true }).schedule.map((s) => s.identifier);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Several vehicles ─────────────────────────────────────────────────────────

describe('several vehicles', () => {
  it('words each notice with its own vehicle', () => {
    const r = plan([
      entry(kmItem({ id: 1, vehicle_id: 1 }), 1850, 'Beat'),
      entry(kmItem({ id: 2, vehicle_id: 2 }), 1000, 'NMAX'),
    ]);
    expect(r.notifyNow.map((n) => n.payload.body)).toEqual([
      'Oil Change on Beat: 150 km left',
      'Oil Change on NMAX: 1000 km left',
    ]);
    expect(r.notifyNow.map((n) => n.payload.data)).toEqual([
      { type: 'maintenance', itemId: 1, vehicleId: 1 },
      { type: 'maintenance', itemId: 2, vehicleId: 2 },
    ]);
  });
});
