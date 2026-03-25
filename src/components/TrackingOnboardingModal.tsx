// 2-step first-vehicle onboarding flow for tracking mode selection.
// Step 1: Choose Manual or Auto (card selection UI).
// Step 2: Combined explanation + privacy notice.
// Only shown once — guarded by 'onboarding_tracking_shown' in app_settings.

import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTrackingMode, SwitchToAutoOutcome } from '@/hooks/useTrackingMode';
import { setOnboardingShown } from '@/services/trackingPreferences';
import { NavigationIcon, PlayIcon } from '@/components/icons';

interface Props {
  visible: boolean;
  vehicleId: number;
  onComplete: () => void;
}

type SelectedMode = 'manual' | 'auto';

export function TrackingOnboardingModal({ visible, vehicleId, onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<SelectedMode>('manual');
  const { switchToAuto } = useTrackingMode();

  const handleComplete = async () => {
    setOnboardingShown();

    if (selected === 'auto') {
      const outcome: SwitchToAutoOutcome = await switchToAuto(vehicleId);
      onComplete();
      handleAutoOutcome(outcome);
    } else {
      onComplete();
    }
  };

  function handleAutoOutcome(outcome: SwitchToAutoOutcome) {
    switch (outcome) {
      case 'granted':
        // Success — auto-track is running, no alert needed
        break;
      case 'foreground_denied':
      case 'background_only_while_using':
        Alert.alert(
          'Auto-track needs "Always Allow"',
          "You've been kept on Manual Ride Session. You can change this in Settings anytime.",
          [{ text: 'OK' }]
        );
        break;
      case 'foreground_never_ask':
      case 'background_never_ask':
        Alert.alert(
          'Permission required',
          'Auto-track needs "Always Allow" for location. Please enable it in your phone Settings.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        break;
      case 'background_denied':
        Alert.alert(
          'Could not start auto-track',
          "You've been kept on Manual Ride Session.",
          [{ text: 'OK' }]
        );
        break;
    }
  }

  const modeDescription = selected === 'manual'
    ? "You'll see a Start/End Ride button on your home screen. Your odometer updates after each ride you record."
    : "RideZen will track your distance in the background automatically. Your odometer updates without any action from you.";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: '#F0F8FF', paddingTop: insets.top + 8 }}>

        {/* ── Header ── */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(27,108,168,0.08)' }}>
          <Text style={{ fontSize: 11, color: '#6B7280', fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>
            Step {step} of 2
          </Text>
          <Text style={{ fontSize: 24, color: '#0D3B5E', fontFamily: 'PlayfairDisplay_500Medium', lineHeight: 30 }}>
            {step === 1 ? 'How should RideZen\ntrack your odometer?' : "Here's what to expect"}
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

          {step === 1 ? (
            <>
              {/* ── Mode cards ── */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
                {/* Manual card */}
                <TouchableOpacity
                  onPress={() => setSelected('manual')}
                  style={{
                    flex: 1,
                    borderRadius: 20,
                    padding: 18,
                    backgroundColor: selected === 'manual' ? '#1B6CA8' : 'white',
                    borderWidth: 2,
                    borderColor: selected === 'manual' ? '#1B6CA8' : 'rgba(27,108,168,0.12)',
                    shadowColor: selected === 'manual' ? '#1B6CA8' : '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: selected === 'manual' ? 0.25 : 0.05,
                    shadowRadius: 10,
                    elevation: selected === 'manual' ? 6 : 2,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Select manual ride session"
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: selected === 'manual' ? 'rgba(255,255,255,0.2)' : '#EFF8FF',
                    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
                  }}>
                    <PlayIcon color={selected === 'manual' ? 'white' : '#1B6CA8'} size={15} />
                  </View>
                  <Text style={{
                    fontFamily: 'Inter_600SemiBold', fontSize: 13,
                    color: selected === 'manual' ? 'white' : '#1B6CA8', marginBottom: 6,
                  }}>
                    Manual Ride Session
                  </Text>
                  <Text style={{
                    fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16,
                    color: selected === 'manual' ? 'rgba(255,255,255,0.8)' : '#6B7280',
                  }}>
                    Tap Start before you ride. Better for battery.
                  </Text>
                </TouchableOpacity>

                {/* Auto card */}
                <TouchableOpacity
                  onPress={() => setSelected('auto')}
                  style={{
                    flex: 1,
                    borderRadius: 20,
                    padding: 18,
                    backgroundColor: selected === 'auto' ? '#2D6A4F' : 'white',
                    borderWidth: 2,
                    borderColor: selected === 'auto' ? '#2D6A4F' : 'rgba(27,108,168,0.12)',
                    shadowColor: selected === 'auto' ? '#2D6A4F' : '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: selected === 'auto' ? 0.25 : 0.05,
                    shadowRadius: 10,
                    elevation: selected === 'auto' ? 6 : 2,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Select auto-track always"
                >
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: selected === 'auto' ? 'rgba(255,255,255,0.2)' : '#ECFDF5',
                    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
                  }}>
                    <NavigationIcon color={selected === 'auto' ? 'white' : '#2D6A4F'} size={15} />
                  </View>
                  <Text style={{
                    fontFamily: 'Inter_600SemiBold', fontSize: 13,
                    color: selected === 'auto' ? 'white' : '#2D6A4F', marginBottom: 6,
                  }}>
                    Auto-track Always
                  </Text>
                  <Text style={{
                    fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16,
                    color: selected === 'auto' ? 'rgba(255,255,255,0.8)' : '#6B7280',
                  }}>
                    Tracks automatically in background. Uses more battery.
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Continue button */}
              <TouchableOpacity
                onPress={() => setStep(2)}
                style={{
                  height: 50, borderRadius: 16, backgroundColor: '#1B6CA8',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Continue to explanation"
              >
                <Text style={{ color: 'white', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>Continue</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* ── Step 2: What this means ── */}
              <View style={{
                backgroundColor: 'white', borderRadius: 20, padding: 20,
                borderWidth: 1, borderColor: 'rgba(27,108,168,0.08)',
                marginBottom: 16,
                shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
              }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#1B6CA8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  What this means
                </Text>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#374151', lineHeight: 20 }}>
                  {modeDescription}
                </Text>
              </View>

              {/* ── Privacy notice ── */}
              <View style={{
                backgroundColor: 'white', borderRadius: 20, padding: 20,
                borderWidth: 1, borderColor: 'rgba(27,108,168,0.08)',
                marginBottom: 28,
                shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
              }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#1B6CA8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                  Privacy & Permissions
                </Text>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#374151', lineHeight: 20 }}>
                  RideZen only uses your location to calculate riding distance. Your location is never stored beyond what's needed to calculate distance, and is never shared with anyone.{'\n\n'}
                  This complies with Singapore's PDPA, Apple App Store, and Google Play policies.
                </Text>
                <TouchableOpacity onPress={() => Linking.openURL('https://ridezen.app/privacy')} accessibilityRole="link">
                  <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 12, color: '#1B6CA8', marginTop: 10 }}>
                    Privacy Policy  ·  Terms & Conditions
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Got it button */}
              <TouchableOpacity
                onPress={handleComplete}
                style={{
                  height: 50, borderRadius: 16, backgroundColor: '#1B6CA8',
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: '#1B6CA8', shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
                }}
                accessibilityRole="button"
                accessibilityLabel="Confirm and close onboarding"
              >
                <Text style={{ color: 'white', fontFamily: 'Inter_600SemiBold', fontSize: 15 }}>
                  Got it, let's go
                </Text>
              </TouchableOpacity>

              {/* Back to step 1 */}
              <TouchableOpacity
                onPress={() => setStep(1)}
                style={{ alignItems: 'center', marginTop: 14 }}
                accessibilityRole="button"
              >
                <Text style={{ color: '#6B7280', fontFamily: 'Inter_400Regular', fontSize: 13 }}>← Change selection</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
