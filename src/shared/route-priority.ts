// Pure helpers for sorting peer network routes by liveness and latency.
// Used both in the main process (when serializing peer state) and as a
// reference for the renderer when picking which entry to display.

import type { PeerNetworkRoute } from './protocol';

const KIND_PRIORITY: Record<PeerNetworkRoute['kind'], number> = {
  // Among routes that are both online and at similar latency, prefer
  // tailnet > lan > manual. This matches the user mental model of
  // "Tailscale first if reachable, LAN second, manual peer last".
  tailnet: 0,
  lan: 1,
  manual: 2
};

/**
 * Stable sort that prefers online + low-latency routes, then tailnet over
 * LAN over manual. Routes without a latency measurement are still kept
 * (sorted after measured ones) so we never lose a fallback.
 */
export function sortRoutesByLatency<T extends Pick<PeerNetworkRoute, 'kind' | 'latencyMs' | 'status'>>(routes: readonly T[]): T[] {
  return [...routes].sort((a, b) => {
    const aOnline = a.status === 'online' ? 0 : 1;
    const bOnline = b.status === 'online' ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;

    const aHasLatency = typeof a.latencyMs === 'number' ? 0 : 1;
    const bHasLatency = typeof b.latencyMs === 'number' ? 0 : 1;
    if (aHasLatency !== bHasLatency) return aHasLatency - bHasLatency;

    if (aHasLatency === 0 && bHasLatency === 0 && a.latencyMs !== b.latencyMs) {
      return (a.latencyMs as number) - (b.latencyMs as number);
    }

    return (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9);
  });
}

/**
 * Pick the single best route from a sorted list. Returns null if routes is
 * empty. Always returns the first entry after sorting; callers should pass
 * an already-sorted list.
 */
export function pickPrimaryRoute<T extends PeerNetworkRoute>(routes: readonly T[]): T | null {
  if (!routes.length) return null;
  return sortRoutesByLatency(routes)[0];
}