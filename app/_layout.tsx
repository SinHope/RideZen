import '../src/global.css';
// IMPORTANT: This import must stay at the top — it registers the background GPS task
// with TaskManager at bundle-load time, before any component renders.
import '@/services/backgroundLocationTask';
// Same for the idle-reminder button handler: registers the notification listener and the
// Android background task (button taps while the app is backgrounded/killed).
import '@/notifications/idleResponseHandler';
// And for the maintenance notifications: the tap listener (opens the right screen) and the daily
// background check, which the OS may start headlessly before any component renders.
import '@/notifications/maintenanceResponseHandler';
import '@/services/maintenanceBackgroundTask';

import { useEffect, useState } from 'react';
import { Stack, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, PlayfairDisplay_400Regular, PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrations';
import { setupAndroidChannel } from '@/notifications/scheduler';
import { setupIdleReminderCategory } from '@/notifications/idleReminder';
import { initMaintenanceNotifications, attachMaintenanceAppStateSync } from '@/notifications/maintenanceBootstrap';
import { handleLastMaintenanceResponse } from '@/notifications/maintenanceResponseHandler';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { TutorialModal } from '@/components/TutorialModal';
import { RideSessionProvider } from '@/contexts/RideSessionContext';
import { useTrackingMode } from '@/hooks/useTrackingMode';
import { isTutorialShown } from '@/services/trackingPreferences';

SplashScreen.preventAutoHideAsync();

// Runs the launch permission recheck for auto-track mode.
// Separated so it can use the useTrackingMode hook.
function LaunchChecker() {
  const { recheckOnLaunch } = useTrackingMode();

  useEffect(() => {
    recheckOnLaunch().catch(() => {});
  }, []);

  return null;
}

// Opens the right screen when the app was LAUNCHED by tapping a maintenance notification. The tap arrives before
// any listener exists, so read it once the navigator is mounted.
function NotificationLaunchHandler() {
  const navigatorReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (navigatorReady) handleLastMaintenanceResponse();
  }, [navigatorReady]);

  return null;
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);
  const [showTutorial, setShowTutorial] = useState(false);

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    async function init() {
      try {
        const db = getDb();
        await runMigrations(db);
        await setupAndroidChannel();
        await setupIdleReminderCategory();
        // After migrations (needs the notify-log table) and channel setup (Android 13+ shows the permission
        // prompt only once a channel exists)
        await initMaintenanceNotifications();
      } catch (e) {
        console.error('Init failed:', e);
      }
    }
    init();
  }, []);

  // Re-check maintenance notifications whenever the app returns to the foreground
  useEffect(() => attachMaintenanceAppStateSync(), []);

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView className="flex-1">
        <SafeAreaProvider>
          <RideSessionProvider>
            <LaunchChecker />
            <NotificationLaunchHandler />
            <StatusBar style={showSplash ? 'light' : 'light'} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="vehicle/add" options={{ presentation: 'modal' }} />
              <Stack.Screen name="vehicle/[id]" />
              <Stack.Screen name="fuel/add/[vehicleId]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="fuel/edit/[logId]" options={{ presentation: 'modal' }} />
              <Stack.Screen name="maintenance/log/[itemId]" options={{ presentation: 'modal' }} />
            </Stack>
            {showSplash && (
              <AnimatedSplash onFinish={() => {
                setShowSplash(false);
                if (!isTutorialShown()) setShowTutorial(true);
              }} />
            )}
            <TutorialModal visible={showTutorial} onDone={() => setShowTutorial(false)} />
          </RideSessionProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
