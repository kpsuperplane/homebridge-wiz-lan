// Tracks consecutive missed getPilot responses per device MAC so the plugin
// can surface unreachable bulbs to HomeKit as "Not Responding" instead of
// silently replaying stale cached state. Any successful getPilot reply —
// or a fresh discovery / getSystemConfig response — clears the miss count.
const missCount: { [mac: string]: number } = {};

export function recordMiss(mac: string): number {
  missCount[mac] = (missCount[mac] ?? 0) + 1;
  return missCount[mac];
}

export function recordHit(mac: string): void {
  if (mac in missCount) {
    delete missCount[mac];
  }
}

export function getMisses(mac: string): number {
  return missCount[mac] ?? 0;
}

export function isOffline(mac: string, threshold: number): boolean {
  return (missCount[mac] ?? 0) >= threshold;
}
