import { WizAccessory } from "..";
import { Device } from "../../types";
import { getPilot, Pilot } from "./pilot";
import {
  initOnOff,
  initDimming,
  initTemperature,
  initColor,
} from "./characteristics";
import { initAdaptiveLighting } from "./AdaptiveLighting";
import { isRGB, isTW } from "./util";
import { initScenes } from "./characteristics/scenes";

class WizBulb extends WizAccessory<Pilot> {
  static is = (device: Device) =>
    ["SHRGB", "SHDW", "SHTW"].some((id) => device.model.includes(id));
  static getName = ({ model }: Device) => {
    if (model.includes("SHRGB")) {
      return "RGB Bulb";
    } else if (model.includes("SHDW")) {
      return "Dimmer Bulb";
    } else if (model.includes("SHTW")) {
      return "Tunable White Bulb";
    }
    return "Unknown Bulb";
  };
  init = () => {
    const { wiz, accessory, device } = this;
    const { Characteristic, Service } = wiz;

    // Setup the lightbulb service
    let service = accessory.getService(Service.Lightbulb);
    if (typeof service === "undefined") {
      service = new Service.Lightbulb(accessory.displayName);
      accessory.addService(service);
    }

    // All bulbs support on/off + dimming
    initOnOff(accessory, device, wiz);
    initDimming(accessory, device, wiz);

    // Those with these SHRGB/SHTW have color temp
    if (isRGB(device) || isTW(device)) {
      initTemperature(accessory, device, wiz);
      initAdaptiveLighting(wiz, service, accessory, device);
    } else {
      const charcteristic = service.getCharacteristic(
        Characteristic.ColorTemperature
      );
      if (typeof charcteristic !== "undefined") {
        service.removeCharacteristic(charcteristic);
      }
    }

    // Those with SHRGB have RGB color!
    if (isRGB(device)) {
      initColor(accessory, device, wiz);
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

    initScenes(wiz, accessory, device);
  };
  getPilot = () => {
    return new Promise<Pilot>((resolve, reject) => {
      getPilot(this.wiz, this.accessory, this.device, resolve, reject);
    });
  };
}

export default WizBulb;
