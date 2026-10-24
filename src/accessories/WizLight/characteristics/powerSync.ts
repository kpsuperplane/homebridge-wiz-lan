import { Characteristic, PlatformAccessory } from "homebridge";
import HomebridgeWizLan from "../../../wiz";

export type PowerSource = "lightbulb" | "television";

function updateIfDifferent(
  characteristic: Characteristic,
  value: boolean | number,
  asNumber: boolean,
) {
  const current = characteristic.value;
  if (
    !(current instanceof Error) &&
    current !== null &&
    current !== undefined &&
    (asNumber ? Number(current) === Number(value) : Boolean(current) === Boolean(value))
  ) {
    return;
  }
  characteristic.updateValue(value);
}

/**
 * Keep the two HomeKit power controls aligned while a write or read is in
 * flight. `updatePilot` remains the source of truth after a device reply;
 * this helper only mirrors the counterpart of the active handler, and skips
 * unchanged values so a GET cannot create a notification/read feedback loop.
 */
export function syncPowerState(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  value: boolean,
  source: PowerSource,
) {
  if (source !== "lightbulb") {
    const lightbulbService = accessory.getService(wiz.Service.Lightbulb);
    if (lightbulbService != null) {
      updateIfDifferent(
        lightbulbService.getCharacteristic(wiz.Characteristic.On),
        value,
        false,
      );
    }
  }

  if (source !== "television") {
    const scenesService = accessory.getService(wiz.Service.Television);
    if (scenesService != null) {
      updateIfDifferent(
        scenesService.getCharacteristic(wiz.Characteristic.Active),
        value ? 1 : 0,
        true,
      );
    }
  }
}
