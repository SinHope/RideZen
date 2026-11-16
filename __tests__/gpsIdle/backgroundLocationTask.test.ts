// Auto-track background task + idle reminder.
// Module under test (EXISTS, needs change): src/services/backgroundLocationTask.ts
//
// The "existing behaviour" tests should already pass.
// The "idle reminder" tests fail until armIdleReminder() is wired in.

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('@/services/trackingPreferences', () => ({
  getTrackingMode: jest.fn(),
  getAutoTrackVehicleId: jest.fn(),
  getBgLastCoords: jest.fn(),
  setBgLastCoords: jest.fn(),
}));
jest.mock('@/services/rideSession', () => ({
  ...jest.requireActual('@/services/rideSession'),
  addRideDistance: jest.fn(),
}));
jest.mock(
  '@/notifications/idleReminder',
  () => ({
    armIdleReminder: jest.fn().mockResolvedValue(undefined),
    cancelIdleReminder: jest.fn().mockResolvedValue(undefined),
  })
);
jest.mock(
  '@/notifications/maintenanceNotifications',
  () => ({ syncIfStale: jest.fn().mockResolvedValue(undefined) })
);
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import * as TaskManager from 'expo-task-manager';
import * as prefs from '@/services/trackingPreferences';
import { addRideDistance } from '@/services/rideSession';
import { armIdleReminder } from '@/notifications/idleReminder';
import { syncIfStale } from '@/notifications/maintenanceNotifications';
import '@/services/backgroundLocationTask';

const executor = (TaskManager.defineTask as jest.Mock).mock.calls.find(
  (c: any[]) => c[0] === 'RIDEZEN_BG_LOCATION'
)[1];

const mPrefs = prefs as jest.Mocked<typeof prefs>;

function fix(lat: number, lon: number) {
  return { data: { locations: [{ coords: { latitude: lat, longitude: lon } }] }, error: null };
}

const START = { lat: 14.5995, lon: 120.9842 };
const MOVED_50M = START.lat + 0.00045; // ≈ 50 m north
const JITTER_3M = START.lat + 0.000027; // ≈ 3 m — GPS noise

beforeEach(() => {
  jest.clearAllMocks();
  mPrefs.getTrackingMode.mockReturnValue('auto');
  mPrefs.getAutoTrackVehicleId.mockReturnValue(1);
  mPrefs.getBgLastCoords.mockReturnValue(START);
});

describe('existing behaviour', () => {
  it('adds distance when the rider moved ≥ 10 m', async () => {
    await executor(fix(MOVED_50M, START.lon));
    expect(addRideDistance).toHaveBeenCalledWith(1, expect.closeTo(0.05, 2));
  });

  it('ignores GPS jitter under 10 m', async () => {
    await executor(fix(JITTER_3M, START.lon));
    expect(addRideDistance).not.toHaveBeenCalled();
  });

  it('does nothing when mode is no longer auto', async () => {
    mPrefs.getTrackingMode.mockReturnValue('manual');
    await executor(fix(MOVED_50M, START.lon));
    expect(addRideDistance).not.toHaveBeenCalled();
  });
});

describe('idle reminder', () => {
  it('re-arms the reminder when the rider really moved', async () => {
    await executor(fix(MOVED_50M, START.lon));
    expect(armIdleReminder).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-arm on GPS jitter (parked rider must still get reminded)', async () => {
    await executor(fix(JITTER_3M, START.lon));
    expect(armIdleReminder).not.toHaveBeenCalled();
  });

  it('does NOT arm on the very first fix (app launch at home must not nag)', async () => {
    mPrefs.getBgLastCoords.mockReturnValue(null);
    await executor(fix(MOVED_50M, START.lon));
    expect(armIdleReminder).not.toHaveBeenCalled();
  });

  it('does NOT arm when mode is no longer auto', async () => {
    mPrefs.getTrackingMode.mockReturnValue('manual');
    await executor(fix(MOVED_50M, START.lon));
    expect(armIdleReminder).not.toHaveBeenCalled();
  });
});

// The odometer just changed, so a maintenance level may have been crossed (km-based due/urgent/overdue).
// Checked at most every 5 minutes; awaited because this is a headless task that must finish its work.
describe('maintenance notifications', () => {
  it('re-checks (throttled to every 5 min) after the odometer really moved', async () => {
    await executor(fix(MOVED_50M, START.lon));
    expect(syncIfStale).toHaveBeenCalledTimes(1);
    expect(syncIfStale).toHaveBeenCalledWith(5 * 60 * 1000);
  });

  it('runs after the distance has been saved (the check reads the new odometer)', async () => {
    await executor(fix(MOVED_50M, START.lon));
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(addRideDistance as jest.Mock)).toBeLessThan(order(syncIfStale as jest.Mock));
  });

  it('does NOT re-check on GPS jitter (nothing was added)', async () => {
    await executor(fix(JITTER_3M, START.lon));
    expect(syncIfStale).not.toHaveBeenCalled();
  });

  it('does NOT re-check on the very first fix', async () => {
    mPrefs.getBgLastCoords.mockReturnValue(null);
    await executor(fix(MOVED_50M, START.lon));
    expect(syncIfStale).not.toHaveBeenCalled();
  });

  it('does NOT re-check when mode is no longer auto', async () => {
    mPrefs.getTrackingMode.mockReturnValue('manual');
    await executor(fix(MOVED_50M, START.lon));
    expect(syncIfStale).not.toHaveBeenCalled();
  });

  it('a failing re-check never breaks distance tracking (coords still saved)', async () => {
    (syncIfStale as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(executor(fix(MOVED_50M, START.lon))).resolves.toBeUndefined();
    expect(mPrefs.setBgLastCoords).toHaveBeenCalledWith(MOVED_50M, START.lon);
  });
});
