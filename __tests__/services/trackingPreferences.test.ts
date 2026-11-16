/**
 * trackingPreferences — GPS / onboarding / tutorial settings stored in app_settings (real SQLite via sql.js).
 */
jest.mock('@/db/client', () => ({ getDb: () => require('../helpers/testDb').getCurrentDb() }));

import {
  clearBgLastCoords,
  getAutoTrackVehicleId,
  getBgLastCoords,
  getTrackingMode,
  isOnboardingShown,
  isTutorialShown,
  setAutoTrackVehicleId,
  setBgLastCoords,
  setOnboardingShown,
  setTrackingMode,
  setTutorialShown,
} from '@/services/trackingPreferences';
import { TestDb, createMigratedDb, setCurrentDb } from '../helpers/testDb';

let db: TestDb;
const raw = (key: string) => db.getFirstSync<any>('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null;
const put = (key: string, value: string) => db.runSync('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);

beforeEach(async () => {
  db = await createMigratedDb();
  setCurrentDb(db);
});
afterEach(() => setCurrentDb(null));

describe('tracking mode', () => {
  it('is manual until the rider switches', () => {
    expect(getTrackingMode()).toBe('manual');
  });

  it('remembers auto, and switching back to manual', () => {
    setTrackingMode('auto');
    expect(getTrackingMode()).toBe('auto');
    setTrackingMode('manual');
    expect(getTrackingMode()).toBe('manual');
    expect(db.count('app_settings')).toBe(1); // replaced, not duplicated
  });
});

describe('onboarding / tutorial flags', () => {
  it('start unseen, then stay seen', () => {
    expect(isOnboardingShown()).toBe(false);
    expect(isTutorialShown()).toBe(false);
    setOnboardingShown();
    setTutorialShown();
    expect(isOnboardingShown()).toBe(true);
    expect(isTutorialShown()).toBe(true);
  });

  it('are independent of each other', () => {
    setTutorialShown();
    expect(isOnboardingShown()).toBe(false);
  });

  it('only the exact string "true" counts as seen', () => {
    put('tutorial_shown', 'yes');
    expect(isTutorialShown()).toBe(false);
  });
});

describe('auto-track vehicle', () => {
  it('is null until one is chosen', () => {
    expect(getAutoTrackVehicleId()).toBeNull();
  });

  it('remembers the chosen vehicle id as a number', () => {
    setAutoTrackVehicleId(7);
    expect(getAutoTrackVehicleId()).toBe(7);
    setAutoTrackVehicleId(12);
    expect(getAutoTrackVehicleId()).toBe(12);
  });

  it.each(['abc', '', 'NaN'])('is null for a corrupt stored value (%p)', (value) => {
    put('auto_track_vehicle_id', value);
    expect(getAutoTrackVehicleId()).toBeNull();
  });
});

describe('background GPS coordinates (survive task restarts)', () => {
  it('are null until saved', () => {
    expect(getBgLastCoords()).toBeNull();
  });

  it('round-trip with full precision, including negatives', () => {
    setBgLastCoords(1.352083, -103.819836);
    expect(getBgLastCoords()).toEqual({ lat: 1.352083, lon: -103.819836 });
  });

  it('saving again replaces the old position', () => {
    setBgLastCoords(1, 2);
    setBgLastCoords(3, 4);
    expect(getBgLastCoords()).toEqual({ lat: 3, lon: 4 });
  });

  it('a zero coordinate is a real position, not "missing"', () => {
    setBgLastCoords(0, 0);
    expect(getBgLastCoords()).toEqual({ lat: 0, lon: 0 });
  });

  it('can be cleared', () => {
    setBgLastCoords(1.3, 103.8);
    clearBgLastCoords();
    expect(getBgLastCoords()).toBeNull();
    expect(raw('bg_last_lat')).toBeNull();
    expect(raw('bg_last_lon')).toBeNull();
  });

  it('clearing leaves other settings alone', () => {
    setTrackingMode('auto');
    setBgLastCoords(1, 2);
    clearBgLastCoords();
    expect(getTrackingMode()).toBe('auto');
  });

  it('is null when only one half is stored, or the value is not a number', () => {
    put('bg_last_lat', '1.3');
    expect(getBgLastCoords()).toBeNull();
    put('bg_last_lon', 'oops');
    expect(getBgLastCoords()).toBeNull();
  });
});
