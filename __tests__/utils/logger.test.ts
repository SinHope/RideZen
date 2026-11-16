/**
 * logger.ts — the error log file (ridezen_errors.log).
 *
 * Uses the REAL expo-file-system module on purpose. In Expo SDK 54+ the old function API
 * (writeAsStringAsync, readAsStringAsync, getInfoAsync, deleteAsync, documentDirectory, EncodingType) is no longer
 * available from "expo-file-system" — it moved to "expo-file-system/legacy", and the old names exported from the
 * main entry just throw. logger.ts still imports from the main entry, so its writes fail — and its catch blocks
 * hide that. The it.failing tests below pin this: they pass today (the bug exists) and will start failing the day
 * logger.ts is migrated, which is the cue to turn them into normal tests.
 */
import fs from 'fs';
import path from 'path';
import { clearLog, getLogContents, logToFile } from '@/utils/logger';

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('never gets in the way', () => {
  it('logToFile does not throw, whatever the file system does', async () => {
    await expect(logToFile('DB_ERROR', 'something broke', 'detail')).resolves.toBeUndefined();
  });

  it('getLogContents returns an empty string when the log cannot be read', async () => {
    await expect(getLogContents()).resolves.toBe('');
  });

  it('clearLog does not throw', async () => {
    await expect(clearLog()).resolves.toBeUndefined();
  });
});

describe('known gap: the log file is never actually written', () => {
  // logToFile evaluates `FileSystem.EncodingType.UTF8` BEFORE it writes — undefined on the main entry in SDK 55 — so it
  // throws a TypeError that the catch block swallows, and never even reaches the write. Check the contract directly:
  // the legacy names must not be used unless they come from "expo-file-system/legacy".
  it.failing('logger.ts only uses file functions that exist in this SDK', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/utils/logger.ts'), 'utf8');
    const usesRemovedNames = /writeAsStringAsync|readAsStringAsync|getInfoAsync|deleteAsync|documentDirectory|EncodingType/.test(source);
    const importsLegacyEntry = /from 'expo-file-system\/legacy'/.test(source);
    expect(!usesRemovedNames || importsLegacyEntry).toBe(true);
  });

  // The read / delete sides do reach the removed API, which warns "...is deprecated" before throwing.
  it.failing('getLogContents uses a file API that exists in this SDK (no "deprecated" warning)', async () => {
    await getLogContents();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('deprecated'));
  });

  it.failing('clearLog uses a file API that exists in this SDK (no "deprecated" warning)', async () => {
    await clearLog();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('deprecated'));
  });
});
