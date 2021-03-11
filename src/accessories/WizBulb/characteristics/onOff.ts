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
import { getPilot, Pilot, setPilot } from "../pilot";

export function transformOnOff(pilot: Pilot) {
  return Number(pilot.state);
}
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
        service,
        device,
        (pilot) => callback(null, transformOnOff(pilot)),
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
