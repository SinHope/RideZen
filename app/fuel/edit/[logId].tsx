import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform, Alert, Switch, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fuelRepo } from '@/repositories/fuelRepo';
import { ArrowLeftIcon } from '@/components/icons';
import { CurrencyPickerModal } from '@/components/CurrencyPickerModal';
import { DateWheelPickerModal } from '@/components/DateWheelPicker';
import { getHomeCurrency, getRates, convert, ExchangeRates } from '@/services/currencyService';
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

export default function EditFuelLogScreen() {
  const insets = useSafeAreaInsets();
  const { logId } = useLocalSearchParams<{ logId: string }>();

  const [vehicleId, setVehicleId] = useState<number>(0);
  const [date, setDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [litres, setLitres] = useState('');
  const [pricePerLitre, setPricePerLitre] = useState('');
  const [currency, setCurrency] = useState(getHomeCurrency());
  const [localPrice, setLocalPrice] = useState('');
  const [localCurrency, setLocalCurrency] = useState(getHomeCurrency());
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showLocalCurrencyPicker, setShowLocalCurrencyPicker] = useState(false);
  const [isFullTank, setIsFullTank] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = parseInt(logId);
    const bail = () => {
      Alert.alert('Not found', 'This fuel log no longer exists.');
      router.back();
    };
    if (!id) { bail(); return; }

    Promise.all([fuelRepo.getById(id), getRates()])
      .then(([logResult, ratesData]) => {
        setRates(ratesData);
        const log = logResult.data;
        if (!log) { bail(); return; }

        const ppl = log.price_per_litre ? String(log.price_per_litre) : '';
        const curr = log.currency ?? getHomeCurrency();
        const homeCurr = getHomeCurrency();

        setVehicleId(log.vehicle_id);
        setDate(log.date);
        setOdometer(String(log.odometer));
        setLitres(String(log.litres));
        setPricePerLitre(ppl);
        setCurrency(curr);
        setIsFullTank(log.is_full_tank === 1);
        setNotes(log.notes ?? '');

        if (ppl && ratesData && curr !== homeCurr) {
          setLocalPrice(convert(parseFloat(ppl), curr, homeCurr, ratesData).toFixed(4));
        }

        setLoading(false);
      })
      .catch(bail);
  }, [logId]);

  const doConvert = (val: string, from: string, to: string, r: ExchangeRates | null): string => {
    if (!r || !val) return '';
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return '';
    return convert(num, from, to, r).toFixed(4);
  };

  const handlePriceChange = (val: string) => {
    setPricePerLitre(val);
    setLocalPrice(doConvert(val, currency, localCurrency, rates));
  };

  const handleLocalPriceChange = (val: string) => {
    setLocalPrice(val);
    setPricePerLitre(doConvert(val, localCurrency, currency, rates));
  };

  const handleCurrencySelect = (code: string) => {
    setCurrency(code);
    setLocalPrice(doConvert(pricePerLitre, code, localCurrency, rates));
  };

  const handleLocalCurrencySelect = (code: string) => {
    setLocalCurrency(code);
    setLocalPrice(doConvert(pricePerLitre, currency, code, rates));
  };

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

    // Lock in the home-currency price at log time so totals never mix currencies
    const home = getHomeCurrency();
    let priceHome: number | undefined;
    if (parsed.data.price_per_litre != null) {
      if (currency === home) priceHome = parsed.data.price_per_litre;
      else if (rates) priceHome = parseFloat(convert(parsed.data.price_per_litre, currency, home, rates).toFixed(4));
    }

    setSaving(true);
    const result = await fuelRepo.update(parseInt(logId), {
      vehicle_id: vehicleId,
      ...parsed.data,
      currency,
      price_home: priceHome,
    });
    setSaving(false);

    if (result.error) { Alert.alert('Error', result.error); return; }
    router.back();
  };

  if (loading) {
    return (
      <View className="flex-1 bg-zen-bg items-center justify-center">
        <ActivityIndicator color="#2D6A4F" />
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
          <Text className="text-2xl text-white font-playfair-medium">Edit Refuel</Text>
        </View>
        <TouchableOpacity
          className={`px-4 py-2 rounded-full ${saving ? 'bg-white/30' : 'bg-white'}`}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save changes"
        >
          <Text className="text-zen-secondary font-inter-semibold text-sm">{saving ? 'Saving…' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="flex-1 px-4 pt-5" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Date */}
        <View className="mb-4">
          <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest mb-1.5">Date</Text>
          <TouchableOpacity
            onPress={() => setShowDatePicker(true)}
            className="flex-row items-center bg-zen-surface border border-zen-primary/15 rounded-2xl px-3.5 py-3"
            accessibilityRole="button"
            accessibilityLabel={`Date: ${date}. Tap to change`}
          >
            <Text className="flex-1 text-sm font-inter text-zen-text">
              {date
                ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'long', year: 'numeric',
                  })
                : 'Select date'}
            </Text>
            <Text className="text-xs text-zen-muted font-inter ml-2">▼</Text>
          </TouchableOpacity>
        </View>

        <StyledInput label="Odometer *" value={odometer} onChangeText={setOdometer} placeholder="e.g. 14820" keyboardType="numeric" suffix="km" />
        <StyledInput label="Litres filled *" value={litres} onChangeText={setLitres} placeholder="e.g. 6.2" keyboardType="decimal-pad" suffix="L" />

        {/* Price per litre — bidirectional currency converter */}
        <View className="mb-4">
          <View className="flex-row items-center mb-1.5">
            <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest">Price per litre</Text>
            <Text className="text-xs text-zen-muted font-inter ml-1">(optional)</Text>
          </View>
          <View className="flex-row items-center bg-zen-surface border border-zen-primary/15 rounded-2xl px-3.5 py-3">
            <TextInput
              className="flex-1 text-sm font-inter text-zen-text"
              value={pricePerLitre}
              onChangeText={handlePriceChange}
              placeholder="e.g. 2.48"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
              accessibilityLabel="Price per litre"
            />
            <TouchableOpacity
              onPress={() => setShowCurrencyPicker(true)}
              className="ml-2 px-2.5 py-1 rounded-lg bg-zen-primary/10 border border-zen-primary/20"
              accessibilityRole="button"
              accessibilityLabel={`Pump currency: ${currency}. Tap to change`}
            >
              <Text className="text-xs font-inter-semibold text-zen-primary">{currency}</Text>
            </TouchableOpacity>
          </View>

          <View className="items-center my-2">
            <View
              className="flex-row items-center gap-2 px-3 py-1 rounded-full"
              style={{ backgroundColor: 'rgba(27,108,168,0.07)' }}
            >
              <Text style={{ fontSize: 13, color: '#1B6CA8', lineHeight: 16 }}>↓</Text>
              <Text style={{ fontSize: 13, color: '#1B6CA8', lineHeight: 16 }}>↑</Text>
              {rates && currency !== localCurrency && (
                <Text className="text-xs font-inter text-zen-muted" style={{ marginLeft: 4 }}>
                  1 {currency} = {convert(1, currency, localCurrency, rates).toFixed(4)} {localCurrency}
                </Text>
              )}
              {(!rates || currency === localCurrency) && (
                <Text className="text-xs font-inter text-zen-muted" style={{ marginLeft: 4 }}>
                  {currency === localCurrency ? '1 : 1' : 'loading rates…'}
                </Text>
              )}
            </View>
          </View>

          <View className="flex-row items-center mb-1.5">
            <Text className="text-xs font-inter-medium text-zen-muted uppercase tracking-widest">Local currency</Text>
          </View>
          <View className="flex-row items-center bg-zen-surface border border-zen-primary/15 rounded-2xl px-3.5 py-3">
            <TextInput
              className="flex-1 text-sm font-inter text-zen-text"
              value={localPrice}
              onChangeText={handleLocalPriceChange}
              placeholder="converted amount"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
              accessibilityLabel="Local currency amount"
            />
            <TouchableOpacity
              onPress={() => setShowLocalCurrencyPicker(true)}
              className="ml-2 px-2.5 py-1 rounded-lg bg-zen-primary/10 border border-zen-primary/20"
              accessibilityRole="button"
              accessibilityLabel={`Local currency: ${localCurrency}. Tap to change`}
            >
              <Text className="text-xs font-inter-semibold text-zen-primary">{localCurrency}</Text>
            </TouchableOpacity>
          </View>
        </View>

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
              Partial fills are recorded and rolled into your next full-tank fill's L/100km calculation — consumption is measured between two full-tank fills.
            </Text>
          </View>
        )}

        <View className="h-16" />
      </ScrollView>

      <DateWheelPickerModal
        visible={showDatePicker}
        value={date}
        onConfirm={setDate}
        onClose={() => setShowDatePicker(false)}
      />
      <CurrencyPickerModal
        visible={showCurrencyPicker}
        selected={currency}
        onSelect={handleCurrencySelect}
        onClose={() => setShowCurrencyPicker(false)}
      />
      <CurrencyPickerModal
        visible={showLocalCurrencyPicker}
        selected={localCurrency}
        onSelect={handleLocalCurrencySelect}
        onClose={() => setShowLocalCurrencyPicker(false)}
      />
    </KeyboardAvoidingView>
  );
}
