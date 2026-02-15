import type { HeartbeatVisibilityConfig } from "../types/config.js";
import type { HeartbeatVisibility } from "../types/heartbeat.js";

/**
 * Resolve heartbeat visibility settings with config precedence.
 * Channel-level config overrides global config.
 */
export function resolveVisibility(
  globalConfig: HeartbeatVisibilityConfig,
  channelOverride?: Partial<HeartbeatVisibility>,
): HeartbeatVisibility {
  return {
    showOk: channelOverride?.showOk ?? globalConfig.showOk,
    showAlerts: channelOverride?.showAlerts ?? globalConfig.showAlerts,
    useIndicator: channelOverride?.useIndicator ?? globalConfig.useIndicator,
  };
}

/**
 * Determine if a heartbeat result should be delivered based on visibility settings.
 */
export function shouldDeliver(
  visibility: HeartbeatVisibility,
  hasContent: boolean,
  wasOk: boolean,
): boolean {
  if (wasOk && !hasContent) {
    return visibility.showOk;
  }
  if (hasContent) {
    return visibility.showAlerts;
  }
  return false;
}
