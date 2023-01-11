import { WizAccessory } from "..";
import { Device } from "../../types";
import { getPilot, Pilot } from "./pilot";
import { initOnOff } from "./characteristics";

class WizSocket extends WizAccessory<Pilot> {
  static is = (device: Device) =>
    ["ESP10_SOCKET_06", "ESP25_SOCKET_01"].some((id) =>
      device.model.includes(id)
    );
  static getName = (_: Device) => {
    return "Wiz Socket";
  };
  init = () => {
    const { wiz, accessory, device } = this;
    const { Service } = wiz;

    // Setup the outlet service
    let service = accessory.getService(Service.Outlet);
    if (typeof service === "undefined") {
      service = new Service.Outlet(accessory.displayName);
      accessory.addService(service);
    }

    // All bulbs support on/off + dimming
    initOnOff(accessory, device, wiz);
  };
  getPilot = () => {
    return new Promise<Pilot>((resolve, reject) => {
      getPilot(this.wiz, this.accessory, this.device, resolve, reject);
    });
  };
}

export default WizSocket;
