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
import { getPilot, setPilot } from "../pilot";

export function initDimming(
  service: WizService,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic } = wiz;
  service
    .getCharacteristic(Characteristic.Brightness)
    .on("get", (callback) =>
      getPilot(wiz, device, (pilot) => callback(null, Number(pilot.dimming)))
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(
          wiz,
          device,
          { dimming: Math.round((Math.max(1, Number(newValue)) + 10) / 1.1) },
          next
        );
      }
    );
}
