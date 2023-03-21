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
  // do the reverse of the below
  // 10% <-> 100% --> 1% <-> 100% 
  return Math.floor(Number(pilot.dimming) * 1.1) - 10;
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
          // for some reason < 10% is invalid, so we gotta fit 0% <-> 100% it into 10% <-> 100%
          // 0%, 1% -> 10% since that's the minimum acceptable value
          { dimming: Math.floor(Number(newValue) * 0.9) + 10 },
          next
        );
      }
    );
}
