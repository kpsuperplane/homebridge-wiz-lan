import { PlatformAccessory, Service as WizService } from "homebridge";

import HomebridgeWizLan from "../../wiz";
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

export interface Pilot {
  mac: string;
  rssi: number;
  src: string;
  state: boolean;
  sceneId: number;
  temp?: number;
  dimming: number;
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

// Write a custom getPilot/setPilot that takes this
// caching into account
export function getPilot(
  wiz: HomebridgeWizLan,
  device: Device,
  callback: (pilot: Pilot) => void
) {
  return _getPilot<Pilot>(wiz, device, (pilot) => {
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
    cachedPilot[device.mac] = pilot;
    callback(pilot);
  });
}
export function setPilot(
  wiz: HomebridgeWizLan,
  device: Device,
  pilot: Partial<Pilot>,
  callback: (error: Error | null) => void
) {
  const oldPilot = cachedPilot[device.mac];
  const oldPilotValues = {
    state: oldPilot.state ?? false,
    dimming: oldPilot.dimming ?? 10,
    temp: oldPilot.temp,
    r: oldPilot.r,
    g: oldPilot.g,
    b: oldPilot.b,
  };
  const newPilot = {
    ...oldPilotValues,
    ...pilot,
  };
  cachedPilot[device.mac] = { ...oldPilot, ...newPilot };
  return _setPilot(wiz, device, newPilot, (error) => {
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
  service: WizService,
  wiz: HomebridgeWizLan,
  next: (error: Error | null) => void
) {
  return (error: Error | null) => {
    if (isTW(device)) {
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
