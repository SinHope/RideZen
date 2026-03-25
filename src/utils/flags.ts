// Cross-screen flags for one-shot prompts.
// Set before navigation, consume once on the destination screen.

let _maintenancePromptPending = false;

export function setMaintenancePromptPending() {
  _maintenancePromptPending = true;
}

export function consumeMaintenancePromptPending(): boolean {
  const val = _maintenancePromptPending;
  _maintenancePromptPending = false;
  return val;
}

let _trackingOnboardingPending = false;

export function setTrackingOnboardingPending() {
  _trackingOnboardingPending = true;
}

export function consumeTrackingOnboardingPending(): boolean {
  const val = _trackingOnboardingPending;
  _trackingOnboardingPending = false;
  return val;
}
