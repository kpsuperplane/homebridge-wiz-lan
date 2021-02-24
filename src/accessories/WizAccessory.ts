import { PlatformAccessory } from "homebridge";
import { Device } from "../types";
import HomebridgeWizLan from "../wiz";

export interface WizAccessory {
  is: (device: Device) => boolean;
  getName: (device: Device) => string;
  init: (accessory: PlatformAccessory, device: Device, wiz: HomebridgeWizLan) => void;
}
