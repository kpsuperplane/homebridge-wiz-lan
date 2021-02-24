import {  PlatformAccessory } from "homebridge";
import { WizAccessory } from "..";
import HomebridgeWizLan from "../../wiz";
import { Device } from "../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../util/network";
import {
  initOnOff,
  initDimming,
  initTemperature,
  initColor,
} from "./characteristics";

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
    const { Characteristic, Service } = wiz;
    let service = accessory.getService(Service.Lightbulb);
    if (typeof service === "undefined") {
      service = new Service.Lightbulb(accessory.displayName);
      accessory.addService(service);
    }
    initOnOff(service, device, wiz);
    initDimming(service, device, wiz);
    if (device.model.includes("SHTW") || device.model.includes("SHRGB")) {
      initTemperature(service, device, wiz);
    }else {
      const charcteristic = service.getCharacteristic(Characteristic.ColorTemperature);
      if (typeof charcteristic !== "undefined") {
        service.removeCharacteristic(charcteristic);
      }
    }
    if (device.model.includes("SHRGB")) {
      initColor(service, device, wiz);
    } else {
      const hue = service.getCharacteristic(Characteristic.Hue);
      if (typeof hue !== "undefined") {
        service.removeCharacteristic(hue);
      }
      const saturation = service.getCharacteristic(Characteristic.Saturation);
      if (typeof saturation !== "undefined") {
        service.removeCharacteristic(saturation);
      }
    }
  },
};

export default WizBulb;
