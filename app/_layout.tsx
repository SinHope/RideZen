import '../src/global.css';
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

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

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
          <StatusBar style={showSplash ? 'light' : 'light'} />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="vehicle/add" options={{ presentation: 'modal' }} />
            <Stack.Screen name="vehicle/[id]" />
            <Stack.Screen name="fuel/add/[vehicleId]" options={{ presentation: 'modal' }} />
            <Stack.Screen name="maintenance/log/[itemId]" options={{ presentation: 'modal' }} />
          </Stack>
          {showSplash && (
            <AnimatedSplash onFinish={() => setShowSplash(false)} />
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
