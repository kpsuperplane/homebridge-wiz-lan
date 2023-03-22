import { Device } from "../../types";
import { Characteristic, Service, WithUUID } from "homebridge";

export function isRGB(device: Device) {
  return device.model.includes("RGB");
}
export function isTW(device: Device) {
  return device.model.includes("SHTW");
}

export function turnOffIfNeeded(
  characteristic: WithUUID<{
    new (): Characteristic;
  }>,
  service: Service,
  useSetValue = false
) {
  const ch = service.getCharacteristic(characteristic);
  if (ch?.value !== 0) {
    useSetValue ? ch.setValue(0) : ch.updateValue(0);
  }
}
