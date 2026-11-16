// "Notification time" setting helpers (pure).
// Module under test (NOT YET IMPLEMENTED): src/utils/notifyTime.ts
//
// Expected exports:
//   DEFAULT_NOTIFY_TIME = '09:00'
//   isValidNotifyTime(v: unknown): boolean            // strict 24-hour "HH:MM"
//   parseNotifyTime(v: unknown): { hours, minutes }   // invalid → 09:00
//   formatNotifyTime(v: unknown): string              // '20:30' → '8:30 PM' (invalid → '9:00 AM')
//   notifyTimeToDate(v: unknown, base?: Date): Date   // base's calendar day (local) at that time
//   dateToNotifyTime(d: Date): string                 // local "HH:MM", zero-padded

import {
  DEFAULT_NOTIFY_TIME,
  isValidNotifyTime,
  parseNotifyTime,
  formatNotifyTime,
  notifyTimeToDate,
  dateToNotifyTime,
} from '@/utils/notifyTime';

describe('DEFAULT_NOTIFY_TIME', () => {
  it('is 09:00', () => {
    expect(DEFAULT_NOTIFY_TIME).toBe('09:00');
  });
});

describe('isValidNotifyTime', () => {
  it.each(['00:00', '00:01', '09:00', '12:30', '19:05', '23:59'])('accepts %s', (v) => {
    expect(isValidNotifyTime(v)).toBe(true);
  });

  it.each([
    '24:00', '23:60', '9:00', '09:0', '9:5', '', ' 09:00', '09:00 ',
    '09:00:00', 'ab:cd', '-1:00', '12.30', 'noon',
  ])('rejects %p', (v) => {
    expect(isValidNotifyTime(v)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 900, {}, [], true]) {
      expect(isValidNotifyTime(v)).toBe(false);
    }
  });
});

describe('parseNotifyTime', () => {
  it('splits hours and minutes', () => {
    expect(parseNotifyTime('20:30')).toEqual({ hours: 20, minutes: 30 });
    expect(parseNotifyTime('00:05')).toEqual({ hours: 0, minutes: 5 });
  });

  it('falls back to 09:00 for invalid input', () => {
    expect(parseNotifyTime('25:99')).toEqual({ hours: 9, minutes: 0 });
    expect(parseNotifyTime(undefined)).toEqual({ hours: 9, minutes: 0 });
  });
});

describe('formatNotifyTime', () => {
  it.each([
    ['09:00', '9:00 AM'],
    ['00:00', '12:00 AM'],
    ['00:05', '12:05 AM'],
    ['12:00', '12:00 PM'],
    ['12:45', '12:45 PM'],
    ['13:10', '1:10 PM'],
    ['20:30', '8:30 PM'],
    ['23:59', '11:59 PM'],
  ])('%s → %s', (input, expected) => {
    expect(formatNotifyTime(input)).toBe(expected);
  });

  it('shows the default time for invalid input', () => {
    expect(formatNotifyTime('nope')).toBe('9:00 AM');
  });
});

describe('notifyTimeToDate', () => {
  const parts = (d: Date) => [
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  ];

  it("keeps the base day and sets the time (local, seconds zeroed)", () => {
    const base = new Date(2026, 10, 16, 3, 45, 12, 500);
    expect(parts(notifyTimeToDate('20:30', base))).toEqual([2026, 10, 16, 20, 30, 0, 0]);
  });

  it('does not mutate the base date', () => {
    const base = new Date(2026, 10, 16, 3, 45, 12, 500);
    notifyTimeToDate('20:30', base);
    expect(parts(base)).toEqual([2026, 10, 16, 3, 45, 12, 500]);
  });

  it('uses 09:00 for invalid input', () => {
    const base = new Date(2026, 10, 16, 3, 45);
    expect(parts(notifyTimeToDate('bad', base))).toEqual([2026, 10, 16, 9, 0, 0, 0]);
  });
});

describe('dateToNotifyTime', () => {
  it('zero-pads local hours and minutes', () => {
    expect(dateToNotifyTime(new Date(2026, 10, 16, 7, 5))).toBe('07:05');
    expect(dateToNotifyTime(new Date(2026, 10, 16, 20, 30))).toBe('20:30');
    expect(dateToNotifyTime(new Date(2026, 10, 16, 0, 0))).toBe('00:00');
  });

  it('round-trips with notifyTimeToDate', () => {
    const d = notifyTimeToDate('18:45', new Date(2026, 0, 1));
    expect(dateToNotifyTime(d)).toBe('18:45');
  });
});
