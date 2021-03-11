import {
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service as WizService,
} from "homebridge";
import HomebridgeWizLan from "../../../wiz";
import { Device } from "../../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../../util/network";
import { kelvinToMired, miredToKelvin } from "../../../util/color";
import { getPilot, Pilot, pilotToColor, setPilot, updateColorTemp } from "../pilot";

export function transformTemperature(pilot: Pilot) {
  return kelvinToMired(pilotToColor(pilot).temp);
}
export function initTemperature(
  service: WizService,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic } = wiz;
  service
    .getCharacteristic(Characteristic.ColorTemperature)
    .on("get", (callback) =>
      getPilot(
        wiz,
        service,
        device,
        (pilot) => callback(null, transformTemperature(pilot)),
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
            temp: miredToKelvin(Number(newValue)),
            r: undefined,
            g: undefined,
            b: undefined,
          },
          updateColorTemp(device, service, wiz, next)
        );
      }
    );
}
