// Tapping a maintenance notification opens the right screen:
//   one item → its service screen (/maintenance/log/<id>);  a summary (or a payload we can't read) → Home.
//
// MUST be imported at the top of app/_layout.tsx (like idleResponseHandler): importing it registers the
// listener at bundle-load time. That listener covers taps while the app process is alive. When the app was
// launched BY the tap (cold start) the response was delivered before any listener existed, so the layout also
// calls handleLastMaintenanceResponse() once the navigator is ready.
//
// Both paths can deliver the same tap, so it is deduped (before any await, like the idle handler).

import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { logToFile } from '@/utils/logger';

let lastHandledKey: string | null = null;

interface OurData {
  type: 'maintenance' | 'maintenance_summary';
  itemId?: unknown;
}

function ourData(response: Notifications.NotificationResponse | null | undefined): OurData | null {
  const data = response?.notification?.request?.content?.data as { type?: string } | undefined;
  if (data?.type === 'maintenance' || data?.type === 'maintenance_summary') return data as OurData;
  return null;
}

function open(response: Notifications.NotificationResponse, data: OurData): void {
  const key = `${response.notification.request.identifier}:${response.notification.date}`;
  if (key === lastHandledKey) return;
  lastHandledKey = key;

  const itemId = data.itemId;
  if (data.type === 'maintenance' && typeof itemId === 'number' && Number.isFinite(itemId)) {
    router.push(`/maintenance/log/${itemId}`);
  } else {
    router.navigate('/');
  }
}

export async function handleMaintenanceResponse(response: Notifications.NotificationResponse): Promise<void> {
  try {
    const data = ourData(response);
    if (!data) return; // GPS idle reminder or someone else's notification
    open(response, data);
  } catch (e) {
    void logToFile('MAINT_NOTIF', 'handleMaintenanceResponse', String(e));
  }
}

/** The app was opened by tapping a notification: handle that tap once, then clear it so it is never replayed. */
export function handleLastMaintenanceResponse(): void {
  try {
    const response = Notifications.getLastNotificationResponse();
    const data = ourData(response);
    if (!response || !data) return; // not opened from a notification, or not ours (GPS idle is handled elsewhere)
    open(response, data);
    Notifications.clearLastNotificationResponse();
  } catch (e) {
    void logToFile('MAINT_NOTIF', 'handleLastMaintenanceResponse', String(e));
  }
}

Notifications.addNotificationResponseReceivedListener((response) => {
  void handleMaintenanceResponse(response);
});
