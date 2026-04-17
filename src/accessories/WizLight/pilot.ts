import { PlatformAccessory } from "homebridge";

import HomebridgeWizLan from "../../wiz";
import { Device } from "../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../util/network";
import { isOffline, recordHit, recordMiss } from "../../util/reachability";
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

export const disabledAdaptiveLightingCallback: {
  [mac: string]: () => void;
} = {};

function updatePilot(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device,
  pilot: Pilot | Error
) {
  const { Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;

  service
    .getCharacteristic(wiz.Characteristic.On)
    .updateValue(pilot instanceof Error ? pilot : transformOnOff(pilot));
  service
    .getCharacteristic(wiz.Characteristic.Brightness)
    .updateValue(pilot instanceof Error ? pilot : transformDimming(pilot));
  if (isTW(device) || isRGB(device)) {
    let useCT = true;
    if (!(pilot instanceof Error) && pilot.sceneId && pilot.sceneId > 0) {
      useCT = false;
    }
    if (useCT) {
      service
        .getCharacteristic(wiz.Characteristic.ColorTemperature)
        .updateValue(
          pilot instanceof Error ? pilot : transformTemperature(pilot)
        );
    }
  }
  if (isRGB(device)) {
    service
      .getCharacteristic(wiz.Characteristic.Hue)
      .updateValue(pilot instanceof Error ? pilot : transformHue(pilot));
    service
      .getCharacteristic(wiz.Characteristic.Saturation)
      .updateValue(pilot instanceof Error ? pilot : transformSaturation(pilot));
  }

  const scenesService = accessory.getService(Service.Television);

  if (scenesService != null) {
    scenesService
      .getCharacteristic(wiz.Characteristic.Active)
      .updateValue(
        pilot instanceof Error ? pilot : transformOnOff(pilot)
      );
    scenesService!
      .getCharacteristic(wiz.Characteristic.ActiveIdentifier)
      .updateValue(pilot instanceof Error ? pilot : transformEffectId(pilot));
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
  const { Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  let callbacked = false;
  const onDone = (error: Error | null, pilot: Pilot) => {
    const shouldCallback = !callbacked;
    callbacked = true;
    if (error !== null) {
      if (shouldCallback) {
        onError(error);
      } else {
        service.getCharacteristic(wiz.Characteristic.On).updateValue(error);
      }
      delete cachedPilot[device.mac];
      return;
    }

    recordHit(device.mac);

    const old = cachedPilot[device.mac];
    if (
      typeof old !== "undefined" &&
      (pilot.sceneId !== 0 ||
        pilot.r !== old.r ||
        pilot.g !== old.g ||
        pilot.b !== old.b ||
        pilot.temp !== old.temp)
    ) {
      disabledAdaptiveLightingCallback[device.mac]?.();
    }
    // Filter out `undefined` fields from the device reply before merging —
    // some scenes (e.g. sceneId 14 nightlight) omit `dimming` entirely, and
    // a naked spread would clobber the default below with `undefined`,
    // producing NaN brightness in HomeKit (issues #96/#101/#143/#159).
    const pilotDefined = Object.fromEntries(
      Object.entries(pilot).filter(([, v]) => v !== undefined),
    ) as Partial<Pilot>;
    cachedPilot[device.mac] = {
      // if no dimming info provided, use the last known on/off state
      dimming: (pilot.state ?? old?.state) ? 100 : 10,
      ...pilotDefined,
    } as Pilot;
    if (shouldCallback) {
      onSuccess(pilot);
    } else {
      updatePilot(wiz, accessory, device, pilot);
    }
  };
  const timeout = setTimeout(() => {
    const misses = recordMiss(device.mac);
    const threshold = Math.max(1, Number(wiz.config.offlineThreshold ?? 3));
    const reportOffline = wiz.config.reportOffline === true;
    if (reportOffline && isOffline(device.mac, threshold)) {
      // Surface the bulb as unreachable so HomeKit shows "Not Responding".
      // Dropping the cache entry forces the next get to re-attempt fresh.
      delete cachedPilot[device.mac];
      onDone(
        new Error(
          `Device ${device.mac} unreachable (${misses} consecutive misses)`,
        ),
        undefined as any,
      );
    } else if (device.mac in cachedPilot) {
      // Legacy behaviour: replay the cached state. Preserves backward
      // compatibility when `reportOffline` is left at its default (off).
      onDone(null, cachedPilot[device.mac]);
    } else {
      onDone(new Error("No response within 1s"), undefined as any);
    }
  }, 1000);
  _getPilot<Pilot>(wiz, device, (error, pilot) => {
    clearTimeout(timeout);
    onDone(error, pilot);
  });
}

export function setPilot(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device,
  pilot: Partial<Pilot>,
  callback: (error: Error | null) => void
) {
  const oldPilot = cachedPilot[device.mac];
  if (typeof oldPilot == "undefined") {
    return;
  }
  const newPilot = {
    ...oldPilot,
    state: oldPilot.state ?? false,
    dimming: oldPilot.dimming ?? 10,
    ...pilot,
  };

  if (pilot.sceneId !== undefined) {
    newPilot.temp = undefined;
    newPilot.r = undefined;
    newPilot.g = undefined;
    newPilot.b = undefined;
  } else if (newPilot.r || newPilot.g || newPilot.b || newPilot.temp) {
    newPilot.sceneId = undefined;
    newPilot.speed = undefined;
  }

  cachedPilot[device.mac] = {
    ...oldPilot,
    ...newPilot,
  } as any;
  return _setPilot(wiz, device, newPilot, (error) => {
    if (error !== null) {
      cachedPilot[device.mac] = oldPilot;
    }
    callback(error);
  });
}

export function pilotToColor(pilot: Pilot | undefined) {
  // Neutral-white fallback for callers that pass in an empty cache entry —
  // e.g. updateColorTemp() / color set handlers invoked after a getPilot
  // timeout wiped `cachedPilot[mac]`. Avoids the "Cannot read properties of
  // undefined (reading 'temp')" crash (issue #145).
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
