// Notification settings stored in app_settings.
// Module under test (NOT YET IMPLEMENTED): src/services/notificationPreferences.ts
//
// Expected exports (all synchronous, never throw):
//   getMaintenanceNotifEnabled(): boolean        key 'maintenance_notifications_enabled'  ('1' / '0'; default ON)
//   setMaintenanceNotifEnabled(v: boolean): void
//   getNotifyTime(): string                      key 'maintenance_notify_time'            ('HH:MM'; default '09:00')
//   setNotifyTime(t: string): boolean            false (and nothing saved) when t is not a valid HH:MM
//   getNotifyGrouped(): boolean                  key 'maintenance_notify_grouped'         ('1' / '0'; default OFF)
//   setNotifyGrouped(v: boolean): void
//   hasAskedNotificationPermission(): boolean    key 'notif_permission_asked'             ('true')
//   markNotificationPermissionAsked(): void

jest.mock('@/db/client', () => ({ getDb: jest.fn() }));

import { getDb } from '@/db/client';
import {
  getMaintenanceNotifEnabled,
  setMaintenanceNotifEnabled,
  getNotifyTime,
  setNotifyTime,
  getNotifyGrouped,
  setNotifyGrouped,
  hasAskedNotificationPermission,
  markNotificationPermissionAsked,
} from '@/services/notificationPreferences';

let store: Map<string, string>;

function installFakeDb() {
  store = new Map();
  (getDb as jest.Mock).mockReturnValue({
    getFirstSync: jest.fn((_sql: string, params: string[]) =>
      store.has(params[0]) ? { value: store.get(params[0]) } : null
    ),
    runSync: jest.fn((_sql: string, params: string[]) => {
      store.set(params[0], params[1]);
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  installFakeDb();
});

describe('defaults (nothing saved yet)', () => {
  it('push notifications are ON, 09:00, one notification each, permission not asked', () => {
    expect(getMaintenanceNotifEnabled()).toBe(true);
    expect(getNotifyTime()).toBe('09:00');
    expect(getNotifyGrouped()).toBe(false);
    expect(hasAskedNotificationPermission()).toBe(false);
  });
});

describe('push notifications switch', () => {
  it('saves OFF and ON', () => {
    setMaintenanceNotifEnabled(false);
    expect(store.get('maintenance_notifications_enabled')).toBe('0');
    expect(getMaintenanceNotifEnabled()).toBe(false);

    setMaintenanceNotifEnabled(true);
    expect(store.get('maintenance_notifications_enabled')).toBe('1');
    expect(getMaintenanceNotifEnabled()).toBe(true);
  });
});

describe('notification time', () => {
  it('saves a valid time', () => {
    expect(setNotifyTime('20:30')).toBe(true);
    expect(store.get('maintenance_notify_time')).toBe('20:30');
    expect(getNotifyTime()).toBe('20:30');
  });

  it('rejects an invalid time and keeps the old one', () => {
    setNotifyTime('20:30');
    expect(setNotifyTime('25:99')).toBe(false);
    expect(setNotifyTime('9:00')).toBe(false);
    expect(getNotifyTime()).toBe('20:30');
  });

  it('a corrupted saved value falls back to 09:00', () => {
    store.set('maintenance_notify_time', 'garbage');
    expect(getNotifyTime()).toBe('09:00');
  });
});

describe('group into one summary', () => {
  it('saves ON and OFF', () => {
    setNotifyGrouped(true);
    expect(store.get('maintenance_notify_grouped')).toBe('1');
    expect(getNotifyGrouped()).toBe(true);

    setNotifyGrouped(false);
    expect(store.get('maintenance_notify_grouped')).toBe('0');
    expect(getNotifyGrouped()).toBe(false);
  });
});

describe('permission already asked flag', () => {
  it('is remembered', () => {
    markNotificationPermissionAsked();
    expect(store.get('notif_permission_asked')).toBe('true');
    expect(hasAskedNotificationPermission()).toBe(true);
  });
});

describe('when the database fails', () => {
  beforeEach(() => {
    (getDb as jest.Mock).mockImplementation(() => {
      throw new Error('db closed');
    });
  });

  it('reads fall back to the defaults', () => {
    expect(getMaintenanceNotifEnabled()).toBe(true);
    expect(getNotifyTime()).toBe('09:00');
    expect(getNotifyGrouped()).toBe(false);
    expect(hasAskedNotificationPermission()).toBe(false);
  });

  it('writes never throw', () => {
    expect(() => setMaintenanceNotifEnabled(false)).not.toThrow();
    expect(() => setNotifyGrouped(true)).not.toThrow();
    expect(() => markNotificationPermissionAsked()).not.toThrow();
    expect(setNotifyTime('20:30')).toBe(false); // could not save
  });
});
