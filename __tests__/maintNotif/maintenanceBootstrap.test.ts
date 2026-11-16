// App start-up and app-resume hooks for maintenance notifications.
// Module under test (NOT YET IMPLEMENTED): src/notifications/maintenanceBootstrap.ts
//
// Expected exports:
//   initMaintenanceNotifications(): Promise<void>   call once from _layout init(), AFTER migrations + channel setup
//        - first launch (switch ON, permission never asked): show the Android permission prompt once and remember it
//        - registers the daily background check
//        - runs the first sync (after the permission answer, so it can send straight away)
//        - never throws
//   attachMaintenanceAppStateSync(): () => void      app returns to the foreground → request a (debounced) re-check;
//        returns an unsubscribe function

jest.mock('@/services/notificationPreferences', () => ({
  getMaintenanceNotifEnabled: jest.fn(() => true),
  hasAskedNotificationPermission: jest.fn(() => false),
  markNotificationPermissionAsked: jest.fn(),
}));
jest.mock('@/notifications/scheduler', () => ({
  requestNotificationPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/notifications/maintenanceNotifications', () => ({
  syncMaintenanceNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/services/maintenanceBackgroundTask', () => ({
  registerMaintenanceCheck: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { AppState } from 'react-native';
import * as prefs from '@/services/notificationPreferences';
import { requestNotificationPermissions } from '@/notifications/scheduler';
import { syncMaintenanceNotifications } from '@/notifications/maintenanceNotifications';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';
import { registerMaintenanceCheck } from '@/services/maintenanceBackgroundTask';
import { initMaintenanceNotifications, attachMaintenanceAppStateSync } from '@/notifications/maintenanceBootstrap';

const mPrefs = prefs as jest.Mocked<typeof prefs>;

beforeEach(() => {
  jest.clearAllMocks();
  mPrefs.getMaintenanceNotifEnabled.mockReturnValue(true);
  mPrefs.hasAskedNotificationPermission.mockReturnValue(false);
});

describe('initMaintenanceNotifications', () => {
  it('first launch: asks for permission once, remembers it, registers the daily check, then syncs', async () => {
    await initMaintenanceNotifications();

    expect(requestNotificationPermissions).toHaveBeenCalledTimes(1);
    expect(mPrefs.markNotificationPermissionAsked).toHaveBeenCalledTimes(1);
    expect(registerMaintenanceCheck).toHaveBeenCalledTimes(1);
    expect(syncMaintenanceNotifications).toHaveBeenCalledTimes(1);

    // the first sync must come after the user's answer, or it would see "no permission"
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(requestNotificationPermissions as jest.Mock)).toBeLessThan(
      order(syncMaintenanceNotifications as jest.Mock)
    );
  });

  it('later launches: does not ask again (no nagging after a "Don\'t allow")', async () => {
    mPrefs.hasAskedNotificationPermission.mockReturnValue(true);
    await initMaintenanceNotifications();
    expect(requestNotificationPermissions).not.toHaveBeenCalled();
    expect(syncMaintenanceNotifications).toHaveBeenCalledTimes(1);
    expect(registerMaintenanceCheck).toHaveBeenCalledTimes(1);
  });

  it('switch OFF: does not ask for permission', async () => {
    mPrefs.getMaintenanceNotifEnabled.mockReturnValue(false);
    await initMaintenanceNotifications();
    expect(requestNotificationPermissions).not.toHaveBeenCalled();
    expect(mPrefs.markNotificationPermissionAsked).not.toHaveBeenCalled();
  });

  it('never throws, and still syncs, when the permission prompt fails', async () => {
    (requestNotificationPermissions as jest.Mock).mockRejectedValueOnce(new Error('native'));
    await expect(initMaintenanceNotifications()).resolves.toBeUndefined();
    expect(syncMaintenanceNotifications).toHaveBeenCalledTimes(1);
  });

  it('never throws when registering the daily check fails', async () => {
    (registerMaintenanceCheck as jest.Mock).mockRejectedValueOnce(new Error('native'));
    await expect(initMaintenanceNotifications()).resolves.toBeUndefined();
    expect(syncMaintenanceNotifications).toHaveBeenCalledTimes(1);
  });
});

describe('attachMaintenanceAppStateSync', () => {
  let listeners: Array<(s: string) => void>;
  const remove = jest.fn();

  beforeEach(() => {
    listeners = [];
    remove.mockClear();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: any, l: any) => {
      listeners.push(l);
      return { remove } as any;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests a re-check when the app comes back to the foreground', () => {
    attachMaintenanceAppStateSync();
    for (const l of listeners) l('active');
    expect(requestMaintenanceSync).toHaveBeenCalledTimes(1);
  });

  it('ignores going to the background', () => {
    attachMaintenanceAppStateSync();
    for (const l of listeners) {
      l('background');
      l('inactive');
    }
    expect(requestMaintenanceSync).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function', () => {
    const unsubscribe = attachMaintenanceAppStateSync();
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
