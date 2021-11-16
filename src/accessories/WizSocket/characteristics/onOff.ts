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
import { getPilot, Pilot, setPilot } from "../pilot";

export function transformOnOff(pilot: Pilot) {
  return Number(pilot.state);
}
export function initOnOff(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic, Service } = wiz;
  const service = accessory.getService(Service.Outlet)!;
  service
    .getCharacteristic(Characteristic.On)
    .on("get", callback =>
      getPilot(
        wiz,
        accessory,
        device,
        pilot => callback(null, transformOnOff(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        setPilot(wiz, accessory, device, { state: Boolean(newValue) }, next);
      }
    );
}
