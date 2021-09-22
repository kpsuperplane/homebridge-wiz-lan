import {
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
} from "homebridge";
import HomebridgeWizLan from "../../../wiz";
import { Device } from "../../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../../util/network";
import { hsvToColor } from "../../../util/color";
import {
  cachedPilot,
  getPilot,
  Pilot,
  pilotToColor,
  setPilot,
  updateColorTemp,
} from "../pilot";

export function transformHue(pilot: Pilot) {
  return pilotToColor(pilot).hue;
}
function initHue(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic, Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  const scenesService = new Service.Television("Scenes");
  service
    .getCharacteristic(Characteristic.Hue)
    .on("get", callback =>
      getPilot(
        wiz,
        accessory,
        device,
        pilot => callback(null, transformHue(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(
          wiz,
          accessory,
          device,
          {
            temp: undefined,
            ...hsvToColor(
              Number(newValue) / 360,
              pilotToColor(cachedPilot[device.mac]).saturation / 100,
              wiz
            ),
          },
          updateColorTemp(device, accessory, wiz, next)
        );
      }
    );
}

export function transformSaturation(pilot: Pilot) {
  return pilotToColor(pilot).saturation;
}
function initSaturation(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic, Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  service
    .getCharacteristic(Characteristic.Saturation)
    .on("get", (callback) =>
      getPilot(
        wiz,
        accessory,
        device,
        pilot => callback(null, transformSaturation(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(
          wiz,
          accessory,
          device,
          {
            temp: undefined,
            ...hsvToColor(
              pilotToColor(cachedPilot[device.mac]).hue / 360,
              Number(newValue) / 100,
              wiz
            ),
          },
          updateColorTemp(device, accessory, wiz, next)
        );
      }
    );
}

export function initColor(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  initHue(accessory, device, wiz);
  initSaturation(accessory, device, wiz);
}
