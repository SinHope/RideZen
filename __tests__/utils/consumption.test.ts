/**
 * consumption.ts — formatting and date helpers used across the Fuel, Home and Vehicle screens.
 * "Now" is frozen at 17 Nov 2026, local noon.
 */
import {
  daysAgoLabel,
  daysSince,
  formatConsumption,
  formatCurrency,
  formatDate,
  formatOdometer,
  toLocalDateString,
} from '@/utils/consumption';
import { freezeClock, unfreezeClock } from '../helpers/testDb';

beforeEach(() => freezeClock(2026, 10, 17));
afterEach(() => unfreezeClock());

describe('toLocalDateString', () => {
  it('formats the given date as YYYY-MM-DD in local time', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toLocalDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(toLocalDateString(new Date(2026, 2, 9))).toBe('2026-03-09');
  });

  it('uses the LOCAL day, even just after local midnight (toISOString would give yesterday in UTC+8)', () => {
    expect(toLocalDateString(new Date(2026, 10, 18, 0, 5))).toBe('2026-11-18');
  });

  it('defaults to today', () => {
    expect(toLocalDateString()).toBe('2026-11-17');
  });
});

describe('formatConsumption', () => {
  it('shows one decimal and the unit', () => {
    expect(formatConsumption(5.123)).toBe('5.1 L/100km');
    expect(formatConsumption(5)).toBe('5.0 L/100km');
  });

  it.each([null, undefined, 0])('shows a dash for %p (no figure yet)', (value) => {
    expect(formatConsumption(value as any)).toBe('—');
  });
});

describe('formatCurrency', () => {
  it('defaults to SGD with two decimals', () => {
    expect(formatCurrency(12.5)).toBe('SGD 12.50');
    expect(formatCurrency(0)).toBe('SGD 0.00');
  });

  it('uses the currency given', () => {
    expect(formatCurrency(3.456, 'MYR')).toBe('MYR 3.46');
  });
});

describe('formatOdometer', () => {
  it('rounds to a whole number with thousands separators', () => {
    expect(formatOdometer(12345.6)).toBe(`${(12346).toLocaleString()} km`);
    expect(formatOdometer(999.4)).toBe('999 km');
    expect(formatOdometer(0)).toBe('0 km');
  });
});

describe('formatDate', () => {
  it('shows day, short month and year', () => {
    expect(formatDate('2026-11-17T12:00:00')).toMatch(/17\s+Nov\s+2026|Nov\s+17,\s+2026/);
  });
});

describe('daysSince', () => {
  it('counts whole days back from now', () => {
    expect(daysSince('2026-11-17')).toBe(0);
    expect(daysSince('2026-11-16')).toBe(1);
    expect(daysSince('2026-11-10')).toBe(7);
    expect(daysSince('2026-10-17')).toBe(31);
  });
});

describe('daysAgoLabel', () => {
  // [date, label] relative to 17 Nov 2026
  it.each([
    ['2026-11-17', 'today'],
    ['2026-11-16', '1 day ago'],
    ['2026-11-14', '3 days ago'],
    ['2026-11-11', '6 days ago'],
    ['2026-11-10', '1 week ago'], // 7 days
    ['2026-11-04', '1 week ago'], // 13 days
    ['2026-11-03', '2 weeks ago'], // 14 days
    ['2026-10-25', '3 weeks ago'], // 23 days
    ['2026-10-19', '4 weeks ago'], // 29 days
    ['2026-10-18', '1 month ago'], // 30 days
    ['2026-09-20', '1 month ago'], // 58 days
    ['2026-09-18', '2 months ago'], // 60 days
    ['2026-05-01', '6 months ago'],
  ])('%s → %s', (date, label) => {
    expect(daysAgoLabel(date)).toBe(label);
  });
});
