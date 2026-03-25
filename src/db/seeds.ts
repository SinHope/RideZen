import { SQLiteDatabase } from 'expo-sqlite';
import { VehicleType } from '@/types';

interface SeedItem {
  category: string;
  scope: string;
  interval_km?: number;
  interval_days?: number;
  early_km?: number;
  early_days?: number;
  final_km?: number;
  final_days?: number;
}

const UNIVERSAL_SEEDS: SeedItem[] = [
  { category: 'Engine Oil',       scope: 'universal', interval_km: 5000,  interval_days: 90,  early_km: 1000, early_days: 14, final_km: 200, final_days: 3 },
  { category: 'Air Filter',       scope: 'universal', interval_km: 10000, interval_days: 365, early_km: 1500, early_days: 30, final_km: 300, final_days: 7 },
  { category: 'Spark Plug',       scope: 'universal', interval_km: 10000, interval_days: 365, early_km: 1500, early_days: 30, final_km: 300, final_days: 7 },
  { category: 'Front Brake Pads', scope: 'universal', interval_km: 15000, early_km: 2000, final_km: 500 },
  { category: 'Rear Brake Pads',  scope: 'universal', interval_km: 15000, early_km: 2000, final_km: 500 },
  { category: 'Brake Fluid',      scope: 'universal', interval_days: 730, early_days: 30, final_days: 7 },
  { category: 'Front Tyre',       scope: 'universal', interval_km: 30000, early_km: 3000, final_km: 500 },
  { category: 'Rear Tyre',        scope: 'universal', interval_km: 25000, early_km: 3000, final_km: 500 },
  { category: 'Battery',          scope: 'universal', interval_days: 730, early_days: 30, final_days: 7 },
  { category: 'Coolant',          scope: 'universal', interval_days: 730, early_days: 30, final_days: 7 },
];

const SCOOTER_SEEDS: SeedItem[] = [
  { category: 'Gear Oil',           scope: 'scooter', interval_km: 5000,  interval_days: 180, early_km: 1000, early_days: 14, final_km: 200, final_days: 3 },
  { category: 'CVT Basic Service',  scope: 'scooter', interval_km: 8000,  early_km: 1500, final_km: 300 },
  { category: 'CVT Rollers',        scope: 'scooter', interval_km: 12000, early_km: 2000, final_km: 500 },
  { category: 'CVT V Belt',         scope: 'scooter', interval_km: 25000, early_km: 3000, final_km: 500 },
  { category: 'CVT Variator/Pulley',scope: 'scooter', interval_km: 20000, early_km: 2500, final_km: 500 },
];

const MANUAL_BIKE_SEEDS: SeedItem[] = [
  { category: 'Gear Oil',               scope: 'manual_bike', interval_km: 5000,  interval_days: 180, early_km: 1000, early_days: 14, final_km: 200, final_days: 3 },
  { category: 'Chain Lubrication',      scope: 'manual_bike', interval_km: 800,   early_km: 200, final_km: 50 },
  { category: 'Chain Adjustment',       scope: 'manual_bike', interval_km: 2500,  early_km: 500, final_km: 100 },
  { category: 'Chain Replacement',      scope: 'manual_bike', interval_km: 18000, early_km: 2000, final_km: 500 },
  { category: 'Clutch Cable Inspection',scope: 'manual_bike', interval_km: 10000, early_km: 1500, final_km: 300 },
];

const CAR_SEEDS: SeedItem[] = [
  { category: 'Transmission Oil',    scope: 'car', interval_km: 50000, early_km: 3000, final_km: 500 },
  { category: 'Timing Belt/Chain',   scope: 'car', interval_km: 80000, early_km: 5000, early_days: 30, final_km: 1000, final_days: 7 },
  { category: 'Cabin Air Filter',    scope: 'car', interval_km: 15000, interval_days: 365, early_km: 2000, early_days: 30, final_km: 500, final_days: 7 },
  { category: 'Power Steering Fluid',scope: 'car', interval_days: 730, early_days: 30, final_days: 7 },
  { category: 'Wiper Blades',        scope: 'car', interval_days: 365, early_days: 30, final_days: 7 },
];

export function seedMaintenanceItems(db: SQLiteDatabase, vehicleId: number, vehicleType: VehicleType, baseOdometer: number): void {
  const items: SeedItem[] = [...UNIVERSAL_SEEDS];

  if (vehicleType === 'scooter') items.push(...SCOOTER_SEEDS);
  else if (vehicleType === 'manual_bike') items.push(...MANUAL_BIKE_SEEDS);
  else if (vehicleType === 'car') items.push(...CAR_SEEDS);

  const today = new Date().toISOString().split('T')[0];

  for (const item of items) {
    // Calculate next_due_odo and next_due_date from current odometer
    const nextDueOdo = item.interval_km ? baseOdometer + item.interval_km : null;
    const nextDueDate = item.interval_days
      ? (() => {
          const d = new Date();
          d.setDate(d.getDate() + item.interval_days!);
          return d.toISOString().split('T')[0];
        })()
      : null;

    const result = db.runSync(
      `INSERT INTO maintenance_items
       (vehicle_id, category, vehicle_type_scope, interval_km, interval_days, next_due_odo, next_due_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [vehicleId, item.category, item.scope, item.interval_km ?? null, item.interval_days ?? null,
       nextDueOdo, nextDueDate, today]
    );

    const itemId = result.lastInsertRowId;

    // Seed reminder settings
    db.runSync(
      `INSERT INTO reminder_settings
       (item_id, early_km_before, early_days_before, early_enabled, final_km_before, final_days_before, final_enabled)
       VALUES (?, ?, ?, 1, ?, ?, 1)`,
      [itemId, item.early_km ?? null, item.early_days ?? null, item.final_km ?? null, item.final_days ?? null]
    );
  }
}
