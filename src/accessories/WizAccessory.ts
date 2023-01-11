import { PlatformAccessory } from "homebridge";
import { Device } from "../types";
import HomebridgeWizLan from "../wiz";
export interface WizPilot {}
export abstract class WizAccessory<TPilot extends WizPilot> {
  static is: (device: Device) => boolean;
  static getName: (device: Device) => string;
  constructor(
    protected accessory: PlatformAccessory,
    protected device: Device,
    protected wiz: HomebridgeWizLan
  ) {}
  abstract init(): void;
  abstract getPilot(): Promise<TPilot>;
}
