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

export function initOnOff(
  service: WizService,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic } = wiz;
  service
    .getCharacteristic(Characteristic.On)
    .on("get", (callback) =>
      getPilot(
        wiz,
        device,
        (pilot) => callback(null, Number(pilot.state)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(wiz, device, { state: Boolean(newValue) }, next);
      }
    );
}
