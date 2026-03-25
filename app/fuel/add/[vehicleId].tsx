import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert, Switch } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fuelRepo } from '@/repositories/fuelRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { ArrowLeftIcon } from '@/components/icons';
import { z } from 'zod';

const fuelLogSchema = z.object({
  odometer: z.number().positive('Odometer must be a positive number'),
  litres: z.number().positive().max(200, 'Check litres value — seems too high'),
  price_per_litre: z.number().positive().optional(),
  is_full_tank: z.boolean(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  notes: z.string().max(500).optional(),
});

function StyledInput({ label, value, onChangeText, placeholder, keyboardType, suffix, optional = false }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'numeric' | 'decimal-pad'; suffix?: string; optional?: boolean;
}) {
  return (
    <View className="mb-4">
      <View className="flex-row items-center mb-1.5">
        <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest">{label}</Text>
        {optional && <Text className="text-xs text-zen-muted font-inter ml-1">(optional)</Text>}
      </View>
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

export default function AddFuelLogScreen() {
  const insets = useSafeAreaInsets();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const today = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState(today);
  const [odometer, setOdometer] = useState('');
  const [litres, setLitres] = useState('');
  const [pricePerLitre, setPricePerLitre] = useState('');
  const [isFullTank, setIsFullTank] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsed = fuelLogSchema.safeParse({
      odometer: parseFloat(odometer),
      litres: parseFloat(litres),
      price_per_litre: pricePerLitre ? parseFloat(pricePerLitre) : undefined,
      is_full_tank: isFullTank,
      date,
      notes: notes || undefined,
    });

    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message ?? 'Please check your input.';
      Alert.alert('Validation Error', msg);
      return;
    }

    setSaving(true);
    const result = await fuelRepo.add({
      vehicle_id: parseInt(vehicleId),
      ...parsed.data,
    });
    setSaving(false);

    if (result.error) { Alert.alert('Error', result.error); return; }
    router.back();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-zen-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        className="px-5 pb-4 flex-row items-center gap-3"
        style={{ paddingTop: insets.top + 8, backgroundColor: '#2D6A4F' }}
      >
        <TouchableOpacity
          className="w-8 h-8 rounded-full bg-white/15 items-center justify-center"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeftIcon color="white" size={16} />
        </TouchableOpacity>
        <View className="flex-1">
          <Text className="text-2xl text-white font-playfair-medium">Log Refuel</Text>
        </View>
        <TouchableOpacity
          className={`px-4 py-2 rounded-full ${saving ? 'bg-white/30' : 'bg-white'}`}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save refuel log"
        >
          <Text className="text-zen-secondary font-inter-semibold text-sm">{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-4 pt-5" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <StyledInput label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <StyledInput label="Odometer *" value={odometer} onChangeText={setOdometer} placeholder="e.g. 14820" keyboardType="numeric" suffix="km" />
        <StyledInput label="Litres filled *" value={litres} onChangeText={setLitres} placeholder="e.g. 6.2" keyboardType="decimal-pad" suffix="L" />
        <StyledInput label="Price per litre" value={pricePerLitre} onChangeText={setPricePerLitre} placeholder="e.g. 2.48" keyboardType="decimal-pad" suffix="SGD" optional />
        <StyledInput label="Station / Notes" value={notes} onChangeText={setNotes} placeholder="e.g. Shell Jurong" optional />

        {/* Full tank toggle */}
        <View className="flex-row items-center justify-between bg-zen-surface rounded-2xl px-3.5 py-3 border border-zen-primary/15 mb-4">
          <View>
            <Text className="text-sm font-inter-medium text-zen-text">Full tank fill?</Text>
            <Text className="text-xs text-zen-muted font-inter mt-0.5">Required for accurate L/100km calculation</Text>
          </View>
          <Switch
            value={isFullTank}
            onValueChange={setIsFullTank}
            trackColor={{ false: '#DDD', true: '#74C69D' }}
            thumbColor="white"
            accessibilityLabel="Full tank toggle"
          />
        </View>

        {!isFullTank && (
          <View className="bg-amber-50 border border-amber-200 rounded-2xl px-3.5 py-2.5 mb-4">
            <Text className="text-xs text-amber-700 font-inter">
              Partial fills are recorded but won't affect your L/100km average — consumption is only calculated between two full-tank fills.
            </Text>
          </View>
        )}

        <View className="h-16" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
