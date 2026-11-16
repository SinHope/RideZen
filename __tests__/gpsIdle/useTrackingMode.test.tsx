// Tracking-mode hook + idle reminder.
// Module under test (EXISTS, needs change): src/hooks/useTrackingMode.ts

import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', canAskAgain: true }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', canAskAgain: true }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(true),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn().mockResolvedValue(true),
}));

let mockMode = 'auto';
jest.mock('@/services/trackingPreferences', () => ({
  getTrackingMode: jest.fn(() => mockMode),
  setTrackingMode: jest.fn((m: string) => {
    mockMode = m;
  }),
  getAutoTrackVehicleId: jest.fn(() => 1),
  setAutoTrackVehicleId: jest.fn(),
  clearBgLastCoords: jest.fn(),
  getBgLastCoords: jest.fn(),
  setBgLastCoords: jest.fn(),
}));
jest.mock(
  '@/notifications/idleReminder',
  () => ({
    armIdleReminder: jest.fn().mockResolvedValue(undefined),
    cancelIdleReminder: jest.fn().mockResolvedValue(undefined),
  })
);
// The hook asks for notification permission when switching to auto (real module can't load in Jest)
jest.mock('@/notifications/scheduler', () => ({
  requestNotificationPermissions: jest.fn().mockResolvedValue(true),
}));
// The hook pulls in the GPS task, which imports the maintenance sync (real module can't load in Jest either)
jest.mock('@/notifications/maintenanceNotifications', () => ({
  syncIfStale: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { useTrackingMode } from '@/hooks/useTrackingMode';
import { cancelIdleReminder } from '@/notifications/idleReminder';

beforeEach(() => {
  jest.clearAllMocks();
  mockMode = 'auto';
});

it('switchToManual cancels the idle reminder', async () => {
  const { result } = renderHook(() => useTrackingMode());
  await act(async () => {
    await result.current.switchToManual();
  });
  expect(cancelIdleReminder).toHaveBeenCalled();
  expect(result.current.mode).toBe('manual');
});

it('picks up a mode change made outside React (e.g. "Turn off GPS" from the notification) when the app returns to foreground', async () => {
  const listeners: Array<(s: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: any, l: any) => {
    listeners.push(l);
    return { remove: jest.fn() } as any;
  });

  const { result } = renderHook(() => useTrackingMode());
  expect(result.current.mode).toBe('auto');

  // Notification handler switched the saved mode while the app was in the background
  mockMode = 'manual';
  act(() => {
    for (const l of listeners) l('active');
  });

  expect(result.current.mode).toBe('manual');
});
