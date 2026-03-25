// Pure service — no React, no UI. Used by both foreground hook and background task.

import { getDb } from '@/db/client';
import { logToFile } from '@/utils/logger';

// ─── Haversine formula ────────────────────────────────────────────────────────
// Returns distance in kilometres between two GPS coordinates.

export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Odometer update ──────────────────────────────────────────────────────────
// Reads the vehicle's current odometer, adds the delta, writes back.
// Used at end of a manual session and on each background task update.

export function addRideDistance(vehicleId: number, distanceKm: number): void {
  try {
    const db = getDb();
    const row = db.getFirstSync<{ current_odometer: number }>(
      'SELECT current_odometer FROM vehicles WHERE id = ?',
      [vehicleId]
    );
    if (!row) return;
    const newOdo = row.current_odometer + distanceKm;
    db.runSync(
      'UPDATE vehicles SET current_odometer = ?, updated_at = ? WHERE id = ?',
      [newOdo, new Date().toISOString(), vehicleId]
    );
  } catch (e) {
    logToFile('RIDE_SESSION', 'addRideDistance', String(e));
  }
}
