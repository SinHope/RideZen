import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withDelay, runOnJS,
} from 'react-native-reanimated';
import Svg, { Rect, Line } from 'react-native-svg';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { Vehicle, VehicleType } from '@/types';
import { ArrowLeftIcon } from '@/components/icons';
import { ConfirmModal } from '@/components/ConfirmModal';

// ─── Animated Trash Icon ──────────────────────────────────────────────────────
function TrashIcon({ lidOpen }: { lidOpen: boolean }) {
  const lidRotation = useSharedValue(0);
  useEffect(() => {
    lidRotation.value = withSpring(lidOpen ? -35 : 0, { damping: 10, stiffness: 180 });
  }, [lidOpen]);
  const lidStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${lidRotation.value}deg` }],
  }));
  return (
    <View style={{ width: 22, height: 24, alignItems: 'center' }}>
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' }, lidStyle]}>
        <Svg width="22" height="8" viewBox="0 0 22 8">
          <Rect x="2" y="3" width="18" height="4" rx="2" fill="white" />
          <Rect x="7" y="0" width="8" height="4" rx="1.5" fill="white" />
        </Svg>
      </Animated.View>
      <Svg width="22" height="24" viewBox="0 0 22 24" style={{ marginTop: 5 }}>
        <Rect x="3" y="0" width="16" height="16" rx="2" fill="white" />
        <Line x1="8" y1="3" x2="8" y2="13" stroke="#E53E3E" strokeWidth="1.5" strokeLinecap="round" />
        <Line x1="11" y1="3" x2="11" y2="13" stroke="#E53E3E" strokeWidth="1.5" strokeLinecap="round" />
        <Line x1="14" y1="3" x2="14" y2="13" stroke="#E53E3E" strokeWidth="1.5" strokeLinecap="round" />
      </Svg>
    </View>
  );
}

// ─── Saved Toast ──────────────────────────────────────────────────────────────
function SavedToast({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withSpring(1, { damping: 14, stiffness: 200 });
      opacity.value = withDelay(1200, withTiming(0, { duration: 300 }, (finished) => {
        if (finished) runOnJS(onDone)();
      }));
    }
  }, [visible]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!visible) return null;
  return (
    <View style={{
      position: 'absolute', inset: 0,
      backgroundColor: 'rgba(13,59,94,0.35)',
      alignItems: 'center', justifyContent: 'center',
    }} pointerEvents="none">
      <Animated.View style={[{
        backgroundColor: '#F0F8FF', borderRadius: 20, paddingVertical: 28,
        paddingHorizontal: 40, alignItems: 'center',
        shadowColor: '#0D3B5E', shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
      }, style]}>
        <View style={{
          width: 48, height: 48, borderRadius: 24,
          backgroundColor: '#2D6A4F', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
        }}>
          <Text style={{ color: 'white', fontSize: 22 }}>✓</Text>
        </View>
        <Text style={{ fontFamily: 'PlayfairDisplay_500Medium', fontSize: 22, color: '#0D3B5E' }}>
          Saved!
        </Text>
      </Animated.View>
    </View>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'scooter', label: 'Scooter / CVT' },
  { value: 'manual_bike', label: 'Manual Motorcycle' },
  { value: 'car', label: 'Car' },
  { value: 'other', label: 'Other' },
];

const TYPE_LABEL: Record<string, string> = {
  scooter: 'Scooter / CVT', manual_bike: 'Manual Motorcycle', car: 'Car', other: 'Vehicle',
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function VehicleDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);

  const [nickname, setNickname] = useState('');
  const [type, setType] = useState<VehicleType>('scooter');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [plate, setPlate] = useState('');
  const [odometer, setOdometer] = useState('');

  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    vehicleRepo.getById(parseInt(id)).then(r => {
      if (r.data) {
        const v = r.data;
        setVehicle(v);
        setNickname(v.nickname);
        setType(v.type);
        setMake(v.make ?? '');
        setModel(v.model ?? '');
        setYear(v.year?.toString() ?? '');
        setPlate(v.plate_number ?? '');
        setOdometer(v.current_odometer.toString());
      }
    });
  }, [id]);

  const handleTrashPress = () => { setTrashOpen(true); setShowDeleteModal(true); };
  const handleDeleteCancel = () => { setTrashOpen(false); setShowDeleteModal(false); };

  const handleDelete = async () => {
    setDeleting(true);
    await vehicleRepo.delete(parseInt(id));
    setDeleting(false);
    setShowDeleteModal(false);
    router.replace('/(tabs)');
  };

  const handleUpdate = async () => {
    if (!vehicle) return;
    setSaving(true);
    await vehicleRepo.update(vehicle.id, {
      nickname: nickname.trim() || vehicle.nickname,
      type,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      year: year ? parseInt(year) : undefined,
      plate_number: plate.trim() || undefined,
      current_odometer: parseFloat(odometer) || vehicle.current_odometer,
    });
    setSaving(false);
    setShowUpdateModal(false);
    setIsDirty(false);
    setShowSavedToast(true);
  };

  const markDirty = (setter: (v: string) => void) => (v: string) => {
    setter(v); setIsDirty(true);
  };

  if (!vehicle) return (
    <View className="flex-1 bg-zen-bg items-center justify-center">
      <ActivityIndicator color="#1B6CA8" />
    </View>
  );

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-zen-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        className="px-5 pb-5 flex-row items-center gap-3"
        style={{ paddingTop: insets.top + 8, backgroundColor: '#1B6CA8' }}
      >
        <TouchableOpacity
          className="w-10 h-10 rounded-full bg-white/15 items-center justify-center"
          onPress={() => router.back()}
          accessibilityLabel="Go back" accessibilityRole="button"
        >
          <ArrowLeftIcon color="white" size={16} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-xs text-white/70 font-inter">{TYPE_LABEL[vehicle.type]}</Text>
          <Text className="text-2xl text-white font-playfair-medium" numberOfLines={1}>
            {nickname || vehicle.nickname}
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleTrashPress}
          accessibilityLabel="Delete vehicle" accessibilityRole="button"
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: 'rgba(229,62,62,0.18)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <TrashIcon lidOpen={trashOpen} />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-5"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <Text className="text-xs font-inter text-zen-muted uppercase tracking-widest mb-3">Identity</Text>
        <View className="bg-white rounded-2xl overflow-hidden mb-5"
          style={{ shadowColor: '#1B6CA8', shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 }}>
          <FieldRow label="Nickname" required>
            <TextInput
              value={nickname} onChangeText={markDirty(setNickname)}
              placeholder="e.g. Aerox 155" placeholderTextColor="#A0B4BF"
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }}
            />
          </FieldRow>
          <View className="px-4 py-3 border-b border-zen-primary/[0.07]">
            <Text className="text-sm text-zen-muted font-inter mb-2">Type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TYPE_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { setType(opt.value); setIsDirty(true); }}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: type === opt.value ? '#1B6CA8' : '#EEF5FB',
                    borderWidth: type === opt.value ? 0 : 1, borderColor: '#1B6CA8',
                  }}
                >
                  <Text style={{
                    fontFamily: 'Inter_500Medium', fontSize: 12,
                    color: type === opt.value ? 'white' : '#1B6CA8',
                  }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <Text className="text-xs font-inter text-zen-muted uppercase tracking-widest mb-3">Details</Text>
        <View className="bg-white rounded-2xl overflow-hidden mb-5"
          style={{ shadowColor: '#1B6CA8', shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 }}>
          <FieldRow label="Make">
            <TextInput value={make} onChangeText={markDirty(setMake)} placeholder="e.g. Yamaha"
              placeholderTextColor="#A0B4BF"
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }} />
          </FieldRow>
          <FieldRow label="Model">
            <TextInput value={model} onChangeText={markDirty(setModel)} placeholder="e.g. Aerox 155"
              placeholderTextColor="#A0B4BF"
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }} />
          </FieldRow>
          <FieldRow label="Year">
            <TextInput value={year} onChangeText={markDirty(setYear)} placeholder="e.g. 2019"
              placeholderTextColor="#A0B4BF" keyboardType="number-pad" maxLength={4}
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }} />
          </FieldRow>
          <FieldRow label="Plate" last>
            <TextInput value={plate} onChangeText={markDirty(setPlate)} placeholder="e.g. FBR2762C"
              placeholderTextColor="#A0B4BF" autoCapitalize="characters"
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }} />
          </FieldRow>
        </View>

        <Text className="text-xs font-inter text-zen-muted uppercase tracking-widest mb-3">Odometer</Text>
        <View className="bg-white rounded-2xl overflow-hidden mb-8"
          style={{ shadowColor: '#1B6CA8', shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 }}>
          <FieldRow label="Current km" last>
            <TextInput value={odometer} onChangeText={markDirty(setOdometer)} placeholder="0"
              placeholderTextColor="#A0B4BF" keyboardType="decimal-pad"
              style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: '#0D3B5E', textAlign: 'right', flex: 1 }} />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#A0B4BF', marginLeft: 4 }}>km</Text>
          </FieldRow>
        </View>

        <TouchableOpacity
          onPress={() => setShowUpdateModal(true)}
          disabled={!isDirty}
          style={{
            height: 52, borderRadius: 16,
            backgroundColor: isDirty ? '#1B6CA8' : '#C5D8E8',
            alignItems: 'center', justifyContent: 'center',
          }}
          accessibilityRole="button" accessibilityLabel="Update vehicle"
        >
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: 'white' }}>Update</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Update confirmation — Cancel=gold, Confirm=green */}
      <ConfirmModal
        visible={showUpdateModal}
        title="Save changes?"
        message="Are you sure you want to make these changes to your vehicle?"
        confirmLabel="Yes, update"
        confirmColor="#2D6A4F"
        cancelColor="#F4A035"
        onConfirm={handleUpdate}
        onCancel={() => setShowUpdateModal(false)}
        loading={saving}
      />

      {/* Delete confirmation — Cancel=blue, Confirm=red */}
      <ConfirmModal
        visible={showDeleteModal}
        title="Delete vehicle?"
        message="Are you sure you want to delete this vehicle? This action cannot be reversed and all associated data will be removed."
        confirmLabel="Delete"
        confirmColor="#E53E3E"
        cancelColor="#1B6CA8"
        onConfirm={handleDelete}
        onCancel={handleDeleteCancel}
        loading={deleting}
      />

      {/* Saved toast → auto-redirect home */}
      <SavedToast
        visible={showSavedToast}
        onDone={() => router.replace('/(tabs)')}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Field Row ────────────────────────────────────────────────────────────────
function FieldRow({ label, children, last, required }: {
  label: string; children: React.ReactNode; last?: boolean; required?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: 'rgba(27,108,168,0.07)',
    }}>
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#6B8FA0', marginRight: 8 }}>
        {label}{required ? ' *' : ''}
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>
        {children}
      </View>
    </View>
  );
}
