import { Device } from "../../types";

export function isRGB(device: Device) {
  return device.model.includes("SHRGB");
}
export function isTW(device: Device) {
  return device.model.includes("SHTW");
}
