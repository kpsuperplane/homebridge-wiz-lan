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
import { getPilot, pilotToColor, setPilot, updateColorTemp } from "../pilot";

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
        device,
        (pilot) => callback(null, kelvinToMired(pilotToColor(pilot).temp)),
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
