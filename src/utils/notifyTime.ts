// "Notification time" setting helpers — pure, no I/O.
// The time is stored as a strict 24-hour "HH:MM" string (e.g. "20:30") in app_settings.

export const DEFAULT_NOTIFY_TIME = '09:00';

const NOTIFY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidNotifyTime(value: unknown): value is string {
  return typeof value === 'string' && NOTIFY_TIME_RE.test(value);
}

/** Splits "HH:MM". Anything invalid falls back to the default (09:00) so callers never see NaN. */
export function parseNotifyTime(value: unknown): { hours: number; minutes: number } {
  const text = isValidNotifyTime(value) ? value : DEFAULT_NOTIFY_TIME;
  const [hours, minutes] = text.split(':').map(Number);
  return { hours, minutes };
}

/** "20:30" → "8:30 PM". Invalid input shows the default time. */
export function formatNotifyTime(value: unknown): string {
  const { hours, minutes } = parseNotifyTime(value);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** The given calendar day (local) at the notify time, seconds zeroed. Does not mutate `base`. */
export function notifyTimeToDate(value: unknown, base: Date = new Date()): Date {
  const { hours, minutes } = parseNotifyTime(value);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
}

/** Local "HH:MM", zero-padded — what the time dialog hands back, ready to store. */
export function dateToNotifyTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
