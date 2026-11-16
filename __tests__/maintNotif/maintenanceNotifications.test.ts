// Maintenance notification sync — the I/O around the planner.
// Module under test (NOT YET IMPLEMENTED): src/notifications/maintenanceNotifications.ts
//
// Expected exports:
//   MAINTENANCE_CHANNEL      = 'maintenance'
//   MAINT_SYNC_DEBOUNCE_MS   = 2000
//   syncMaintenanceNotifications(): Promise<void>   never throws; one run at a time (overlaps → one extra run)
//   cancelMaintenanceNotifications(): Promise<void> cancels pending maint-* ONLY (never the GPS idle reminder)
//   syncIfStale(maxAgeMs): Promise<void>            skips when a sync finished less than maxAgeMs ago
//   requestMaintenanceSync(): void                  debounced; also registered into maintenanceSyncSignal on import
//
// Sync = switch off / no permission → cancel and stop. Otherwise: cancel pending maint-*, drop future log rows,
// plan (pure), apply clearLog/markSent, send notifyNow, schedule `schedule`, logging each success.
// Background-safe: it only CHECKS permission (a prompt needs the UI) — prompting is done elsewhere.

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));
jest.mock('@/repositories/vehicleRepo', () => ({ vehicleRepo: { getAll: jest.fn() } }));
jest.mock('@/repositories/maintenanceRepo', () => ({ maintenanceRepo: { getByVehicle: jest.fn() } }));
jest.mock('@/repositories/notifyLogRepo', () => ({
  notifyLogRepo: {
    getAll: jest.fn(() => []),
    upsert: jest.fn(),
    remove: jest.fn(),
    deleteFuture: jest.fn(),
  },
}));
jest.mock('@/services/notificationPreferences', () => ({
  getMaintenanceNotifEnabled: jest.fn(() => true),
  getNotifyTime: jest.fn(() => '09:00'),
  getNotifyGrouped: jest.fn(() => false),
}));
jest.mock('@/utils/reminderCheck', () => ({
  ...jest.requireActual('@/utils/reminderCheck'),
  loadStatusThresholds: jest.fn(() => ({ earlyKm: 1000, earlyDays: 14, finalKm: 200, finalDays: 3 })),
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

// Mon 16 Nov 2026, 08:00 local
const NOW = new Date(2026, 10, 16, 8, 0, 0);

const VEHICLE = {
  id: 1,
  nickname: 'Beat',
  type: 'scooter',
  current_odometer: 1850,
  created_at: '',
  updated_at: '',
};
const KM_ITEM = {
  id: 1,
  vehicle_id: 1,
  category: 'Oil Change',
  vehicle_type_scope: 'universal',
  next_due_odo: 2000,
  interval_km: 2000,
  updated_at: '',
};
const DATE_ITEM = {
  id: 2,
  vehicle_id: 1,
  category: 'Chain Lube',
  vehicle_type_scope: 'universal',
  next_due_date: '2026-11-30',
  interval_days: 365,
  updated_at: '',
};

let N: any;
let vehicleRepo: any;
let maintenanceRepo: any;
let logRepo: any;
let prefs: any;
let logger: any;
let signal: any;
let mod: any;

function loadModules() {
  jest.resetModules();
  N = require('expo-notifications');
  vehicleRepo = require('@/repositories/vehicleRepo').vehicleRepo;
  maintenanceRepo = require('@/repositories/maintenanceRepo').maintenanceRepo;
  logRepo = require('@/repositories/notifyLogRepo').notifyLogRepo;
  prefs = require('@/services/notificationPreferences');
  logger = require('@/utils/logger');
  signal = require('@/notifications/maintenanceSyncSignal');
  mod = require('@/notifications/maintenanceNotifications');
  vehicleRepo.getAll.mockResolvedValue({ data: [VEHICLE], error: null });
  maintenanceRepo.getByVehicle.mockResolvedValue({ data: [KM_ITEM], error: null });
}

const items = (...list: object[]) =>
  maintenanceRepo.getByVehicle.mockResolvedValue({ data: list, error: null });

const sentIds = () => N.scheduleNotificationAsync.mock.calls.map((c: any[]) => c[0].identifier);
const loggedRows = () => logRepo.upsert.mock.calls.flatMap((c: any[]) => c[0]);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  loadModules();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('exports', () => {
  it('uses the maintenance channel and a 2 s debounce', () => {
    expect(mod.MAINTENANCE_CHANNEL).toBe('maintenance');
    expect(mod.MAINT_SYNC_DEBOUNCE_MS).toBe(2000);
  });
});

// ─── Gates ────────────────────────────────────────────────────────────────────

describe('when notifications are switched off', () => {
  it('cancels the pending maintenance notifications and sends nothing', async () => {
    prefs.getMaintenanceNotifEnabled.mockReturnValue(false);
    N.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'maint-1-urgent', content: { data: {} } },
    ]);

    await mod.syncMaintenanceNotifications();

    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('maint-1-urgent');
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(vehicleRepo.getAll).not.toHaveBeenCalled();
  });
});

describe('when the phone blocks notifications', () => {
  beforeEach(() => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
  });

  it('cancels, sends nothing, and does not pop up a permission prompt (may run in the background)', async () => {
    N.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'maint-1-urgent', content: { data: {} } },
    ]);

    await mod.syncMaintenanceNotifications();

    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('maint-1-urgent');
  });
});

// ─── Cancelling ───────────────────────────────────────────────────────────────

describe('cancelMaintenanceNotifications', () => {
  const PENDING = [
    { identifier: 'ridezen-gps-idle', content: { data: { type: 'gps_idle' } } },
    { identifier: 'maint-1-due', content: { data: { type: 'maintenance', itemId: 1 } } },
    { identifier: 'maint-summary-1700000000000', content: { data: { type: 'maintenance_summary' } } },
    { identifier: 'old-random-uuid', content: { data: { type: 'maintenance', itemId: 9 } } },
    { identifier: 'something-else', content: { data: {} } },
  ];

  it('cancels only maintenance notifications and never the GPS idle reminder', async () => {
    N.getAllScheduledNotificationsAsync.mockResolvedValue(PENDING);

    await mod.cancelMaintenanceNotifications();

    const cancelled = N.cancelScheduledNotificationAsync.mock.calls.map((c: any[]) => c[0]);
    expect(cancelled.sort()).toEqual(['maint-1-due', 'maint-summary-1700000000000', 'old-random-uuid'].sort());
    expect(N.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });

  it('a sync cancels the same way', async () => {
    N.getAllScheduledNotificationsAsync.mockResolvedValue(PENDING);
    await mod.syncMaintenanceNotifications();
    expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('ridezen-gps-idle');
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith('maint-1-due');
    expect(N.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
  });
});

// ─── Sending ──────────────────────────────────────────────────────────────────

describe('km-based items are sent right away', () => {
  it('on the maintenance channel, with the planned wording', async () => {
    await mod.syncMaintenanceNotifications(); // odometer 1850 → urgent

    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(N.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'maint-1-urgent',
      content: expect.objectContaining({
        title: 'Service urgent',
        body: 'Oil Change on Beat: 150 km left',
        data: { type: 'maintenance', itemId: 1, vehicleId: 1 },
      }),
      trigger: { channelId: 'maintenance' }, // channelId belongs on the TRIGGER (SDK 55)
    });
  });

  it('records what it sent, so the next sync does not repeat it', async () => {
    await mod.syncMaintenanceNotifications();
    expect(loggedRows()).toEqual([{ item_id: 1, level: 'urgent', fire_at: NOW.toISOString() }]);
  });

  it('does not send again once the level is in the log', async () => {
    logRepo.getAll.mockReturnValue([
      { item_id: 1, level: 'urgent', fire_at: new Date(2026, 10, 15, 20, 0).toISOString() },
    ]);
    await mod.syncMaintenanceNotifications();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('uses the odometer of the vehicle the item belongs to', async () => {
    vehicleRepo.getAll.mockResolvedValue({
      data: [VEHICLE, { ...VEHICLE, id: 2, nickname: 'NMAX', current_odometer: 100 }],
      error: null,
    });
    maintenanceRepo.getByVehicle.mockImplementation(async (vehicleId: number) => ({
      data: vehicleId === 1 ? [KM_ITEM] : [{ ...KM_ITEM, id: 7, vehicle_id: 2 }],
      error: null,
    }));
    await mod.syncMaintenanceNotifications();
    expect(sentIds()).toEqual(['maint-1-urgent']); // NMAX at 100 km is fine
  });
});

describe('date-based items are scheduled for later', () => {
  beforeEach(() => items(DATE_ITEM));

  it('hands Android a DATE trigger per level at the saved time', async () => {
    await mod.syncMaintenanceNotifications();

    const calls = N.scheduleNotificationAsync.mock.calls.map((c: any[]) => c[0]);
    expect(calls.map((c: any) => c.identifier)).toEqual(['maint-2-due', 'maint-2-urgent', 'maint-2-overdue']);
    for (const c of calls) {
      expect(c.trigger.type).toBe('date');
      expect(c.trigger.channelId).toBe('maintenance');
    }
    expect(calls[0].trigger.date.getTime()).toBe(new Date(2026, 10, 16, 9, 0).getTime());
    expect(calls[1].trigger.date.getTime()).toBe(new Date(2026, 10, 27, 9, 0).getTime());
    expect(calls[2].trigger.date.getTime()).toBe(new Date(2026, 11, 1, 9, 0).getTime());
    expect(calls[0].content.title).toBe('Service due soon');
  });

  it('logs each scheduled level with the time it will fire', async () => {
    await mod.syncMaintenanceNotifications();
    expect(loggedRows()).toEqual([
      { item_id: 2, level: 'due', fire_at: new Date(2026, 10, 16, 9, 0).toISOString() },
      { item_id: 2, level: 'urgent', fire_at: new Date(2026, 10, 27, 9, 0).toISOString() },
      { item_id: 2, level: 'overdue', fire_at: new Date(2026, 11, 1, 9, 0).toISOString() },
    ]);
  });

  it("follows the user's notification time", async () => {
    prefs.getNotifyTime.mockReturnValue('20:30');
    await mod.syncMaintenanceNotifications();
    const first = N.scheduleNotificationAsync.mock.calls[0][0].trigger.date;
    expect(first.getTime()).toBe(new Date(2026, 10, 16, 20, 30).getTime());
  });
});

describe('group into one summary', () => {
  const TWO = [KM_ITEM, { ...KM_ITEM, id: 3, category: 'Tyres' }];

  it('OFF: one notification per item', async () => {
    items(...TWO);
    await mod.syncMaintenanceNotifications();
    expect(sentIds()).toEqual(['maint-1-urgent', 'maint-3-urgent']);
  });

  it('ON: one summary, and every item in it is logged', async () => {
    items(...TWO);
    prefs.getNotifyGrouped.mockReturnValue(true);
    await mod.syncMaintenanceNotifications();

    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const sent = N.scheduleNotificationAsync.mock.calls[0][0];
    expect(sent.content.title).toBe('2 services need attention');
    expect(sent.content.data).toEqual({ type: 'maintenance_summary' });
    expect(sent.identifier.startsWith('maint-summary-')).toBe(true);
    expect(loggedRows().map((r: any) => [r.item_id, r.level])).toEqual([
      [1, 'urgent'],
      [3, 'urgent'],
    ]);
  });
});

// ─── Order of work and log housekeeping ───────────────────────────────────────

describe('housekeeping', () => {
  it('cancels pending ones and drops future log rows BEFORE it plans', async () => {
    await mod.syncMaintenanceNotifications();
    expect(logRepo.deleteFuture).toHaveBeenCalledWith(NOW.toISOString());

    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(N.getAllScheduledNotificationsAsync)).toBeLessThan(order(logRepo.getAll));
    expect(order(logRepo.deleteFuture)).toBeLessThan(order(logRepo.getAll));
  });

  it('forgets the log of an item that is ok again', async () => {
    items({ ...KM_ITEM, next_due_odo: 9000 }); // far away
    logRepo.getAll.mockReturnValue([
      { item_id: 1, level: 'overdue', fire_at: new Date(2026, 10, 1, 9, 0).toISOString() },
    ]);
    await mod.syncMaintenanceNotifications();
    expect(logRepo.remove).toHaveBeenCalledWith([{ itemId: 1, level: 'overdue' }]);
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('records the lower level when an item drops a level, without notifying', async () => {
    items({ ...KM_ITEM, next_due_odo: 2100 }); // 250 km left at 1850 → "due soon" (no longer urgent)
    logRepo.getAll.mockReturnValue([
      { item_id: 1, level: 'urgent', fire_at: new Date(2026, 10, 1, 9, 0).toISOString() },
    ]);
    await mod.syncMaintenanceNotifications();

    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(logRepo.remove).toHaveBeenCalledWith([{ itemId: 1, level: 'urgent' }]);
    expect(loggedRows()).toEqual([{ item_id: 1, level: 'due', fire_at: NOW.toISOString() }]);
  });

  it('does nothing else when there are no vehicles', async () => {
    vehicleRepo.getAll.mockResolvedValue({ data: [], error: null });
    await mod.syncMaintenanceNotifications();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

// ─── Failure handling ─────────────────────────────────────────────────────────

describe('never throws', () => {
  it('when loading vehicles fails', async () => {
    vehicleRepo.getAll.mockRejectedValue(new Error('db'));
    await expect(mod.syncMaintenanceNotifications()).resolves.toBeUndefined();
    expect(logger.logToFile).toHaveBeenCalledWith('MAINT_NOTIF', expect.any(String), expect.any(String));
  });

  it('when the vehicle repo returns an error result', async () => {
    vehicleRepo.getAll.mockResolvedValue({ data: null, error: 'Could not load your vehicles.' });
    await expect(mod.syncMaintenanceNotifications()).resolves.toBeUndefined();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('keeps everything as it was when it could not read the data (nothing is cancelled or forgotten)', async () => {
    // If a vehicle's items fail to load, planning on the rest would treat that vehicle's log rows as orphans,
    // forget them, and announce the same levels again later. So a failed read must change nothing.
    maintenanceRepo.getByVehicle.mockResolvedValue({ data: null, error: 'Could not load maintenance items.' });
    N.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'maint-2-urgent', content: { data: {} } },
    ]);

    await mod.syncMaintenanceNotifications();

    expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(logRepo.deleteFuture).not.toHaveBeenCalled();
    expect(logRepo.remove).not.toHaveBeenCalled();
    expect(logRepo.upsert).not.toHaveBeenCalled();
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('when checking the permission fails', async () => {
    N.getPermissionsAsync.mockRejectedValue(new Error('native'));
    await expect(mod.syncMaintenanceNotifications()).resolves.toBeUndefined();
  });

  it('when the notification log cannot be read', async () => {
    logRepo.getAll.mockImplementation(() => {
      throw new Error('no such table: maintenance_notify_log');
    });
    await expect(mod.syncMaintenanceNotifications()).resolves.toBeUndefined();
    expect(logger.logToFile).toHaveBeenCalled();
  });

  it('one failed send does not stop the others, and the failed one is not logged', async () => {
    items(KM_ITEM, { ...KM_ITEM, id: 3, category: 'Tyres' });
    N.scheduleNotificationAsync.mockRejectedValueOnce(new Error('boom')).mockResolvedValue('id');

    await expect(mod.syncMaintenanceNotifications()).resolves.toBeUndefined();

    expect(sentIds()).toEqual(['maint-1-urgent', 'maint-3-urgent']);
    expect(loggedRows().map((r: any) => r.item_id)).toEqual([3]); // retried on the next sync
  });
});

// ─── One run at a time ────────────────────────────────────────────────────────

describe('overlapping syncs', () => {
  it('never run at the same time; three overlapping calls collapse into two runs', async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    vehicleRepo.getAll.mockImplementation(async () => {
      active++;
      runs++;
      maxActive = Math.max(maxActive, active);
      await gate;
      active--;
      return { data: [VEHICLE], error: null };
    });

    const p1 = mod.syncMaintenanceNotifications();
    const p2 = mod.syncMaintenanceNotifications();
    const p3 = mod.syncMaintenanceNotifications();
    release();
    await Promise.all([p1, p2, p3]);

    expect(maxActive).toBe(1);
    expect(runs).toBe(2); // the first, plus one rerun that picks up whatever changed meanwhile
  });

  it('a sync that fails does not block later ones', async () => {
    vehicleRepo.getAll.mockRejectedValueOnce(new Error('db'));
    await mod.syncMaintenanceNotifications();
    await mod.syncMaintenanceNotifications();
    expect(N.scheduleNotificationAsync).toHaveBeenCalled();
  });
});

// ─── Debounce and staleness ───────────────────────────────────────────────────

// let the sync that a timer just started run to completion
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe('requestMaintenanceSync (what repositories call after a write)', () => {
  it('is registered into the signal module when maintenanceNotifications loads', async () => {
    signal.requestMaintenanceSync();
    await jest.advanceTimersByTimeAsync(2001);
    await flush();
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('waits 2 s and turns a burst of writes into a single sync', async () => {
    signal.requestMaintenanceSync();
    signal.requestMaintenanceSync();
    signal.requestMaintenanceSync();

    await jest.advanceTimersByTimeAsync(1999);
    await flush();
    expect(N.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2);
    await flush();
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('a new request restarts the wait', async () => {
    signal.requestMaintenanceSync();
    await jest.advanceTimersByTimeAsync(1500);
    signal.requestMaintenanceSync();
    await jest.advanceTimersByTimeAsync(1500); // 3 s since the first, but only 1.5 s since the last
    await flush();
    expect(N.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(600);
    await flush();
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('the exported function behaves the same', async () => {
    mod.requestMaintenanceSync();
    await jest.advanceTimersByTimeAsync(2001);
    await flush();
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('syncIfStale', () => {
  it('syncs the first time, skips while fresh, syncs again once stale', async () => {
    await mod.syncIfStale(60_000);
    await mod.syncIfStale(60_000);
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_001);
    await mod.syncIfStale(60_000);
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(2);
  });

  it('a normal sync also counts as fresh', async () => {
    await mod.syncMaintenanceNotifications();
    await mod.syncIfStale(60_000);
    expect(N.getAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
  });
});
