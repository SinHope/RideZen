import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { logToFile } from './logger';
import { FuelLog, MaintenanceLog } from '@/types';

function escapeCsvField(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function fuelLogsToCsv(logs: FuelLog[]): string {
  const header = 'date,odometer,litres,price_per_litre,is_full_tank,consumption,km_since_last,notes';
  const rows = logs.map(l =>
    [l.date, l.odometer, l.litres, l.price_per_litre, l.is_full_tank, l.consumption, l.km_since_last, l.notes]
      .map(escapeCsvField).join(',')
  );
  return [header, ...rows].join('\n');
}

export async function exportFuelLogs(vehicleId: number, vehicleNickname: string): Promise<void> {
  try {
    const result = await fuelRepo.getByVehicle(vehicleId, 1000);
    if (!result.data) throw new Error(result.error ?? 'No data');

    const csv = fuelLogsToCsv(result.data);
    const filename = `ridezen_fuel_${vehicleNickname.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    const path = `${FileSystem.cacheDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Fuel Log' });
    }

    // Clean up cache after sharing
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (e) {
    logToFile('EXPORT_ERROR', 'exportFuelLogs', String(e));
    throw new Error('Could not export your data. Please check your storage space and try again.');
  }
}

export async function exportAllData(vehicleId: number, vehicleNickname: string): Promise<void> {
  try {
    const vehicleResult = await vehicleRepo.getById(vehicleId);
    const fuelResult = await fuelRepo.getByVehicle(vehicleId, 1000);

    const exportData = {
      exported_at: new Date().toISOString(),
      app_version: '1.0.0',
      vehicle: vehicleResult.data,
      fuel_logs: fuelResult.data ?? [],
    };

    const json = JSON.stringify(exportData, null, 2);
    const filename = `ridezen_backup_${vehicleNickname.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    const path = `${FileSystem.cacheDirectory}${filename}`;

    await FileSystem.writeAsStringAsync(path, json, { encoding: FileSystem.EncodingType.UTF8 });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Export Vehicle Data' });
    }

    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch (e) {
    logToFile('EXPORT_ERROR', 'exportAllData', String(e));
    throw new Error('Could not export your data. Please check your storage space and try again.');
  }
}
