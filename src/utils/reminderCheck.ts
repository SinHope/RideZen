import { MaintenanceItem, MaintenanceStatus, ReminderSettings } from '@/types';

/**
 * Compute the maintenance status and remaining km/days for an item.
 * Status hierarchy: overdue > urgent > due > ok
 */
export function computeMaintenanceStatus(
  item: MaintenanceItem,
  currentOdometer: number
): MaintenanceItem {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
    } else if (kmRemaining <= 200) {
      status = statusMax(status, 'urgent');
    } else if (kmRemaining <= 1000) {
      status = statusMax(status, 'due');
    }
  }

  // Check date-based status
  if (item.next_due_date != null) {
    const dueDate = new Date(item.next_due_date);
    dueDate.setHours(0, 0, 0, 0);
    daysRemaining = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (item.interval_days != null) {
      const daysUsed = item.interval_days - Math.max(daysRemaining, 0);
      const datePct = Math.min(100, Math.max(0, (daysUsed / item.interval_days) * 100));
      progressPct = Math.max(progressPct, datePct);
    }

    if (daysRemaining < 0) {
      status = 'overdue';
    } else if (daysRemaining <= 3) {
      status = statusMax(status, 'urgent');
    } else if (daysRemaining <= 14) {
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

const STATUS_RANK: Record<MaintenanceStatus, number> = { ok: 0, due: 1, urgent: 2, overdue: 3 };

function statusMax(a: MaintenanceStatus, b: MaintenanceStatus): MaintenanceStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * Check which reminders should fire given current odometer and today's date.
 * Returns 'early' | 'final' | null for each item.
 */
export function checkReminderTrigger(
  item: MaintenanceItem,
  reminder: ReminderSettings,
  currentOdometer: number
): 'early' | 'final' | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check final reminder first (higher priority)
  if (reminder.final_enabled === 1) {
    const kmTrigger = item.next_due_odo != null && reminder.final_km_before != null
      ? currentOdometer >= item.next_due_odo - reminder.final_km_before
      : false;
    const daysTrigger = item.next_due_date != null && reminder.final_days_before != null
      ? (() => {
          const dueDate = new Date(item.next_due_date!);
          const daysLeft = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
          return daysLeft <= reminder.final_days_before;
        })()
      : false;
    if (kmTrigger || daysTrigger) return 'final';
  }

  // Check early warning
  if (reminder.early_enabled === 1) {
    const kmTrigger = item.next_due_odo != null && reminder.early_km_before != null
      ? currentOdometer >= item.next_due_odo - reminder.early_km_before
      : false;
    const daysTrigger = item.next_due_date != null && reminder.early_days_before != null
      ? (() => {
          const dueDate = new Date(item.next_due_date!);
          const daysLeft = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
          return daysLeft <= reminder.early_days_before;
        })()
      : false;
    if (kmTrigger || daysTrigger) return 'early';
  }

  return null;
}
