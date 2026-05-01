import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SUPPORTED_CURRENCIES, CurrencyInfo, getRecentCurrencies, addRecentCurrency } from '@/services/currencyService';
import { ArrowLeftIcon } from '@/components/icons';

interface Props {
  visible: boolean;
  selected: string;
  onSelect: (code: string) => void;
  onClose: () => void;
}

export function CurrencyPickerModal({ visible, selected, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [recentCodes, setRecentCodes] = useState<string[]>([]);

  useEffect(() => {
    if (visible) {
      setSearch('');
      setRecentCodes(getRecentCurrencies());
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SUPPORTED_CURRENCIES;
    return SUPPORTED_CURRENCIES.filter(
      c =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.country.toLowerCase().includes(q)
    );
  }, [search]);

  const recentItems = useMemo(
    () => SUPPORTED_CURRENCIES.filter(c => recentCodes.includes(c.code))
           .sort((a, b) => recentCodes.indexOf(a.code) - recentCodes.indexOf(b.code)),
    [recentCodes]
  );

  const handleSelect = (code: string) => {
    addRecentCurrency(code);
    onSelect(code);
    onClose();
  };

  const renderItem = useCallback(({ item }: { item: CurrencyInfo }) => {
    const isSelected = item.code === selected;
    return (
      <TouchableOpacity
        onPress={() => handleSelect(item.code)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingVertical: 13,
          backgroundColor: isSelected ? '#EFF8FF' : 'white',
          borderBottomWidth: 1,
          borderBottomColor: 'rgba(27,108,168,0.06)',
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.code} ${item.name}`}
      >
        {/* Currency code badge */}
        <View
          style={{
            width: 52,
            height: 32,
            borderRadius: 8,
            backgroundColor: isSelected ? '#1B6CA8' : '#F0F8FF',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              fontSize: 12,
              color: isSelected ? 'white' : '#1B6CA8',
            }}
          >
            {item.code}
          </Text>
        </View>

        {/* Name + country */}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 13,
              color: isSelected ? '#1B6CA8' : '#1F2937',
            }}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: '#9CA3AF',
              marginTop: 1,
            }}
            numberOfLines={1}
          >
            {item.country}
          </Text>
        </View>

        {/* Selected indicator */}
        {isSelected && (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#1B6CA8',
              marginLeft: 10,
            }}
          />
        )}
      </TouchableOpacity>
    );
  }, [selected]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: 'white', paddingTop: insets.top }}>

        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: 'rgba(27,108,168,0.08)',
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: '#F0F8FF',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <ArrowLeftIcon color="#1B6CA8" size={16} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'PlayfairDisplay_500Medium', fontSize: 20, color: '#0D3B5E' }}>
              Select Currency
            </Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
              {SUPPORTED_CURRENCIES.length} currencies supported
            </Text>
          </View>
        </View>

        {/* Search */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            margin: 16,
            backgroundColor: '#F0F8FF',
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderWidth: 1,
            borderColor: 'rgba(27,108,168,0.12)',
          }}
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by code, name or country..."
            placeholderTextColor="#9CA3AF"
            autoCorrect={false}
            style={{
              flex: 1,
              fontFamily: 'Inter_400Regular',
              fontSize: 13,
              color: '#1F2937',
            }}
            accessibilityLabel="Search currencies"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: '#9CA3AF' }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Results count */}
        {search.length > 0 && (
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              fontSize: 11,
              color: '#9CA3AF',
              paddingHorizontal: 20,
              marginBottom: 8,
            }}
          >
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </Text>
        )}

        {/* Most Recent section — rendered outside FlashList so it doesn't interfere with list rendering */}
        {recentItems.length > 0 && !search.trim() && (
          <View>
            <Text style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 10,
              color: '#9CA3AF',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              paddingHorizontal: 20,
              paddingTop: 4,
              paddingBottom: 6,
            }}>
              Most Recent
            </Text>
            {recentItems.map(item => {
              const isSelected = item.code === selected;
              return (
                <TouchableOpacity
                  key={item.code}
                  onPress={() => handleSelect(item.code)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 20,
                    paddingVertical: 13,
                    backgroundColor: isSelected ? '#EFF8FF' : '#FAFEFF',
                    borderBottomWidth: 1,
                    borderBottomColor: 'rgba(27,108,168,0.06)',
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.code} ${item.name}`}
                >
                  <View style={{
                    width: 52, height: 32, borderRadius: 8,
                    backgroundColor: isSelected ? '#1B6CA8' : '#F0F8FF',
                    alignItems: 'center', justifyContent: 'center', marginRight: 14,
                  }}>
                    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: isSelected ? 'white' : '#1B6CA8' }}>
                      {item.code}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: isSelected ? '#1B6CA8' : '#1F2937' }} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: '#9CA3AF', marginTop: 1 }} numberOfLines={1}>
                      {item.country}
                    </Text>
                  </View>
                  {isSelected && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#1B6CA8', marginLeft: 10 }} />
                  )}
                </TouchableOpacity>
              );
            })}
            <Text style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 10,
              color: '#9CA3AF',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              paddingHorizontal: 20,
              paddingTop: 14,
              paddingBottom: 6,
              borderTopWidth: 1,
              borderTopColor: 'rgba(27,108,168,0.08)',
              marginTop: 4,
            }}>
              All Currencies
            </Text>
          </View>
        )}

        {/* Full currency list */}
        <View style={{ flex: 1 }}>
          <FlashList
            data={filtered}
            renderItem={renderItem}
            estimatedItemSize={58}
            keyExtractor={item => item.code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 48 }}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#9CA3AF' }}>
                  No currencies match "{search}"
                </Text>
              </View>
            }
          />
        </View>

      </View>
    </Modal>
  );
}
