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
import { getPilot, Pilot, setPilot } from "../pilot";

export function transformDimming(pilot: Pilot) {
  return Number(Math.floor((Math.max(10, Number(pilot.dimming)+.001) - 100) * 1.1 + 100));
}
export function initDimming(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic, Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
  service
    .getCharacteristic(Characteristic.Brightness)
    .on("get", (callback) =>
      getPilot(
        wiz,
        accessory,
        device,
        (pilot) => callback(null, transformDimming(pilot)),
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
          // for some reason < 10% is invalid, so we gotta fit it into 10% <-> 100%
          { dimming: Math.round((Math.max(1, Number(newValue)) + 10) / 1.1) },
          next
        );
      }
    );
}
