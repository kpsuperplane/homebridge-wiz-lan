import {
  CharacteristicSetCallback,
  CharacteristicValue,
  Service as WizService,
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
function initHue(service: WizService, device: Device, wiz: HomebridgeWizLan) {
  const { Characteristic } = wiz;
  service
    .getCharacteristic(Characteristic.Hue)
    .on("get", (callback) =>
      getPilot(
        wiz,
        service,
        device,
        (pilot) => callback(null, transformHue(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(
          wiz,
          device,
          {
            temp: undefined,
            ...hsvToColor(
              Number(newValue) / 360,
              pilotToColor(cachedPilot[device.mac]).saturation / 100,
              wiz
            ),
          },
          updateColorTemp(device, service, wiz, next)
        );
      }
    );
}

export function transformSaturation(pilot: Pilot) {
  return pilotToColor(pilot).saturation;
}
function initSaturation(
  service: WizService,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic } = wiz;
  service
    .getCharacteristic(Characteristic.Saturation)
    .on("get", (callback) =>
      getPilot(
        wiz,
        service,
        device,
        (pilot) => callback(null, transformSaturation(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(
          wiz,
          device,
          {
            temp: undefined,
            ...hsvToColor(
              pilotToColor(cachedPilot[device.mac]).hue / 360,
              Number(newValue) / 100,
              wiz
            ),
          },
          updateColorTemp(device, service, wiz, next)
        );
      }
    );
}

export function initColor(
  service: WizService,
  device: Device,
  wiz: HomebridgeWizLan
) {
  initHue(service, device, wiz);
  initSaturation(service, device, wiz);
}
