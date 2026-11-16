// Maintenance notification planner — decides WHAT to tell the rider and WHEN. Pure: no I/O, no clock reads
// (the caller passes `now`), so every rule is unit-testable. The I/O lives in maintenanceNotifications.ts.
//
// The rules (docs/maintenance-notifications-plan.md):
//   • Level = the same Settings thresholds that drive the badge (computeMaintenanceStatus), so they always agree.
//   • One notification per level (due → urgent → overdue); nothing repeats while an item stays overdue;
//     the memory resets when the item is ok again (service logged).
//   • km-based levels are sent as soon as they are noticed (a km threshold has no predictable date).
//   • date-based levels are pre-scheduled for the user's notify time on the day the level starts, so Android
//     delivers them even when the app is closed. A level whose time already passed today is sent now.
//   • Several notifications at the same moment can be merged into one summary (user setting).

import type { MaintenanceItem } from '@/types';
import {
  computeMaintenanceStatus,
  STATUS_RANK,
  parseLocalDate,
  addLocalDays,
  localDaysBetween,
} from '@/utils/reminderCheck';
import type { StatusThresholds } from '@/utils/reminderCheck';
import { notifyTimeToDate } from '@/utils/notifyTime';

// ─── Public constants and identifiers ─────────────────────────────────────────

export type NotifyLevel = 'due' | 'urgent' | 'overdue';
export const LEVELS: readonly NotifyLevel[] = ['due', 'urgent', 'overdue'];

/** Every identifier we schedule starts with this, so we can cancel ours without touching the GPS idle reminder. */
export const MAINT_ID_PREFIX = 'maint-';
const SUMMARY_ID_PREFIX = `${MAINT_ID_PREFIX}summary-`;

export function maintenanceIdentifier(itemId: number, level: NotifyLevel): string {
  return `${MAINT_ID_PREFIX}${itemId}-${level}`;
}

export function isMaintenanceIdentifier(id: string): boolean {
  return id.startsWith(MAINT_ID_PREFIX);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlannerEntry {
  item: MaintenanceItem;
  vehicleId: number;
  vehicleNickname: string;
  odometer: number;
}

/** A row of maintenance_notify_log. fire_at in the future = scheduled; in the past = delivered. */
export interface NotifyLogRow {
  item_id: number;
  level: NotifyLevel;
  fire_at: string;
}

export interface ItemRef {
  itemId: number;
  level: NotifyLevel;
}

export type NoticeData =
  | { type: 'maintenance'; itemId: number; vehicleId: number }
  | { type: 'maintenance_summary' };

export interface NoticePayload {
  title: string;
  body: string;
  data: NoticeData;
}

export interface PlannedNotification {
  identifier: string;
  payload: NoticePayload;
  /** What to record in the notify log once this has been sent / scheduled. */
  items: ItemRef[];
}

export interface ScheduledNotification extends PlannedNotification {
  fireAt: Date;
}

export interface PlanInput {
  entries: PlannerEntry[];
  thresholds: StatusThresholds;
  log: NotifyLogRow[];
  now: Date;
  /** "HH:MM" — when date-based reminders fire. */
  notifyTime: string;
  /** true → several notifications at the same moment become one summary. */
  grouped: boolean;
}

export interface PlanResult {
  /** Send immediately. */
  notifyNow: PlannedNotification[];
  /** Hand to Android for later. */
  schedule: ScheduledNotification[];
  /** Log rows to delete: item is ok again, dropped a level, or no longer exists. */
  clearLog: ItemRef[];
  /** Item dropped a level: record the lower level as already told so the next check doesn't re-announce it. */
  markSent: ItemRef[];
}

// ─── Wording ──────────────────────────────────────────────────────────────────

const RANK: Record<NotifyLevel, number> = { due: 1, urgent: 2, overdue: 3 };

const TITLES: Record<NotifyLevel, string> = {
  due: 'Service due soon',
  urgent: 'Service urgent',
  overdue: 'Service overdue',
};

const SUMMARY_LISTED = 3;

function kmText(kmRemaining: number): string {
  if (kmRemaining > 0) return `${Math.ceil(kmRemaining)} km left`;
  if (kmRemaining === 0) return 'due now';
  return `overdue by ${Math.ceil(-kmRemaining)} km`;
}

function dayText(daysRemaining: number): string {
  if (daysRemaining > 1) return `due in ${daysRemaining} days`;
  if (daysRemaining === 1) return 'due tomorrow';
  if (daysRemaining === 0) return 'due today';
  if (daysRemaining === -1) return 'overdue by 1 day';
  return `overdue by ${-daysRemaining} days`;
}

interface Notice {
  ref: ItemRef;
  vehicleId: number;
  vehicleNickname: string;
  category: string;
  /** Text after "Category on Vehicle: " */
  detail: string;
}

function itemPayload(n: Notice): NoticePayload {
  return {
    title: TITLES[n.ref.level],
    body: `${n.category} on ${n.vehicleNickname}: ${n.detail}`,
    data: { type: 'maintenance', itemId: n.ref.itemId, vehicleId: n.vehicleId },
  };
}

function summaryPayload(notices: Notice[]): NoticePayload {
  const listed = notices.slice(0, SUMMARY_LISTED).map((n) => `${n.category} (${n.vehicleNickname})`);
  const rest = notices.length - SUMMARY_LISTED;
  if (rest > 0) listed.push(`+${rest} more`);
  return {
    title: `${notices.length} services need attention`,
    body: listed.join(', '),
    data: { type: 'maintenance_summary' },
  };
}

function individual(n: Notice): PlannedNotification {
  return {
    identifier: maintenanceIdentifier(n.ref.itemId, n.ref.level),
    payload: itemPayload(n),
    items: [n.ref],
  };
}

function summary(notices: Notice[], stamp: number): PlannedNotification {
  return {
    identifier: `${SUMMARY_ID_PREFIX}${stamp}`,
    payload: summaryPayload(notices),
    items: notices.map((n) => n.ref),
  };
}

// ─── Date-based levels ────────────────────────────────────────────────────────

interface DateLevel {
  level: NotifyLevel;
  /** When the notification fires: the level's first day, at the user's notify time. */
  fireAt: Date;
  /** Days left until the due date on that first day (negative once overdue). */
  daysLeft: number;
}

/** The first day of each level, mirroring computeMaintenanceStatus: due ≤ earlyDays, urgent ≤ finalDays, overdue < 0. */
function dateLevels(dueDate: Date, t: StatusThresholds, notifyTime: string): DateLevel[] {
  const starts: Array<[NotifyLevel, Date]> = [
    ['due', addLocalDays(dueDate, -t.earlyDays)],
    ['urgent', addLocalDays(dueDate, -t.finalDays)],
    ['overdue', addLocalDays(dueDate, 1)],
  ];
  return starts.map(([level, day]) => ({
    level,
    fireAt: notifyTimeToDate(notifyTime, day),
    daysLeft: localDaysBetween(day, dueDate),
  }));
}

// ─── The plan ─────────────────────────────────────────────────────────────────

interface ItemPlan {
  immediate: Notice | null;
  scheduled: Array<{ notice: Notice; fireAt: Date }>;
  clear: ItemRef[];
  mark: ItemRef[];
}

function planItem(entry: PlannerEntry, input: PlanInput, pastRows: NotifyLogRow[]): ItemPlan {
  const { thresholds, now, notifyTime } = input;
  const { item, odometer } = entry;
  const nowMs = now.getTime();

  const base = (level: NotifyLevel): Notice => ({
    ref: { itemId: item.id, level },
    vehicleId: entry.vehicleId,
    vehicleNickname: entry.vehicleNickname,
    category: item.category,
    detail: '',
  });

  // What the badge shows today (date at day granularity) — also the ceiling for what we may have told them.
  const badge = computeMaintenanceStatus(item, odometer, thresholds, now);
  const cur = STATUS_RANK[badge.status ?? 'ok'];

  // km criterion alone: noticed immediately.
  const kmOnly = computeMaintenanceStatus({ ...item, next_due_date: undefined }, odometer, thresholds, now);
  const kmRank = STATUS_RANK[kmOnly.status ?? 'ok'];

  // date criterion: a level counts once its notify time has passed (the badge turns at midnight; we wait for the user's time).
  const dueDate = parseLocalDate(item.next_due_date);
  const levels = dueDate ? dateLevels(dueDate, thresholds, notifyTime) : [];
  const dateRank = levels.reduce((max, l) => (l.fireAt.getTime() <= nowMs ? Math.max(max, RANK[l.level]) : max), 0);

  const notifiable = Math.max(kmRank, dateRank);
  const sent = pastRows.reduce((max, r) => Math.max(max, RANK[r.level]), 0);

  // The item dropped below what we told them (service logged, due date moved out, thresholds lowered).
  const clear: ItemRef[] = [];
  const mark: ItemRef[] = [];
  let sentEffective = sent;
  if (sent > cur) {
    for (const r of pastRows) if (RANK[r.level] > cur) clear.push({ itemId: item.id, level: r.level });
    if (cur > 0 && !pastRows.some((r) => RANK[r.level] === cur)) mark.push({ itemId: item.id, level: LEVELS[cur - 1] });
    sentEffective = cur;
  }

  // Immediate: the highest level reached that they haven't been told about yet.
  let immediate: Notice | null = null;
  if (notifiable > sentEffective) {
    const level = LEVELS[notifiable - 1];
    const parts: string[] = [];
    if (kmRank >= RANK[level] && badge.km_remaining !== undefined) parts.push(kmText(badge.km_remaining));
    if (dateRank >= RANK[level] && badge.days_remaining !== undefined) parts.push(dayText(badge.days_remaining));
    immediate = { ...base(level), detail: parts.join(' · ') || 'needs attention' };
  }

  // Later: date levels still in the future that rise above everything already covered. Keep the ranks strictly
  // increasing in time, so a misordered threshold pair (final window longer than early) never yields a lower level after a higher one.
  const covered = Math.max(sentEffective, notifiable);
  const future = levels
    .filter((l) => l.fireAt.getTime() > nowMs && RANK[l.level] > covered)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || RANK[b.level] - RANK[a.level]);
  const scheduled: ItemPlan['scheduled'] = [];
  let top = covered;
  for (const l of future) {
    if (RANK[l.level] > top) {
      scheduled.push({ notice: { ...base(l.level), detail: dayText(l.daysLeft) }, fireAt: l.fireAt });
      top = RANK[l.level];
    }
  }

  return { immediate, scheduled, clear, mark };
}

export function planMaintenanceNotifications(input: PlanInput): PlanResult {
  const { entries, log, now, grouped } = input;
  const nowMs = now.getTime();

  const rowsByItem = new Map<number, NotifyLogRow[]>();
  for (const row of log) {
    if (!Object.prototype.hasOwnProperty.call(RANK, row.level)) continue; // corrupted row — ignore
    const rows = rowsByItem.get(row.item_id) ?? [];
    rows.push(row);
    rowsByItem.set(row.item_id, rows);
  }

  const clearLog: ItemRef[] = [];
  const markSent: ItemRef[] = [];
  const immediate: Notice[] = [];
  const scheduled: Array<{ notice: Notice; fireAt: Date }> = [];

  // Rows of items that no longer exist (deleted item / vehicle).
  const known = new Set(entries.map((e) => e.item.id));
  for (const [itemId, rows] of rowsByItem) {
    if (!known.has(itemId)) for (const r of rows) clearLog.push({ itemId, level: r.level });
  }

  for (const entry of entries) {
    // Rows dated in the future are schedules that were just cancelled — they say nothing about what was delivered.
    const past = (rowsByItem.get(entry.item.id) ?? []).filter((r) => Date.parse(r.fire_at) <= nowMs);
    const plan = planItem(entry, input, past);
    if (plan.immediate) immediate.push(plan.immediate);
    scheduled.push(...plan.scheduled);
    clearLog.push(...plan.clear);
    markSent.push(...plan.mark);
  }

  // Immediate: one summary for the lot, or one each.
  const notifyNow =
    grouped && immediate.length > 1 ? [summary(immediate, nowMs)] : immediate.map(individual);

  // Scheduled: merge only what fires at the very same moment.
  scheduled.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
  const schedule: ScheduledNotification[] = [];
  let i = 0;
  while (i < scheduled.length) {
    let j = i;
    while (j < scheduled.length && scheduled[j].fireAt.getTime() === scheduled[i].fireAt.getTime()) j++;
    const group = scheduled.slice(i, j);
    const fireAt = group[0].fireAt;
    if (grouped && group.length > 1) {
      schedule.push({ ...summary(group.map((g) => g.notice), fireAt.getTime()), fireAt });
    } else {
      for (const g of group) schedule.push({ ...individual(g.notice), fireAt });
    }
    i = j;
  }

  return { notifyNow, schedule, clearLog, markSent };
}
