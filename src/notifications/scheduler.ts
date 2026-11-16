import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { logToFile } from '@/utils/logger';

// Notification handler, permission helper and Android channels.
// Scheduling and cancelling the maintenance reminders lives in maintenanceNotifications.ts.

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;

    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    logToFile('NOTIF_ERROR', 'requestPermissions', String(e));
    return false;
  }
}

export async function setupAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('maintenance', {
        name: 'Maintenance Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1B6CA8',
      });
      // HIGH importance → heads-up banner, so the idle reminder's action buttons are visible
      await Notifications.setNotificationChannelAsync('ride_tracking', {
        name: 'Ride Tracking',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1B6CA8',
      });
    } catch (e) {
      logToFile('NOTIF_ERROR', 'setupAndroidChannel', String(e));
    }
  }
}
