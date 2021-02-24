import {
  PlatformAccessory,
} from "homebridge";
import { WizAccessory } from "..";
import HomebridgeWizLan from "../../wiz";
import { Device } from "../../types";
import { getPilot as _getPilot, setPilot as _setPilot } from "../../util/network";
import { initOnOff, initDimming, initTemperature, initColor } from "./characteristics";

const WizBulb: WizAccessory = {
  is: (device: Device) =>
    ["SHRGB", "SHDW", "SHTW"].some((id) => device.model.includes(id)),
  getName: ({ model }: Device) => {
    if (model.includes("SHRGB")) {
      return "RGB Bulb";
    } else if (model.includes("SHDW")) {
      return "Dimmer Bulb";
    } else if (model.includes("SHTW")) {
      return "Tunable White Bulb";
    }
    return "Unknown Bulb";
  },
  init: (
    accessory: PlatformAccessory,
    device: Device,
    wiz: HomebridgeWizLan
  ) => {
    const { Service } = wiz;
    let service = accessory.getService(Service.Lightbulb);
    if (typeof service === "undefined") {
      service = new Service.Lightbulb(accessory.displayName);
      accessory.addService(service);
    }
    initOnOff(service, device, wiz);
    initDimming(service, device, wiz);
    initTemperature(service, device, wiz);
    initColor(service, device, wiz);
  },
};

export default WizBulb;
