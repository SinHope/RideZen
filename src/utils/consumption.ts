/**
 * Format a Date as YYYY-MM-DD in the device's local timezone.
 * (Unlike toISOString(), which is UTC and gives yesterday's date before 8am SGT.)
 */
export function toLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format consumption for display.
 */
export function formatConsumption(value: number | null | undefined): string {
  if (value == null || value === 0) return '—';
  return `${value.toFixed(1)} L/100km`;
}

/**
 * Format currency in SGD.
 */
export function formatCurrency(value: number, currency = 'SGD'): string {
  return `${currency} ${value.toFixed(2)}`;
}

/**
 * Format odometer reading with thousand separators.
 */
export function formatOdometer(value: number): string {
  return `${Math.round(value).toLocaleString()} km`;
}

/**
 * Format date string to display format.
 */
export function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Get days since a date string.
 */
export function daysSince(dateStr: string): number {
  const past = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - past.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Get a human-readable "X days ago" string.
 */
export function daysAgoLabel(dateStr: string): string {
  const days = daysSince(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return '1 month ago';
  return `${Math.floor(days / 30)} months ago`;
}
