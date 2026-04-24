import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { MaintenanceItem } from '@/types';
import { DueStatusBadge } from '@/components/DueStatusBadge';
import { ArrowLeftIcon } from '@/components/icons';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { computeMaintenanceStatus, loadStatusThresholds } from '@/utils/reminderCheck';
import { formatOdometer } from '@/utils/consumption';

function StyledInput({ label, value, onChangeText, placeholder, keyboardType, optional, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'numeric' | 'decimal-pad'; optional?: boolean; multiline?: boolean;
}) {
  return (
    <View className="mb-4">
      <View className="flex-row items-center mb-1.5">
        <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest">{label}</Text>
        {optional && <Text className="text-xs text-zen-muted font-inter ml-1">(optional)</Text>}
      </View>
      <View className={`bg-zen-surface border border-zen-primary/15 rounded-2xl px-3.5 py-3${multiline ? ' min-h-[80px]' : ''}`}>
        <TextInput
          className="text-sm font-inter text-zen-text"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          keyboardType={keyboardType}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'auto'}
          accessibilityLabel={label}
        />
      </View>
    </View>
  );
}

export default function LogServiceScreen() {
  const insets = useSafeAreaInsets();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const today = new Date().toISOString().split('T')[0];

  const [item, setItem] = useState<MaintenanceItem | null>(null);
  const [currentOdo, setCurrentOdo] = useState(0);
  const [date, setDate] = useState(today);
  const [odometer, setOdometer] = useState('');
  const [cost, setCost] = useState('');
  const [workshop, setWorkshop] = useState('');
  const [notes, setNotes] = useState('');
  const [intervalKm, setIntervalKm] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      const itemResult = await maintenanceRepo.getById(parseInt(itemId));
      if (itemResult.data) {
        const vehicleResult = await vehicleRepo.getById(itemResult.data.vehicle_id);
        const odo = vehicleResult.data?.current_odometer ?? 0;
        setCurrentOdo(odo);
        setItem(computeMaintenanceStatus(itemResult.data, odo, loadStatusThresholds()));
        setOdometer(String(Math.round(odo)));
        if (itemResult.data.interval_km) setIntervalKm(String(itemResult.data.interval_km));
        if (itemResult.data.next_due_date) setNextDueDate(itemResult.data.next_due_date);
        if (itemResult.data.notes) setRemarks(itemResult.data.notes);
      }
      const histResult = await maintenanceRepo.getHistory(parseInt(itemId));
      if (histResult.data) setHistory(histResult.data);
    }
    load();
  }, [itemId]);

  const handleSaveOnly = () => {
    if (!item) return;
    Alert.alert(
      'Save Changes',
      'Your changes will be saved, but no service history entry will be created for today. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            setSaving(true);
            const newIntervalKm = intervalKm ? parseFloat(intervalKm) : undefined;
            const newNextDueOdo = newIntervalKm != null ? Math.round(currentOdo + newIntervalKm) : item.next_due_odo;
            const result = await maintenanceRepo.updateItem(item.id, {
              interval_km: newIntervalKm,
              notes: remarks || undefined,
              next_due_odo: newNextDueOdo,
              next_due_date: nextDueDate || undefined,
            });
            setSaving(false);
            if (result.error) { Alert.alert('Error', result.error); return; }
            router.back();
          },
        },
      ]
    );
  };

  const handleLogService = () => {
    if (!item) return;
    const odo = parseFloat(odometer);
    if (isNaN(odo) || odo <= 0) { Alert.alert('Invalid', 'Enter a valid odometer reading.'); return; }

    Alert.alert(
      'Log Service',
      "Your changes will be saved, and today's date will be recorded as a service entry in your history. Continue?",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Service',
          onPress: async () => {
            setSaving(true);
            const result = await maintenanceRepo.logService({
              item_id: item.id,
              vehicle_id: item.vehicle_id,
              date,
              odometer: odo,
              cost: cost ? parseFloat(cost) : undefined,
              workshop: workshop || undefined,
              notes: notes || undefined,
              new_interval_km: intervalKm ? parseFloat(intervalKm) : undefined,
              new_due_date: nextDueDate || undefined,
              remarks: remarks || undefined,
            });
            setSaving(false);
            if (result.error) { Alert.alert('Error', result.error); return; }
            router.back();
          },
        },
      ]
    );
  };

  if (!item) {
    return (
      <View className="flex-1 bg-zen-bg items-center justify-center">
        <Text className="text-zen-muted font-inter">Loading…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-zen-bg"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View
        className="px-5 pb-4"
        style={{ paddingTop: insets.top + 8, backgroundColor: '#1B6CA8' }}
      >
        <View className="flex-row items-center gap-3 mb-3">
          <TouchableOpacity
            className="w-8 h-8 rounded-full bg-white/15 items-center justify-center"
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeftIcon color="white" size={16} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-2xl text-white font-playfair-medium">{item.category}</Text>
          </View>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className={`px-3 py-2 rounded-full border border-white/60 ${saving ? 'opacity-50' : ''}`}
              onPress={handleSaveOnly}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save changes without logging"
            >
              <Text className="text-white font-inter-semibold text-sm">Save</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className={`px-3 py-2 rounded-full ${saving ? 'bg-white/30' : 'bg-white'}`}
              onPress={handleLogService}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Log service"
            >
              <Text className="text-zen-primary font-inter-semibold text-sm">Log Service</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Status row */}
        <View className="flex-row items-center gap-3 bg-white/10 rounded-2xl px-3.5 py-3">
          <DueStatusBadge status={item.status ?? 'ok'} size="md" />
          <View className="flex-1">
            {item.next_due_odo && (
              <Text className="text-white text-sm font-inter">
                Next due at {formatOdometer(item.next_due_odo)}
                {item.km_remaining != null ? ` · ${Math.round(item.km_remaining).toLocaleString()} km left` : ''}
              </Text>
            )}
            {item.next_due_date && (
              <Text className="text-white/70 text-xs font-inter mt-0.5">Or by {item.next_due_date}</Text>
            )}
          </View>
        </View>
      </View>

      <ScrollView className="flex-1 px-4 pt-5" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Item Settings */}
        <Text className="text-base font-playfair-medium text-zen-text mb-4">Item Settings</Text>
        <StyledInput
          label="Due for service in (km)"
          value={intervalKm}
          onChangeText={setIntervalKm}
          placeholder="e.g. 10000"
          keyboardType="numeric"
          optional
        />
        <StyledInput
          label="Next due date"
          value={nextDueDate}
          onChangeText={setNextDueDate}
          placeholder="YYYY-MM-DD"
          optional
        />
        <StyledInput
          label="Remarks"
          value={remarks}
          onChangeText={setRemarks}
          placeholder="e.g. Brand of part currently in use, observations…"
          optional
          multiline
        />

        {/* Service Log */}
        <Text className="text-base font-playfair-medium text-zen-text mb-4 mt-2">Record This Service</Text>
        <StyledInput label="Service date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <StyledInput label="Odometer at service" value={odometer} onChangeText={setOdometer} placeholder={String(Math.round(currentOdo))} keyboardType="numeric" />
        <StyledInput label="Cost" value={cost} onChangeText={setCost} placeholder="e.g. 45.00" keyboardType="decimal-pad" optional />
        <StyledInput label="Workshop" value={workshop} onChangeText={setWorkshop} placeholder="e.g. Cycle Craft Jurong" optional />
        <StyledInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Observations about this service…" optional />

        {/* Service history */}
        {history.length > 0 && (
          <>
            <Text className="text-xs uppercase tracking-widest text-zen-muted font-inter-medium mt-4 mb-2.5">
              Service history
            </Text>
            {history.slice(0, 5).map(h => (
              <View key={h.id} className="bg-zen-surface rounded-2xl px-3.5 py-3 mb-2 border border-zen-primary/[0.07]">
                <View className="flex-row justify-between">
                  <Text className="text-sm font-inter-medium text-zen-text">{h.date}</Text>
                  {h.odometer ? <Text className="text-xs text-zen-muted font-inter">{formatOdometer(h.odometer)}</Text> : null}
                </View>
                {h.workshop ? <Text className="text-xs text-zen-muted font-inter mt-0.5">{h.workshop}</Text> : null}
                {h.cost ? <Text className="text-xs text-zen-muted font-inter mt-0.5">SGD {h.cost.toFixed(2)}</Text> : null}
                {h.notes ? <Text className="text-xs text-zen-muted font-inter mt-0.5">{h.notes}</Text> : null}
              </View>
            ))}
          </>
        )}

        <View className="h-16" />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
