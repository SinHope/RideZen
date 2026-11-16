// Manual Ride Session + idle reminder.
// Module under test (EXISTS, needs change): src/contexts/RideSessionContext.tsx

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

let mockWatchCallback: ((loc: any) => void) | null = null;
const mockRemove = jest.fn();

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  watchPositionAsync: jest.fn(async (_opts: any, cb: (loc: any) => void) => {
    mockWatchCallback = cb;
    return { remove: mockRemove };
  }),
  Accuracy: { Balanced: 3 },
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
const mockStopListeners: Array<() => void> = [];
const mockUnsubscribe = jest.fn();
jest.mock(
  '@/notifications/idleResponseHandler',
  () => ({
    onManualRideStopRequested: jest.fn((l: () => void) => {
      mockStopListeners.push(l);
      // Real unsubscribe semantics: remove this listener only
      return () => {
        mockUnsubscribe();
        const i = mockStopListeners.indexOf(l);
        if (i >= 0) mockStopListeners.splice(i, 1);
      };
    }),
  })
);
jest.mock('@/notifications/maintenanceSyncSignal', () => ({ requestMaintenanceSync: jest.fn() }));
jest.mock('@/db/client', () => ({ getDb: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { RideSessionProvider, useRideSession } from '@/contexts/RideSessionContext';
import { addRideDistance } from '@/services/rideSession';
import { armIdleReminder, cancelIdleReminder } from '@/notifications/idleReminder';
import { requestMaintenanceSync } from '@/notifications/maintenanceSyncSignal';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RideSessionProvider>{children}</RideSessionProvider>
);

const START = { latitude: 14.5995, longitude: 120.9842 };
const at = (dLat: number) => ({ coords: { latitude: START.latitude + dLat, longitude: START.longitude } });
const MOVE_50M = 0.00045;
const JITTER_3M = 0.000027;

beforeEach(() => {
  jest.clearAllMocks();
  mockWatchCallback = null;
  mockStopListeners.length = 0;
});

async function startRide(result: any, vehicleId = 1) {
  await act(async () => {
    await result.current.startRide(vehicleId);
  });
  // first fix sets the reference point
  act(() => mockWatchCallback!({ coords: START }));
}

describe('existing behaviour', () => {
  it('saves the ridden distance on endRide', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    act(() => mockWatchCallback!(at(MOVE_50M)));
    await act(async () => {
      await result.current.endRide();
    });
    expect(addRideDistance).toHaveBeenCalledWith(1, expect.closeTo(0.05, 2));
  });
});

describe('idle reminder', () => {
  it('arms the reminder when a ride starts (rider who never moves still gets reminded)', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    expect(armIdleReminder).toHaveBeenCalled();
  });

  it('re-arms when the rider really moves', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    (armIdleReminder as jest.Mock).mockClear();

    act(() => mockWatchCallback!(at(MOVE_50M)));
    expect(armIdleReminder).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-arm on GPS jitter', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    (armIdleReminder as jest.Mock).mockClear();

    act(() => mockWatchCallback!(at(JITTER_3M)));
    expect(armIdleReminder).not.toHaveBeenCalled();
  });

  it('cancels the reminder when the ride ends', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    await act(async () => {
      await result.current.endRide();
    });
    expect(cancelIdleReminder).toHaveBeenCalled();
  });
});

// The ride just added km to the odometer, so a maintenance level (due / urgent / overdue) may have been crossed.
describe('maintenance notifications', () => {
  it('asks for a re-check after the ridden distance is saved', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    act(() => mockWatchCallback!(at(MOVE_50M)));
    await act(async () => {
      await result.current.endRide();
    });

    expect(requestMaintenanceSync).toHaveBeenCalledTimes(1);
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(addRideDistance as jest.Mock)).toBeLessThan(order(requestMaintenanceSync as jest.Mock));
  });

  it('does not ask when the ride added no distance', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    await act(async () => {
      await result.current.endRide();
    });
    expect(requestMaintenanceSync).not.toHaveBeenCalled();
  });

  it('does not ask while the ride is still going', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result);
    act(() => mockWatchCallback!(at(MOVE_50M)));
    expect(requestMaintenanceSync).not.toHaveBeenCalled();
  });
});

describe('"Turn off GPS" from the notification (manual mode)', () => {
  it('subscribes to stop requests', () => {
    renderHook(() => useRideSession(), { wrapper });
    expect(mockStopListeners.length).toBeGreaterThan(0);
  });

  it('ends the ride, stops GPS and saves distance (uses the LATEST ride state)', async () => {
    const { result } = renderHook(() => useRideSession(), { wrapper });
    await startRide(result, 42);
    act(() => mockWatchCallback!(at(MOVE_50M)));

    await act(async () => {
      for (const l of [...mockStopListeners]) l();
    });

    expect(mockRemove).toHaveBeenCalled(); // GPS watch stopped
    expect(result.current.isTracking).toBe(false);
    expect(addRideDistance).toHaveBeenCalledWith(42, expect.closeTo(0.05, 2));
  });

  it('is harmless when no ride is active', async () => {
    renderHook(() => useRideSession(), { wrapper });
    await act(async () => {
      for (const l of [...mockStopListeners]) l();
    });
    expect(addRideDistance).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useRideSession(), { wrapper });
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});
