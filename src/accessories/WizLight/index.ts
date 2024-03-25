import { WizAccessory } from "..";
import { Device } from "../../types";
import { initAdaptiveLighting } from "./AdaptiveLighting";
import {
  initColor, initDimming, initOnOff, initTemperature
} from "./characteristics";
import { initScenes } from "./characteristics/scenes";
import { getPilot, Pilot } from "./pilot";
import { isRGB, isTW } from "./util";

class WizLight extends WizAccessory<Pilot> {
  static is = (device: Device) => {
    return ["SHRGB", "SHDW", "SHTW"].some((id) => device.model.includes(id)) // Bulbs
    || device.model.startsWith("ESP2"); // Light Pole

  }
  static getName = ({ model }: Device): string => {
    if (model.includes("SHRGB")) {
      return "RGB Bulb";
    } else if (model.includes("SHDW")) {
      return "Dimmer Bulb";
    } else if (model.includes("SHTW")) {
      return "Tunable White Bulb";
    } else if (model.includes("DHRGB")) {
      return "Light Pole"
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

export default WizLight;
