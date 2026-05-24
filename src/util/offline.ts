const failureCounts: { [mac: string]: number } = {};
const offlineSet: Set<string> = new Set();

/** Increments failure count. Returns true the first time the threshold is crossed. */
export function recordFailure(mac: string, threshold: number): boolean {
  failureCounts[mac] = (failureCounts[mac] ?? 0) + 1;
  if (failureCounts[mac] >= threshold && !offlineSet.has(mac)) {
    offlineSet.add(mac);
    return true;
  }
  return false;
}

/** Resets failure count. Returns true if the device was previously offline. */
export function recordSuccess(mac: string): boolean {
  const wasOffline = offlineSet.has(mac);
  failureCounts[mac] = 0;
  offlineSet.delete(mac);
  return wasOffline;
}

export function isOffline(mac: string): boolean {
  return offlineSet.has(mac);
}
