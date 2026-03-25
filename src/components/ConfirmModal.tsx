import { useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSpring,
} from 'react-native-reanimated';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  cancelColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmModal({
  visible, title, message, confirmLabel, confirmColor,
  cancelColor = '#F4A035',
  onConfirm, onCancel, loading = false,
}: Props) {
  const scale = useSharedValue(0.88);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 180 });
      scale.value = withSpring(1, { damping: 18, stiffness: 200 });
    } else {
      opacity.value = withTiming(0, { duration: 140 });
      scale.value = withTiming(0.88, { duration: 140 });
    }
  }, [visible]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <View style={{
        flex: 1, backgroundColor: 'rgba(13,59,94,0.45)',
        alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
      }}>
        <Animated.View style={[{
          backgroundColor: '#F0F8FF', borderRadius: 20, padding: 28, width: '100%',
          shadowColor: '#0D3B5E', shadowOpacity: 0.18, shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 }, elevation: 12,
        }, cardStyle]}>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: confirmColor, marginBottom: 20, width: 40 }} />
          <Text style={{ fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: '#0D3B5E', marginBottom: 10 }}>
            {title}
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#5A7A8A', lineHeight: 22, marginBottom: 28 }}>
            {message}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={loading}
              style={{
                flex: 1, height: 48, borderRadius: 12,
                borderWidth: 1.5, borderColor: cancelColor,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: cancelColor }}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={loading}
              style={{
                flex: 1, height: 48, borderRadius: 12,
                backgroundColor: confirmColor,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              {loading
                ? <ActivityIndicator color="white" size="small" />
                : <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: 'white' }}>
                    {confirmLabel}
                  </Text>
              }
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
