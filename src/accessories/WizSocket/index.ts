import { PlatformAccessory } from "homebridge";
import { WizAccessory } from "..";
import HomebridgeWizLan from "../../wiz";
import { Device } from "../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../util/network";
import {
  initOnOff,
} from "./characteristics";

const WizSocket: WizAccessory = {
  is: (device: Device) =>
    ["ESP10_SOCKET_06"].some((id) => device.model.includes(id)),
  getName: (_: Device) => {
    return "Wiz Socket";
  },
  init: (
    accessory: PlatformAccessory,
    device: Device,
    wiz: HomebridgeWizLan
  ) => {
    const { Service } = wiz;

    // Setup the outlet service
    let service = accessory.getService(Service.Outlet);
    if (typeof service === "undefined") {
      service = new Service.Outlet(accessory.displayName);
      accessory.addService(service);
    }

    // All bulbs support on/off + dimming
    initOnOff(accessory, device, wiz);
  },
};

export default WizSocket;
