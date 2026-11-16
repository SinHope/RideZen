import { MaintenanceItem, MaintenanceStatus } from '@/types';

// ─── Local-date helpers ───────────────────────────────────────────────────────
// Due dates are stored as plain "YYYY-MM-DD". `new Date('2026-11-20')` is UTC midnight, which in a
// negative-UTC timezone is still the 19th — so dates must be read as the LOCAL calendar day.
// The badge (computeMaintenanceStatus) and the notification planner both use these, so they always agree.

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" (or an ISO date-time) → local midnight of that calendar day; null if unreadable. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) {
    const d = new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

/** `date` moved by whole calendar days, still at local midnight (DST-safe). */
export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole calendar days from `from` to `to` (both local midnights; negative when `to` is earlier). */
export function localDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export interface StatusThresholds {
  earlyKm: number;
  earlyDays: number;
  finalKm: number;
  finalDays: number;
}

export const DEFAULT_THRESHOLDS: StatusThresholds = {
  earlyKm: 1000,
  earlyDays: 14,
  finalKm: 200,
  finalDays: 3,
};

export function loadStatusThresholds(): StatusThresholds {
  try {
    // Dynamic import avoided — use a lazy require so this file stays free of DB deps
    const { getDb } = require('@/db/client');
    const db = getDb();
    const get = (key: string, fallback: number) => {
      const row = db.getFirstSync<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
      const n = row ? parseFloat(row.value) : NaN;
      return isNaN(n) || n <= 0 ? fallback : n;
    };
    return {
      earlyKm: get('early_warning_km', DEFAULT_THRESHOLDS.earlyKm),
      earlyDays: get('early_warning_days', DEFAULT_THRESHOLDS.earlyDays),
      finalKm: get('final_reminder_km', DEFAULT_THRESHOLDS.finalKm),
      finalDays: get('final_reminder_days', DEFAULT_THRESHOLDS.finalDays),
    };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function computeMaintenanceStatus(
  item: MaintenanceItem,
  currentOdometer: number,
  thresholds: StatusThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date()
): MaintenanceItem {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const { earlyKm, earlyDays, finalKm, finalDays } = thresholds;

  let status: MaintenanceStatus = 'ok';
  let kmRemaining: number | undefined;
  let daysRemaining: number | undefined;
  let progressPct = 0;

  // Check km-based status
  if (item.next_due_odo != null && item.interval_km != null) {
    kmRemaining = item.next_due_odo - currentOdometer;
    const kmUsed = item.interval_km - Math.max(kmRemaining, 0);
    progressPct = Math.min(100, Math.max(0, (kmUsed / item.interval_km) * 100));

    if (kmRemaining <= 0) {
      status = 'overdue';
    } else if (kmRemaining <= finalKm) {
      status = statusMax(status, 'urgent');
    } else if (kmRemaining <= earlyKm) {
      status = statusMax(status, 'due');
    }
  }

  // Check date-based status
  const dueDate = parseLocalDate(item.next_due_date);
  if (dueDate) {
    daysRemaining = localDaysBetween(today, dueDate);

    if (item.interval_days != null) {
      const daysUsed = item.interval_days - Math.max(daysRemaining, 0);
      const datePct = Math.min(100, Math.max(0, (daysUsed / item.interval_days) * 100));
      progressPct = Math.max(progressPct, datePct);
    }

    if (daysRemaining < 0) {
      status = 'overdue';
    } else if (daysRemaining <= finalDays) {
      status = statusMax(status, 'urgent');
    } else if (daysRemaining <= earlyDays) {
      status = statusMax(status, 'due');
    }
  }

  return {
    ...item,
    status,
    km_remaining: kmRemaining,
    days_remaining: daysRemaining,
    progress_pct: progressPct,
  };
}

export const STATUS_RANK: Record<MaintenanceStatus, number> = { ok: 0, due: 1, urgent: 2, overdue: 3 };

function statusMax(a: MaintenanceStatus, b: MaintenanceStatus): MaintenanceStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}
