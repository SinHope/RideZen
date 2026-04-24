import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { fuelRepo } from '@/repositories/fuelRepo';
import { maintenanceRepo } from '@/repositories/maintenanceRepo';
import { vehicleRepo } from '@/repositories/vehicleRepo';
import { logToFile } from './logger';
import { Vehicle, FuelLog, MaintenanceItem, MaintenanceLog } from '@/types';

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fuelTableRows(logs: FuelLog[]): string {
  if (!logs.length) return `<tr><td colspan="6" style="text-align:center;color:#9CA3AF;">No fuel logs recorded</td></tr>`;
  return logs.map(l => `
    <tr>
      <td>${l.date}</td>
      <td>${fmt(l.odometer, 0)} km</td>
      <td>${fmt(l.litres)} L</td>
      <td>${l.price_per_litre ? `SGD ${fmt(l.price_per_litre)}` : '—'}</td>
      <td>${l.consumption ? `${fmt(l.consumption)} L/100km` : '—'}</td>
      <td>${l.notes ?? '—'}</td>
    </tr>`).join('');
}

function maintenanceRows(items: MaintenanceItem[], historyMap: Record<number, MaintenanceLog[]>): string {
  if (!items.length) return `<tr><td colspan="5" style="text-align:center;color:#9CA3AF;">No maintenance items</td></tr>`;
  return items.map(item => {
    const history = historyMap[item.id] ?? [];
    const lastService = history[0];
    const statusColor =
      item.status === 'overdue' ? '#CC0000' :
      item.status === 'urgent' ? '#B45309' :
      item.status === 'due' ? '#C45E0A' : '#2D6A4F';
    const statusLabel = item.status
      ? item.status.charAt(0).toUpperCase() + item.status.slice(1)
      : 'OK';
    return `
    <tr>
      <td><strong>${item.category}</strong></td>
      <td style="color:${statusColor};font-weight:600;">${statusLabel}</td>
      <td>${item.next_due_odo ? `${fmt(item.next_due_odo, 0)} km` : item.next_due_date ?? '—'}</td>
      <td>${lastService ? lastService.date : '—'}</td>
      <td>${history.length}</td>
    </tr>`;
  }).join('');
}

function buildHtml(vehicle: Vehicle, fuelLogs: FuelLog[], maintenanceItems: MaintenanceItem[], historyMap: Record<number, MaintenanceLog[]>): string {
  const exportDate = new Date().toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' });
  const totalFuelCost = fuelLogs
    .filter(l => l.price_per_litre && l.litres)
    .reduce((sum, l) => sum + (l.price_per_litre! * l.litres), 0);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 12px; color: #1F2937; background: #fff; padding: 32px; }
  .header { background: #1B6CA8; color: white; padding: 24px 28px; border-radius: 12px; margin-bottom: 28px; }
  .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .header p { font-size: 12px; opacity: 0.8; }
  .vehicle-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 28px; }
  .stat-card { background: #F0F9FF; border: 1px solid #BAE6FD; border-radius: 10px; padding: 14px 16px; }
  .stat-card .label { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .stat-card .value { font-size: 16px; font-weight: 700; color: #1B6CA8; }
  .stat-card .sub { font-size: 10px; color: #9CA3AF; margin-top: 2px; }
  h2 { font-size: 14px; font-weight: 700; color: #0D3B5E; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #E5F3FF; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 28px; font-size: 11px; }
  th { background: #1B6CA8; color: white; padding: 8px 10px; text-align: left; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #F3F4F6; }
  tr:nth-child(even) td { background: #F9FAFB; }
  .footer { margin-top: 16px; text-align: center; font-size: 10px; color: #9CA3AF; border-top: 1px solid #E5E7EB; padding-top: 12px; }
</style>
</head>
<body>

<div class="header">
  <h1>RideZen — Vehicle Report</h1>
  <p>Generated on ${exportDate} · ${vehicle.nickname}</p>
</div>

<div class="vehicle-grid">
  <div class="stat-card">
    <div class="label">Vehicle</div>
    <div class="value">${vehicle.nickname}</div>
    <div class="sub">${[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ')}</div>
  </div>
  <div class="stat-card">
    <div class="label">Current Odometer</div>
    <div class="value">${fmt(vehicle.current_odometer, 0)} km</div>
    <div class="sub">${vehicle.plate_number ?? 'No plate recorded'}</div>
  </div>
  <div class="stat-card">
    <div class="label">Total Fuel Cost</div>
    <div class="value">SGD ${fmt(totalFuelCost)}</div>
    <div class="sub">${fuelLogs.length} refuel${fuelLogs.length !== 1 ? 's' : ''} recorded</div>
  </div>
</div>

<h2>Fuel Log (${fuelLogs.length} entries)</h2>
<table>
  <thead>
    <tr>
      <th>Date</th><th>Odometer</th><th>Litres</th><th>Price/L</th><th>Consumption</th><th>Notes</th>
    </tr>
  </thead>
  <tbody>
    ${fuelTableRows(fuelLogs)}
  </tbody>
</table>

<h2>Maintenance Schedule (${maintenanceItems.length} items)</h2>
<table>
  <thead>
    <tr>
      <th>Item</th><th>Status</th><th>Next Due</th><th>Last Serviced</th><th>Service Count</th>
    </tr>
  </thead>
  <tbody>
    ${maintenanceRows(maintenanceItems, historyMap)}
  </tbody>
</table>

<div class="footer">RideZen · TulusNas Software Studio · All data stored locally on your device</div>

</body>
</html>`;
}

export async function exportAllDataAsPdf(vehicleId: number, vehicleNickname: string): Promise<void> {
  try {
    const [vehicleResult, fuelResult, maintResult] = await Promise.all([
      vehicleRepo.getById(vehicleId),
      fuelRepo.getByVehicle(vehicleId, 1000),
      maintenanceRepo.getByVehicle(vehicleId, 0),
    ]);

    if (!vehicleResult.data) throw new Error('Vehicle not found.');

    const vehicle = vehicleResult.data;
    const fuelLogs = fuelResult.data ?? [];
    const maintItems = maintResult.data ?? [];

    // Load history for each maintenance item
    const historyMap: Record<number, MaintenanceLog[]> = {};
    await Promise.all(
      maintItems.map(async item => {
        const h = await maintenanceRepo.getHistory(item.id);
        historyMap[item.id] = h.data ?? [];
      })
    );

    const html = buildHtml(vehicle, fuelLogs, maintItems, historyMap);
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const filename = `ridezen_report_${vehicleNickname.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    const dest = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.moveAsync({ from: uri, to: dest });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Export Vehicle Report' });
    }

    await FileSystem.deleteAsync(dest, { idempotent: true });
  } catch (e) {
    logToFile('EXPORT_ERROR', 'exportAllDataAsPdf', String(e));
    throw new Error('Could not generate PDF. Please try again.');
  }
}
