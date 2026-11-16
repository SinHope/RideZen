// Daily safety-net check, run by Android's WorkManager even when the app is closed.
// Module under test (NOT YET IMPLEMENTED): src/services/maintenanceBackgroundTask.ts
//
// Expected exports:
//   MAINT_CHECK_TASK = 'RIDEZEN_MAINT_CHECK'
//   MAINT_CHECK_INTERVAL_MINUTES = 1440            (24 h; the OS treats it as a minimum and may delay it)
//   registerMaintenanceCheck(): Promise<void>      never throws; idempotent
//
// Side effect on import: TaskManager.defineTask(MAINT_CHECK_TASK, ...) — must be imported at the top of
// app/_layout.tsx so it exists before the OS wakes the app headlessly.
// Registering again would RESET the 24 h timer (WorkManager CANCEL_AND_REENQUEUE), so skip when already registered.

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(false),
}));
jest.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  getStatusAsync: jest.fn().mockResolvedValue(2),
  registerTaskAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/notifications/maintenanceNotifications', () => ({
  syncMaintenanceNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

let TM: any;
let BT: any;
let notif: any;
let mod: any;

beforeEach(() => {
  jest.resetModules();
  TM = require('expo-task-manager');
  BT = require('expo-background-task');
  notif = require('@/notifications/maintenanceNotifications');
  mod = require('@/services/maintenanceBackgroundTask');
});

const executor = () => TM.defineTask.mock.calls.find((c: any[]) => c[0] === 'RIDEZEN_MAINT_CHECK')[1];

describe('constants', () => {
  it('has the agreed name and a 24 h interval', () => {
    expect(mod.MAINT_CHECK_TASK).toBe('RIDEZEN_MAINT_CHECK');
    expect(mod.MAINT_CHECK_INTERVAL_MINUTES).toBe(24 * 60);
  });
});

describe('the task', () => {
  it('is defined at import time', () => {
    expect(TM.defineTask).toHaveBeenCalledWith('RIDEZEN_MAINT_CHECK', expect.any(Function));
  });

  it('runs a sync and reports success', async () => {
    await expect(executor()({ data: {}, error: null })).resolves.toBe(BT.BackgroundTaskResult.Success);
    expect(notif.syncMaintenanceNotifications).toHaveBeenCalledTimes(1);
  });

  it('reports failure (without throwing) when the sync blows up', async () => {
    notif.syncMaintenanceNotifications.mockRejectedValueOnce(new Error('boom'));
    await expect(executor()({ data: {}, error: null })).resolves.toBe(BT.BackgroundTaskResult.Failed);
  });

  it('reports failure when the OS passes an error', async () => {
    await expect(executor()({ data: {}, error: new Error('os') })).resolves.toBe(BT.BackgroundTaskResult.Failed);
    expect(notif.syncMaintenanceNotifications).not.toHaveBeenCalled();
  });
});

describe('registerMaintenanceCheck', () => {
  it('registers once with a 24 h minimum interval', async () => {
    await mod.registerMaintenanceCheck();
    expect(BT.registerTaskAsync).toHaveBeenCalledWith('RIDEZEN_MAINT_CHECK', { minimumInterval: 1440 });
  });

  it('does not re-register (that would restart the 24 h timer on every app launch)', async () => {
    TM.isTaskRegisteredAsync.mockResolvedValue(true);
    await mod.registerMaintenanceCheck();
    expect(BT.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('skips quietly when the OS restricts background work', async () => {
    BT.getStatusAsync.mockResolvedValue(BT.BackgroundTaskStatus.Restricted);
    await mod.registerMaintenanceCheck();
    expect(BT.registerTaskAsync).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    BT.registerTaskAsync.mockRejectedValue(new Error('native'));
    await expect(mod.registerMaintenanceCheck()).resolves.toBeUndefined();
    BT.getStatusAsync.mockRejectedValue(new Error('native'));
    await expect(mod.registerMaintenanceCheck()).resolves.toBeUndefined();
  });
});
