import { PlatformAccessory } from "homebridge";

import HomebridgeWizLan from "../../wiz";
import { isOffline, recordFailure, recordSuccess } from "../../util/offline";
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

export const disabledAdaptiveLightingCallback: {
  [mac: string]: () => void;
} = {};

export function updatePilot(
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
  const deviceIsOffline = isOffline(device.mac);

  if (deviceIsOffline) {
    // Respond immediately so HomeKit doesn't wait for the UDP timeout
    onError(new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
    // Fall through to still probe the device so recovery is detected
  }

  _getPilot<Pilot>(wiz, device, (error, pilot) => {
    if (error !== null) {
      const threshold = wiz.config.pingFailuresBeforeOffline ?? 3;
      const newlyOffline = recordFailure(device.mac, threshold);
      if (newlyOffline) {
        wiz.log.warn(`[${device.mac}] Device is now offline (${threshold} missed pings)`);
        updatePilot(wiz, accessory, device, new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        if (!deviceIsOffline) {
          onError(new wiz.api.hap.HapStatusError(wiz.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE));
        }
        return;
      }
      if (deviceIsOffline) {
        // Still offline — already responded above, nothing else to do
        return;
      }
      const cached = cachedPilot[device.mac];
      if (cached) {
        wiz.log.warn(`[getPilot] No response from ${device.mac} within 1s, using cached state`);
        onSuccess(cached);
      } else {
        onError(error);
      }
      return;
    }

    const cameBack = recordSuccess(device.mac);
    if (cameBack) {
      wiz.log.info(`[${device.mac}] Device is back online`);
    }

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
    cachedPilot[device.mac] = {
      dimming: (pilot.state ?? old?.state) ? 100 : 10,
      ...pilot
    };
    if (cameBack) {
      // Push fresh state to HomeKit so "No Response" clears immediately
      updatePilot(wiz, accessory, device, pilot);
    }
    if (!deviceIsOffline) {
      onSuccess(pilot);
    }
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

  cachedPilot[device.mac] = {
    ...oldPilot,
    ...newPilot,
  } as any;
  const outboundPilot =
    wiz.config.lastStatus && isStateOnlyUpdate ? { state: pilot.state } : newPilot;
  return _setPilot(wiz, device, outboundPilot, (error) => {
    if (error !== null) {
      cachedPilot[device.mac] = oldPilot;
    }
    callback(error);
  });
}

export function pilotToColor(pilot: Pilot) {
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
