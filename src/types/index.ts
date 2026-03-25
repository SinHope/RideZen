// ─── Vehicle ────────────────────────────────────────────────────────────────

export type VehicleType = 'scooter' | 'manual_bike' | 'car' | 'other';

export interface Vehicle {
  id: number;
  nickname: string;
  type: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  plate_number?: string;
  photo_uri?: string;
  current_odometer: number;
  created_at: string;
  updated_at: string;
}

export interface VehicleInput {
  nickname: string;
  type: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  plate_number?: string;
  photo_uri?: string;
  current_odometer: number;
}

// ─── Fuel Log ────────────────────────────────────────────────────────────────

export interface FuelLog {
  id: number;
  vehicle_id: number;
  date: string;
  odometer: number;
  litres: number;
  price_per_litre?: number;
  is_full_tank: number; // 1 = full, 0 = partial
  notes?: string;
  km_since_last?: number;
  consumption?: number; // L/100km
  created_at: string;
}

export interface FuelLogInput {
  vehicle_id: number;
  date: string;
  odometer: number;
  litres: number;
  price_per_litre?: number;
  is_full_tank: boolean;
  notes?: string;
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

export type VehicleTypeScope = 'universal' | 'scooter' | 'manual_bike' | 'car';
export type MaintenanceStatus = 'ok' | 'due' | 'urgent' | 'overdue';

export interface MaintenanceItem {
  id: number;
  vehicle_id: number;
  category: string;
  vehicle_type_scope: VehicleTypeScope;
  last_changed_date?: string;
  last_changed_odo?: number;
  next_due_date?: string;
  next_due_odo?: number;
  interval_km?: number;
  interval_days?: number;
  notes?: string;
  updated_at: string;
  // computed
  status?: MaintenanceStatus;
  km_remaining?: number;
  days_remaining?: number;
  progress_pct?: number;
}

export interface MaintenanceLog {
  id: number;
  item_id: number;
  vehicle_id: number;
  date: string;
  odometer?: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  created_at: string;
}

export interface MaintenanceLogInput {
  item_id: number;
  vehicle_id: number;
  date: string;
  odometer?: number;
  cost?: number;
  workshop?: string;
  notes?: string;
}

export interface ServiceLogInput {
  item_id: number;
  vehicle_id: number;
  date: string;
  odometer?: number;
  cost?: number;
  workshop?: string;
  notes?: string;
  new_interval_km?: number;
  new_interval_days?: number;
}

// ─── Reminder Settings ────────────────────────────────────────────────────────

export interface ReminderSettings {
  id: number;
  item_id: number;
  early_km_before?: number;
  early_days_before?: number;
  early_enabled: number;
  final_km_before?: number;
  final_days_before?: number;
  final_enabled: number;
}

// ─── Result Pattern ───────────────────────────────────────────────────────────

export type Result<T> = { data: T; error: null } | { data: null; error: string };

// ─── App State ────────────────────────────────────────────────────────────────

export interface GarageStats {
  total_fuel_cost_month: number;
  avg_consumption: number;
  avg_vehicle_nickname?: string;
  overdue_count: number;
}
