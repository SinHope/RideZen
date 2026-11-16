/**
 * A stand-in for `expo-router` shared by the screen tests.
 *
 *   jest.mock('expo-router', () => require('../helpers/routerMock').expoRouterMock());
 *
 * - `router` / `useRouter()` are the same jest.fn()s, exported as `routerMocks` so tests can assert navigation.
 * - `useLocalSearchParams()` returns whatever the test set with setRouteParams().
 * - `useFocusEffect(cb)` runs `cb` on mount and again whenever `cb` changes — like a screen gaining focus — and
 *   `focusAgain()` re-runs it, like coming back to the screen.
 */
import React from 'react';

export const routerMocks = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};

const PARAMS = '__routeParams';
export function setRouteParams(params: Record<string, string>): void {
  (globalThis as any)[PARAMS] = params;
}

const focusSubscribers = new Set<() => void>();
/** Pretend the rider navigated away and came back to the screen. */
export function focusAgain(): void {
  focusSubscribers.forEach((rerun) => rerun());
}

export function resetRouterMocks(): void {
  Object.values(routerMocks).forEach((m) => m.mockReset());
  setRouteParams({});
  focusSubscribers.clear();
}

export function expoRouterMock() {
  const Passthrough = ({ children }: any) => <>{children}</>;
  const Stack: any = ({ children }: any) => <>{children}</>;
  Stack.Screen = () => null;
  const Tabs: any = ({ children }: any) => <>{children}</>;
  Tabs.Screen = () => null;

  return {
    router: routerMocks,
    useRouter: () => routerMocks,
    useLocalSearchParams: () => (globalThis as any)[PARAMS] ?? {},
    useFocusEffect: (cb: () => void | (() => void)) => {
      const ref = React.useRef(cb);
      ref.current = cb;
      React.useEffect(() => {
        const rerun = () => {
          ref.current();
        };
        focusSubscribers.add(rerun);
        const cleanup = cb();
        return () => {
          focusSubscribers.delete(rerun);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [cb]);
    },
    useRootNavigationState: () => ({ key: 'root' }),
    Stack,
    Tabs,
    Link: Passthrough,
  };
}
