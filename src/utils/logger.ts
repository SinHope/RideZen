import * as FileSystem from 'expo-file-system';

const LOG_PATH = (FileSystem.documentDirectory ?? '') + 'ridezen_errors.log';

export async function logToFile(type: string, message: string, detail = ''): Promise<void> {
  const entry = `[${new Date().toISOString()}] [${type}] ${message} ${detail}\n`;
  try {
    await FileSystem.writeAsStringAsync(LOG_PATH, entry, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    // Swallow logger errors silently
  }
}

export async function getLogContents(): Promise<string> {
  try {
    const info = await FileSystem.getInfoAsync(LOG_PATH);
    if (!info.exists) return '';
    return await FileSystem.readAsStringAsync(LOG_PATH);
  } catch {
    return '';
  }
}

export async function clearLog(): Promise<void> {
  try {
    await FileSystem.deleteAsync(LOG_PATH, { idempotent: true });
  } catch {
    // ignore
  }
}
