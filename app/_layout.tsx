import '../src/global.css';
// IMPORTANT: This import must stay at the top — it registers the background GPS task
// with TaskManager at bundle-load time, before any component renders.
import '@/services/backgroundLocationTask';

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, PlayfairDisplay_400Regular, PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display';
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { getDb } from '@/db/client';
import { runMigrations } from '@/db/migrations';
import { setupAndroidChannel } from '@/notifications/scheduler';
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
      } catch (e) {
        console.error('Init failed:', e);
      }
    }
    init();
  }, []);

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
            <StatusBar style={showSplash ? 'light' : 'light'} />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="vehicle/add" options={{ presentation: 'modal' }} />
              <Stack.Screen name="vehicle/[id]" />
              <Stack.Screen name="fuel/add/[vehicleId]" options={{ presentation: 'modal' }} />
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
