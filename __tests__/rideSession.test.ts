// Baseline tests for EXISTING code (src/services/rideSession.ts).
// These should pass today — they prove the Jest setup works.

const mockDb = {
  getFirstSync: jest.fn(),
  runSync: jest.fn(),
};
jest.mock('@/db/client', () => ({ getDb: () => mockDb }));
jest.mock('@/utils/logger', () => ({ logToFile: jest.fn() }));

import { haversineKm, addRideDistance } from '@/services/rideSession';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('haversineKm', () => {
  it('returns 0 for the same point', () => {
    expect(haversineKm(14.5995, 120.9842, 14.5995, 120.9842)).toBe(0);
  });

  it('measures ~111 km for one degree of latitude', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.19, 1);
  });

  it('treats 10 m as 0.01 km (the noise guard threshold)', () => {
    // 0.00009 degrees of latitude ≈ 10 m
    expect(haversineKm(0, 0, 0.00009, 0)).toBeCloseTo(0.01, 3);
  });
});

describe('addRideDistance', () => {
  it('adds the distance to the current odometer', () => {
    mockDb.getFirstSync.mockReturnValue({ current_odometer: 1000 });
    addRideDistance(7, 2.5);
    expect(mockDb.runSync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE vehicles SET current_odometer'),
      [1002.5, expect.any(String), 7]
    );
  });

  it('does nothing when the vehicle does not exist', () => {
    mockDb.getFirstSync.mockReturnValue(null);
    addRideDistance(99, 1);
    expect(mockDb.runSync).not.toHaveBeenCalled();
  });
});
