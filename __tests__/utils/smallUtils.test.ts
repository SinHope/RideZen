/**
 * cn (class-name merging) and the one-shot cross-screen flags.
 */
import { cn } from '@/utils/cn';

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('p-2', 'text-red-500')).toBe('p-2 text-red-500');
  });

  it('skips falsy values and supports conditionals', () => {
    expect(cn('a', false && 'b', null, undefined, '', 'c')).toBe('a c');
    expect(cn('a', { b: true, c: false })).toBe('a b');
    expect(cn(['a', ['b']], 'c')).toBe('a b c');
  });

  it('lets a later Tailwind class override a conflicting earlier one', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-gray-500', 'text-red-500')).toBe('text-sm text-red-500');
    expect(cn('px-2 py-1', 'px-6')).toBe('py-1 px-6');
  });

  it('keeps non-conflicting classes', () => {
    expect(cn('flex', 'items-center', 'gap-2')).toBe('flex items-center gap-2');
  });

  it('returns an empty string for nothing', () => {
    expect(cn()).toBe('');
    expect(cn(undefined, null, false)).toBe('');
  });
});

describe('cross-screen flags', () => {
  // The flags live in module state, so load a fresh copy for every test.
  let flags: typeof import('@/utils/flags');
  beforeEach(() => {
    jest.resetModules();
    flags = require('@/utils/flags');
  });

  it('start unset', () => {
    expect(flags.consumeMaintenancePromptPending()).toBe(false);
    expect(flags.consumeTrackingOnboardingPending()).toBe(false);
  });

  it('a flag is true exactly once after it is set', () => {
    flags.setMaintenancePromptPending();
    expect(flags.consumeMaintenancePromptPending()).toBe(true);
    expect(flags.consumeMaintenancePromptPending()).toBe(false);
  });

  it('setting twice still only fires once', () => {
    flags.setTrackingOnboardingPending();
    flags.setTrackingOnboardingPending();
    expect(flags.consumeTrackingOnboardingPending()).toBe(true);
    expect(flags.consumeTrackingOnboardingPending()).toBe(false);
  });

  it('the two flags are independent', () => {
    flags.setMaintenancePromptPending();
    expect(flags.consumeTrackingOnboardingPending()).toBe(false);
    expect(flags.consumeMaintenancePromptPending()).toBe(true);
  });

  it('can be set again after being consumed', () => {
    flags.setMaintenancePromptPending();
    flags.consumeMaintenancePromptPending();
    flags.setMaintenancePromptPending();
    expect(flags.consumeMaintenancePromptPending()).toBe(true);
  });
});
