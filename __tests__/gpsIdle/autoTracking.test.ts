// "Turn off GPS" in auto mode — must work outside React (from a notification).
// Target module (NOT YET IMPLEMENTED): src/services/autoTracking.ts
//
// Expected export:
//   disableAutoTracking(): Promise<void>
//     - stops the RIDEZEN_BG_LOCATION task if running
//     - clears background last coords
//     - saves tracking mode = 'manual'
//     - cancels the idle reminder
//     - safe to call twice / when nothing is running

jest.mock('expo-location', () => ({
  hasStartedLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(),
}));
jest.mock('@/services/trackingPreferences', () => ({
  getTrackingMode: jest.fn(() => 'auto'),
  setTrackingMode: jest.fn(),
  clearBgLastCoords: jest.fn(),
  getAutoTrackVehicleId: jest.fn(),
  getBgLastCoords: jest.fn(),
  setBgLastCoords: jest.fn(),
}));
jest.mock('@/notifications/idleReminder', () => ({
  armIdleReminder: jest.fn().mockResolvedValue(undefined),
  cancelIdleReminder: jest.fn().mockResolvedValue(undefined),
}));
// autoTracking imports the GPS task's constant, and the GPS task imports the maintenance sync (real module can't load in Jest)
jest.mock('@/notifications/maintenanceNotifications', () => ({
  syncIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

let Location: any;
let TM: any;
let prefs: any;
let idle: any;
let autoTracking: any;

function setRunning(running: boolean) {
  // Implementation may check either API — both report the same state here.
  Location.hasStartedLocationUpdatesAsync.mockResolvedValue(running);
  TM.isTaskRegisteredAsync.mockResolvedValue(running);
}

beforeEach(() => {
  jest.resetModules();
  Location = require('expo-location');
  TM = require('expo-task-manager');
  prefs = require('@/services/trackingPreferences');
  idle = require('@/notifications/idleReminder');
  autoTracking = require('@/services/autoTracking');
});

it('stops the background GPS task when it is running', async () => {
  setRunning(true);
  await autoTracking.disableAutoTracking();
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('RIDEZEN_BG_LOCATION');
});

it('does not call stop when the task is not running', async () => {
  setRunning(false);
  await autoTracking.disableAutoTracking();
  expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
});

it('switches the saved mode to manual and clears last coords', async () => {
  setRunning(true);
  await autoTracking.disableAutoTracking();
  expect(prefs.setTrackingMode).toHaveBeenCalledWith('manual');
  expect(prefs.clearBgLastCoords).toHaveBeenCalled();
});

it('cancels the idle reminder', async () => {
  setRunning(true);
  await autoTracking.disableAutoTracking();
  expect(idle.cancelIdleReminder).toHaveBeenCalled();
});

it('still saves manual mode if stopping the task throws', async () => {
  setRunning(true);
  Location.stopLocationUpdatesAsync.mockRejectedValueOnce(new Error('boom'));
  await expect(autoTracking.disableAutoTracking()).resolves.toBeUndefined();
  expect(prefs.setTrackingMode).toHaveBeenCalledWith('manual');
});
