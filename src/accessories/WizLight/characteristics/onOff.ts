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
import { cachedPilot, getPilot, Pilot, setPilot } from "../pilot";

export function transformOnOff(pilot: Pilot) {
  return Number(pilot.state);
}
export function initOnOff(
  accessory: PlatformAccessory,
  device: Device,
  wiz: HomebridgeWizLan
) {
  const { Characteristic, Service } = wiz;
  const service = accessory.getService(Service.Lightbulb)!;
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
        const state = Boolean(newValue);
        const cachedDimming = cachedPilot[device.mac]?.dimming;
        const hasUsableDimming =
          typeof cachedDimming === "number" &&
          Number.isFinite(cachedDimming) &&
          cachedDimming >= 10;
        const needsUsableBrightness =
          state &&
          !wiz.config.lastStatus &&
          !hasUsableDimming;
        setPilot(
          wiz,
          accessory,
          device,
          needsUsableBrightness ? { state: true, dimming: 100 } : { state },
          next
        );
      }
    );
}
