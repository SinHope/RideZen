// A dependency-free "something changed, please re-check maintenance notifications" hook.
//
// Repositories call requestMaintenanceSync() after a write that can change a due level (odometer, items,
// service logs). The real work lives in maintenanceNotifications.ts, which READS those same repositories —
// so repositories can't import it without an import cycle. Instead maintenanceNotifications.ts registers its
// debounced sync here when it loads; until then (and in tests that don't load it) a request is a no-op.
// Never throws: a failed re-check request must never fail the write that triggered it.

type Requester = () => void;

let requester: Requester | null = null;

export function registerMaintenanceSyncRequester(fn: Requester | null): void {
  requester = fn;
}

export function requestMaintenanceSync(): void {
  try {
    requester?.();
  } catch {
    // ignore — see header
  }
}
