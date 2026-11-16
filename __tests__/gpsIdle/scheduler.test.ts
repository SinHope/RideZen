// Notification channels + permission helper.
// Module under test (EXISTS): src/notifications/scheduler.ts
//
// History: this file used to also check that scheduleMaintenanceReminders / cancelAllReminders never cancelled the
// GPS idle reminder. Those two functions were replaced by src/notifications/maintenanceNotifications.ts; the same
// "never touch the idle reminder" guarantee is now tested in __tests__/maintNotif/maintenanceNotifications.test.ts.

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import * as N from 'expo-notifications';
import { setupAndroidChannel, requestNotificationPermissions } from '@/notifications/scheduler';

const mN = N as jest.Mocked<typeof N>;

beforeEach(() => {
  jest.clearAllMocks();
  (mN.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (mN.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
});

describe('setupAndroidChannel', () => {
  it('still creates the maintenance channel', async () => {
    await setupAndroidChannel();
    expect(mN.setNotificationChannelAsync).toHaveBeenCalledWith('maintenance', expect.anything());
  });

  it('creates the ride_tracking channel with HIGH importance (so buttons pop up)', async () => {
    await setupAndroidChannel();
    const call = (mN.setNotificationChannelAsync as jest.Mock).mock.calls.find(
      (c) => c[0] === 'ride_tracking'
    );
    expect(call).toBeDefined();
    expect(call[1].importance).toBeGreaterThanOrEqual(N.AndroidImportance.HIGH);
  });
});

describe('requestNotificationPermissions', () => {
  it('does not prompt when permission is already granted', async () => {
    await expect(requestNotificationPermissions()).resolves.toBe(true);
    expect(mN.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts when not granted, and reports the answer', async () => {
    (mN.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    await expect(requestNotificationPermissions()).resolves.toBe(true);
    expect(mN.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    (mN.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    await expect(requestNotificationPermissions()).resolves.toBe(false);
  });

  it('answers false (never throws) when the native call fails', async () => {
    (mN.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('native'));
    await expect(requestNotificationPermissions()).resolves.toBe(false);
  });
});
