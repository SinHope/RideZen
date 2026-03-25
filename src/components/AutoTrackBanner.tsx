// Shown at the top of the Home screen when background location was revoked
// (iOS silent revocation or Android hibernation).

import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { NavigationIcon } from '@/components/icons';

interface Props {
  message: string;
  showSettingsLink?: boolean; // true when permission is permanently denied
  onReEnable?: () => void;
  onDismiss: () => void;
}

export function AutoTrackBanner({ message, showSettingsLink = false, onReEnable, onDismiss }: Props) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#F59E0B33',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 11,
        marginBottom: 10,
      }}
    >
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' }}>
        <NavigationIcon color="#B45309" size={14} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: '#92400E', lineHeight: 17 }}>
          {message}
        </Text>
        {showSettingsLink ? (
          <TouchableOpacity
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel="Open phone settings"
          >
            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#B45309', marginTop: 3 }}>
              Open Settings →
            </Text>
          </TouchableOpacity>
        ) : onReEnable ? (
          <TouchableOpacity
            onPress={onReEnable}
            accessibilityRole="button"
            accessibilityLabel="Re-enable auto-track"
          >
            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#B45309', marginTop: 3 }}>
              Re-enable Auto-track →
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onDismiss}
        style={{ padding: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss banner"
      >
        <Text style={{ fontSize: 16, color: '#B45309', fontFamily: 'Inter_400Regular' }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}
