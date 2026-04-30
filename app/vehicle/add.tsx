import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { VehicleType } from '@/types';
import { ArrowLeftIcon, CheckIcon } from '@/components/icons';
import { ConfirmModal } from '@/components/ConfirmModal';
import { setMaintenancePromptPending, setTrackingOnboardingPending } from '@/utils/flags';

const VEHICLE_TYPES: { type: VehicleType; label: string; sub: string; emoji: string }[] = [
  { type: 'scooter',     label: 'Scooter / CVT',       sub: 'Yamaha NVX, Honda PCX, etc.',    emoji: '🛵' },
  { type: 'manual_bike', label: 'Manual Motorcycle',   sub: 'Honda CB, Kawasaki Z, etc.',     emoji: '🏍' },
  { type: 'car',         label: 'Car',                 sub: 'Toyota, Honda, Proton, etc.',    emoji: '🚗' },
  { type: 'other',       label: 'Other',               sub: 'Custom or unlisted vehicle',     emoji: '🚐' },
];

function StyledInput({ label, value, onChangeText, placeholder, keyboardType, suffix }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  suffix?: string;
}) {
  return (
    <View className="mb-4">
      <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest mb-1.5">{label}</Text>
      <View className="flex-row items-center bg-zen-surface border border-zen-primary/15 rounded-2xl px-3.5 py-3">
        <TextInput
          className="flex-1 text-sm font-inter text-zen-text"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          keyboardType={keyboardType}
          accessibilityLabel={label}
        />
        {suffix ? <Text className="text-xs text-zen-muted font-inter ml-1">{suffix}</Text> : null}
      </View>
    </View>
  );
}

export default function AddVehicleScreen() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<VehicleType | null>(null);
  const [nickname, setNickname] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [odometer, setOdometer] = useState('');
  const [plate, setPlate] = useState('');
  const [otherDescription, setOtherDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleSavePress = () => {
    if (!nickname.trim()) { Alert.alert('Required', 'Please enter a vehicle name.'); return; }
    if (!selectedType) { Alert.alert('Required', 'Please select a vehicle type.'); return; }
    const odo = parseFloat(odometer);
    if (isNaN(odo) || odo < 0) { Alert.alert('Invalid', 'Odometer must be a positive number.'); return; }
    setShowConfirmModal(true);
  };

  const handleSaveConfirm = async () => {
    const odo = parseFloat(odometer);
    setSaving(true);
    const result = await vehicleRepo.create({
      nickname: nickname.trim(),
      type: selectedType!,
      make: make.trim() || undefined,
      model: selectedType === 'other'
        ? (otherDescription.trim() || undefined)
        : (model.trim() || undefined),
      year: year ? parseInt(year) : undefined,
      plate_number: plate.trim() || undefined,
      current_odometer: odo,
    });
    setSaving(false);

    if (result.error) {
      setShowConfirmModal(false);
      Alert.alert('Error', result.error);
      return;
    }
    setShowConfirmModal(false);
    setMaintenancePromptPending();
    setTrackingOnboardingPending();
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-zen-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        className="px-5 pb-4 flex-row items-center gap-3"
        style={{ paddingTop: insets.top + 8, backgroundColor: '#1B6CA8' }}
      >
        <TouchableOpacity
          className="w-8 h-8 rounded-full bg-white/15 items-center justify-center"
          onPress={() => (step === 2 ? setStep(1) : router.back())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeftIcon color="white" size={16} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-2xl text-white font-playfair-medium">Add Vehicle</Text>
          <Text className="text-xs text-white/70 font-inter">Step {step} of 2</Text>
        </View>
        {step === 2 && (
          <TouchableOpacity
            className={`px-4 py-2 rounded-full ${saving ? 'bg-white/30' : 'bg-white'}`}
            onPress={handleSavePress}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save vehicle"
          >
            <Text className="text-zen-primary font-inter-semibold text-sm">{saving ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView className="flex-1 px-4 pt-5" showsVerticalScrollIndicator={false}>
        {step === 1 ? (
          <>
            <Text className="text-lg font-playfair-medium text-zen-text mb-1">Select vehicle type</Text>
            <Text className="text-sm text-zen-muted font-inter mb-4">
              This determines which maintenance items are tracked.
            </Text>
            {VEHICLE_TYPES.map(t => (
              <TouchableOpacity
                key={t.type}
                onPress={() => setSelectedType(t.type)}
                className={`flex-row items-center gap-4 p-4 rounded-2xl mb-3 border-2 ${
                  selectedType === t.type
                    ? 'border-zen-primary bg-zen-primary-pale'
                    : 'border-zen-primary/10 bg-zen-surface'
                }`}
                accessibilityRole="button"
                accessibilityLabel={t.label}
              >
                <Text className="text-3xl">{t.emoji}</Text>
                <View className="flex-1">
                  <Text className={`text-sm font-inter-medium ${selectedType === t.type ? 'text-zen-primary' : 'text-zen-text'}`}>
                    {t.label}
                  </Text>
                  <Text className="text-xs text-zen-muted font-inter mt-0.5">{t.sub}</Text>
                </View>
                {selectedType === t.type && (
                  <View className="w-6 h-6 rounded-full bg-zen-primary items-center justify-center">
                    <CheckIcon color="white" size={12} />
                  </View>
                )}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              className={`py-4 rounded-2xl items-center mt-2 mb-8 ${selectedType ? 'bg-zen-primary' : 'bg-gray-200'}`}
              onPress={() => { if (selectedType) setStep(2); }}
              disabled={!selectedType}
              accessibilityRole="button"
              accessibilityLabel="Continue to vehicle details"
            >
              <Text className={`font-inter-semibold ${selectedType ? 'text-white' : 'text-gray-400'}`}>
                Continue
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text className="text-lg font-playfair-medium text-zen-text mb-1">Vehicle details</Text>
            <Text className="text-sm text-zen-muted font-inter mb-5">Required fields are marked *</Text>

            <StyledInput
              label="Vehicle name *"
              value={nickname}
              onChangeText={setNickname}
              placeholder={selectedType === 'car' ? 'My Personal Car' : 'e.g. My Yamaha NVX'}
            />
            <StyledInput
              label="Current odometer *"
              value={odometer}
              onChangeText={setOdometer}
              placeholder="e.g. 14820"
              keyboardType="numeric"
              suffix="km"
            />
            <StyledInput
              label="Make"
              value={make}
              onChangeText={setMake}
              placeholder={selectedType === 'car' ? 'e.g. Hyundai' : 'e.g. Yamaha'}
            />
            <StyledInput
              label="Model"
              value={model}
              onChangeText={setModel}
              placeholder={selectedType === 'car' ? 'e.g. Kona' : 'e.g. NVX 155'}
            />
            <StyledInput
              label="Year"
              value={year}
              onChangeText={setYear}
              placeholder="e.g. 2021"
              keyboardType="numeric"
            />
            {selectedType === 'other' && (
              <StyledInput
                label="Description"
                value={otherDescription}
                onChangeText={setOtherDescription}
                placeholder="e.g. Electric scooter, cargo trike..."
              />
            )}
            <StyledInput
              label="Plate number"
              value={plate}
              onChangeText={setPlate}
              placeholder={selectedType === 'scooter' || selectedType === 'manual_bike' ? 'e.g. FBR1234C' : 'e.g. SJP1234A'}
            />
            <View className="h-16" />
          </>
        )}
      </ScrollView>

      <ConfirmModal
        visible={showConfirmModal}
        title="Have you confirmed all details?"
        message="Please double-check your vehicle name, type, and odometer reading before saving."
        confirmLabel="Yes, save"
        confirmColor="#2D6A4F"
        cancelColor="#F4A035"
        onConfirm={handleSaveConfirm}
        onCancel={() => setShowConfirmModal(false)}
        loading={saving}
      />
    </KeyboardAvoidingView>
  );
}
