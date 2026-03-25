// All tracking preferences stored in the app_settings SQLite table (migration V2).
// Functions are synchronous — uses the same sync SQLite API as the rest of the app.

import { getDb } from '@/db/client';

type TrackingMode = 'manual' | 'auto';

function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.getFirstSync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  db.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    [key, value, new Date().toISOString()]
  );
}

// ─── Tracking mode ────────────────────────────────────────────────────────────

export function getTrackingMode(): TrackingMode {
  return (getSetting('tracking_mode') as TrackingMode) ?? 'manual';
}

export function setTrackingMode(mode: TrackingMode): void {
  setSetting('tracking_mode', mode);
}

// ─── Onboarding shown flag ────────────────────────────────────────────────────

export function isOnboardingShown(): boolean {
  return getSetting('onboarding_tracking_shown') === 'true';
}

export function setOnboardingShown(): void {
  setSetting('onboarding_tracking_shown', 'true');
}

// ─── Auto-track vehicle ID ────────────────────────────────────────────────────

export function getAutoTrackVehicleId(): number | null {
  const val = getSetting('auto_track_vehicle_id');
  if (!val) return null;
  const id = parseInt(val, 10);
  return isNaN(id) ? null : id;
}

export function setAutoTrackVehicleId(vehicleId: number): void {
  setSetting('auto_track_vehicle_id', String(vehicleId));
}

// ─── Background GPS last known coords (persists task restarts) ────────────────

export function getBgLastCoords(): { lat: number; lon: number } | null {
  const lat = getSetting('bg_last_lat');
  const lon = getSetting('bg_last_lon');
  if (!lat || !lon) return null;
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (isNaN(latNum) || isNaN(lonNum)) return null;
  return { lat: latNum, lon: lonNum };
}

export function setBgLastCoords(lat: number, lon: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['bg_last_lat', String(lat), now]
  );
  db.runSync(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['bg_last_lon', String(lon), now]
  );
}

export function clearBgLastCoords(): void {
  const db = getDb();
  db.runSync("DELETE FROM app_settings WHERE key IN ('bg_last_lat', 'bg_last_lon')");
}
