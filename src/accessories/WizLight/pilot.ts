import { Characteristic, CharacteristicValue, PlatformAccessory } from "homebridge";

import HomebridgeWizLan from "../../wiz";
import { isOffline, recordFailureOnce, recordSuccess } from "../../util/offline";
import { Device } from "../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../util/network";
import {
  clampRgb,
  colorTemperature2rgb,
  kelvinToMired,
  rgb2colorTemperature,
  rgbToHsv,
} from "../../util/color";
import { isRGB, isTW } from "./util";
import {
  transformDimming,
  transformHue,
  transformOnOff,
  transformSaturation,
  transformTemperature,
} from "./characteristics";
import {
  transformEffectId,
} from "./characteristics/scenes";
import { WizPilot } from "../WizAccessory";

export interface Pilot extends WizPilot {
  mac: string;
  rssi: number;
  src: string;
  state: boolean;
  sceneId?: number;
  speed?: number;
  temp?: number;
  dimming?: number;
  r?: number;
  g?: number;
  b?: number;
}

// We need to cache all the state values
// since we need to send them all when
// updating, otherwise the bulb resets
// to default values
export const cachedPilot: { [mac: string]: Pilot } = {};

// Bumped twice per setPilot: once when the write is optimistically committed
// to cachedPilot, and again when it resolves (ack, send error, or timeout). A
// getPilot probe captures the value when it is transmitted; if it differs when
// the reply lands, the bulb generated that reply before the write reached it
// — or while the write was still unresolved, so it may have. Committing such a
// reply would roll cachedPilot — and the HomeKit tile — back to pre-write
// state (cache-first reads leave probes in flight long enough for a user write
// to interleave, and its ack can beat the delayed reply).
//
// The resolution bump is what covers a write that is committed but not yet on
// the wire: between the two bumps the cache is ahead of the bulb, so a probe
// transmitted in that window reads pre-write state while its snapshot already
// matches the commit bump. Nothing would mark that reply stale — see the
// failed-write reconciliation in setPilot, which probes while the write queued
// behind it is still waiting its turn on the wire.
export const writeGeneration: { [mac: string]: number } = {};

// writeGeneration snapshot taken when the underlying UDP probe was actually
// transmitted (via the network layer's onTransmit hook). Probes are coalesced
// per device and may be deferred by the rate limiter, so a getPilot call can
// be answered by a probe transmitted well after the call was made. Every
// callback in that batch shares one reply and must compare against the
// transmitting probe's snapshot, not one taken when they happened to call.
const probeStartGeneration: { [mac: string]: number } = {};

export const disabledAdaptiveLightingCallback: {
  [mac: string]: () => void;
} = {};

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Keep malformed or partial firmware replies out of both the cache and HAP.
 * Some scenes omit dimming altogether, while a few firmware versions have
 * returned invalid color temperatures. The cache is the only reliable place
 * to recover the last usable dimming value when a reply is partial.
 */
export function normalizePilot(pilot: Pilot, previous?: Pilot): Pilot {
  const normalized = Object.fromEntries(
    Object.entries(pilot).filter(([, value]) => value !== undefined)
  ) as Pilot;

  if (!Number.isFinite(normalized.dimming)) {
    normalized.dimming = Number.isFinite(previous?.dimming)
      ? previous!.dimming
      : normalized.state
        ? 100
        : 10;
  }

  if (normalized.temp !== undefined && !isFinitePositive(normalized.temp)) {
    if (isFinitePositive(previous?.temp)) {
      normalized.temp = previous!.temp;
    } else {
      delete normalized.temp;
    }
  }

  return normalized;
}

// Since 3.4.0 every cache-answered read pushes the probe result back into HAP,
// which previously happened only when a device came back online. Re-publishing
// a value HomeKit already holds still emits an event notification to every
// subscribed controller, and controllers respond to notifications by reading —
// which starts another probe, which pushes again. Suppressing the no-ops
// breaks that loop; `force` covers the one case where HomeKit's stored value
// is not a reliable guide, namely clearing a "No Response" error state.
function push(
  characteristic: Characteristic,
  value: CharacteristicValue | Error,
  force: boolean
) {
  if (!force && characteristic.value === value) {
    return;
  }
  characteristic.updateValue(value);
}

function updatePilot(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device,
  pilot: Pilot | Error,
  force = false
) {
  const { Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  // An error is always published: it flips the tile to "No Response", which is
  // a state change HomeKit's stored value doesn't reflect.
  const always = force || pilot instanceof Error;

  push(
    service.getCharacteristic(wiz.Characteristic.On),
    pilot instanceof Error ? pilot : transformOnOff(pilot),
    always
  );
  push(
    service.getCharacteristic(wiz.Characteristic.Brightness),
    pilot instanceof Error ? pilot : transformDimming(pilot),
    always
  );
  if (isTW(device) || isRGB(device)) {
    let useCT = true;
    if (!(pilot instanceof Error) && pilot.sceneId && pilot.sceneId > 0) {
      useCT = false;
    }
    if (useCT) {
      push(
        service.getCharacteristic(wiz.Characteristic.ColorTemperature),
        pilot instanceof Error ? pilot : transformTemperature(pilot),
        always
      );
    }
  }
  if (isRGB(device)) {
    push(
      service.getCharacteristic(wiz.Characteristic.Hue),
      pilot instanceof Error ? pilot : transformHue(pilot),
      always
    );
    push(
      service.getCharacteristic(wiz.Characteristic.Saturation),
      pilot instanceof Error ? pilot : transformSaturation(pilot),
      always
    );
  }

  const scenesService = accessory.getService(Service.Television);

  if (scenesService != null) {
    push(
      scenesService.getCharacteristic(wiz.Characteristic.Active),
      pilot instanceof Error ? pilot : transformOnOff(pilot),
      always
    );
    push(
      scenesService.getCharacteristic(wiz.Characteristic.ActiveIdentifier),
      pilot instanceof Error ? pilot : transformEffectId(pilot),
      always
    );
  }

}

// Write a custom getPilot/setPilot that takes this
// caching into account
export function getPilot(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device,
  onSuccess: (pilot: Pilot) => void,
  onError: (error: Error) => void
) {
  const deviceIsOffline = isOffline(device.mac);
  // Once HomeKit has been answered, the probe below only refreshes
  // characteristics via updatePilot — the callbacks must not fire twice.
  let responded = false;

  if (deviceIsOffline) {
    // Respond immediately so HomeKit doesn't wait for the UDP timeout
    onError(new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
    responded = true;
    // Fall through to still probe the device so recovery is detected
  } else if (typeof cachedPilot[device.mac] !== "undefined") {
    // Answer from cache right away instead of holding HomeKit ("Updating...")
    // through a live UDP round trip; the probe pushes fresh state when it lands
    onSuccess(cachedPilot[device.mac]);
    responded = true;
  }

  const handleReply = (error: Error | null, pilot: Pilot) => {
    // Read at reply time, not call time: the network layer may have deferred
    // and coalesced this call onto a probe transmitted later, and every
    // callback in that batch shares the transmitting probe's snapshot. Safe to
    // read from the map because a probe's callbacks all run synchronously
    // before any later probe for the same device can transmit.
    const generationAtProbeStart = probeStartGeneration[device.mac] ?? 0;
    if (error !== null) {
      const threshold = Math.max(1, Number(wiz.config.pingFailuresBeforeOffline ?? 3));
      const newlyOffline = recordFailureOnce(error, device.mac, threshold);
      if (newlyOffline) {
        wiz.log.warn(`[${device.mac}] Device is now offline (${threshold} missed pings)`);
        updatePilot(wiz, accessory, device, new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        if (!responded) {
          onError(new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        }
        return;
      }
      if (responded) {
        // HomeKit already got the cached state (or the offline error)
        wiz.log.debug(`[getPilot] No response from ${device.mac}, HomeKit was answered from cache`);
        return;
      }
      // responded=false means no cache existed when the probe started (a
      // probe success would have resolved this same coalesced batch), so
      // there is no cached state to fall back on
      onError(error);
      return;
    }

    const cameBack = recordSuccess(device.mac);
    if (cameBack) {
      wiz.log.info(`[${device.mac}] Device is back online`);
    }

    const normalizedPilot = normalizePilot(pilot, cachedPilot[device.mac]);

    if ((writeGeneration[device.mac] ?? 0) !== generationAtProbeStart) {
      // A write went out while this probe was in flight, so the reply is
      // stale even though it arrived last. Drop it — the next probe reports
      // post-write truth — but recordSuccess above still counted the reply
      // for offline tracking (the device did answer).
      wiz.log.debug(
        `[getPilot] Discarding stale reply from ${device.mac}: a write raced ahead of it`
      );
      if (!responded) {
        // HomeKit is still waiting on this GET — answer with the freshest
        // known state instead of the pre-write reply.
        onSuccess(cachedPilot[device.mac] ?? normalizedPilot);
      }
      return;
    }

    const old = cachedPilot[device.mac];
    if (
      typeof old !== "undefined" &&
      // Some firmware reports "no scene" as a missing sceneId rather than 0;
      // treat both the same, like updatePilot's useCT check does — otherwise
      // every reply from such a bulb reads as an active scene and disables
      // adaptive lighting on every poll.
      ((normalizedPilot.sceneId ?? 0) !== 0 ||
        normalizedPilot.r !== old.r ||
        normalizedPilot.g !== old.g ||
        normalizedPilot.b !== old.b ||
        normalizedPilot.temp !== old.temp)
    ) {
      disabledAdaptiveLightingCallback[device.mac]?.();
    }
    cachedPilot[device.mac] = normalizedPilot;
    if (responded) {
      // HomeKit was answered from cache (or shown "No Response") — push the
      // fresh state so the tile converges on reality. Only changed values go
      // out, except when the device just came back: HomeKit is holding an
      // error state that a value-equality check can't see.
      updatePilot(wiz, accessory, device, normalizedPilot, cameBack);
    } else {
      onSuccess(normalizedPilot);
    }
  };

  _getPilot<Pilot>(wiz, device, handleReply, {
    // Only retransmit when HomeKit is actually blocked on this reply. If the
    // GET was already answered from cache (or with "No Response"), the second
    // copy is invisible to the user and only doubles the load on a device that
    // is already slow to answer.
    retransmit: !responded,
    onTransmit: () => {
      probeStartGeneration[device.mac] = writeGeneration[device.mac] ?? 0;
    },
  });
}

export function setPilot(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device,
  pilot: Partial<Pilot>,
  callback: (error: Error | null) => void
) {
  if (isOffline(device.mac)) {
    callback(new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
    return;
  }
  const oldPilot = cachedPilot[device.mac];
  if (typeof oldPilot == "undefined") {
    callback(new Error(`No cached state for ${device.mac}`));
    return;
  }
  const newPilot = {
    ...oldPilot,
    state: oldPilot.state ?? false,
    dimming: oldPilot.dimming ?? 10,
    ...pilot,
  };
  const isStateOnlyUpdate =
    Object.keys(pilot).length === 1 && typeof pilot.state === "boolean";

  if (pilot.sceneId !== undefined) {
    newPilot.temp = undefined;
    newPilot.r = undefined;
    newPilot.g = undefined;
    newPilot.b = undefined;
  } else if (newPilot.r || newPilot.g || newPilot.b || newPilot.temp) {
    newPilot.sceneId = undefined;
    newPilot.speed = undefined;
  }

  const optimisticPilot = {
    ...oldPilot,
    ...newPilot,
  } as Pilot;
  // Mark in-flight probes stale before the cache commit: their replies
  // predate this write, and a delayed one landing after the ack must not
  // clobber the newer state. Not undone on rollback — a timed-out write may
  // still have reached the bulb, so pre-write replies stay untrustworthy.
  writeGeneration[device.mac] = (writeGeneration[device.mac] ?? 0) + 1;
  cachedPilot[device.mac] = optimisticPilot;
  const outboundPilot =
    wiz.config.lastStatus && isStateOnlyUpdate ? { state: pilot.state } : newPilot;
  return _setPilot(wiz, device, outboundPilot, (error) => {
    // Resolution bump — see writeGeneration. Must happen before the
    // reconciliation probe below so that probe's snapshot includes this
    // write's resolution and its reply is not discarded on our account; a
    // write still queued behind us bumps again when it resolves, which is
    // exactly what invalidates a probe transmitted before it was sent.
    writeGeneration[device.mac] = (writeGeneration[device.mac] ?? 0) + 1;
    // Roll back only while this write still owns the cache entry. A newer
    // queued write (or a fresh getPilot) may have replaced it by the time
    // this write times out — the queued command is still transmitted after
    // the failure and can succeed, so restoring this write's older snapshot
    // would leave the cache behind the confirmed device state.
    if (error !== null && cachedPilot[device.mac] === optimisticPilot) {
      cachedPilot[device.mac] = oldPilot;
    }
    if (error !== null) {
      // A timed-out write may still have reached the bulb (lost ack), so
      // neither the rolled-back snapshot nor the optimistic state is
      // trustworthy now — probe the device so cache and HomeKit converge on
      // truth instead of waiting for the next poll. Coalesces with any probe
      // already in flight.
      getPilot(wiz, accessory, device, () => {}, () => {});
    }
    callback(error);
  });
}

export function pilotToColor(pilot: Pilot | undefined) {
  // Neutral-white fallback when the cache entry is missing — defends
  // updateColorTemp() against a setPilot callback firing after the cache
  // was cleared (regression guard for issue #145).
  if (!pilot) {
    return { hue: 0, saturation: 0, temp: 2700 };
  }
  if (typeof pilot.temp === "number") {
    return {
      ...rgbToHsv(colorTemperature2rgb(Number(pilot.temp))),
      temp: Number(pilot.temp),
    };
  }
  const rgb = clampRgb({
    r: Number(pilot.r) || 0,
    g: Number(pilot.g) || 0,
    b: Number(pilot.b) || 0,
  });
  return { ...rgbToHsv(rgb), temp: rgb2colorTemperature(rgb) };
}

// Need to update hue, saturation, and temp when ANY of these change
export function updateColorTemp(
  device: Device,
  accessory: PlatformAccessory,
  wiz: HomebridgeWizLan,
  next: (error: Error | null) => void
) {
  const { Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  return (error: Error | null) => {
    if (isTW(device) || isRGB(device)) {
      if (error === null) {
        const color = pilotToColor(cachedPilot[device.mac]);
        service
          .getCharacteristic(wiz.Characteristic.ColorTemperature)
          .updateValue(kelvinToMired(color.temp));
        if (isRGB(device)) {
          service
            .getCharacteristic(wiz.Characteristic.Saturation)
            .updateValue(color.saturation);
          service
            .getCharacteristic(wiz.Characteristic.Hue)
            .updateValue(color.hue);
        }
      }
    }
    next(error);
  };
}
