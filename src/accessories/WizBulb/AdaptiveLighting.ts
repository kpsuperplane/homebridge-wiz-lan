import { PlatformAccessory, Service } from "homebridge";
import { Device } from "../../types";
import { makeLogger } from "../../util/logger";
import HomebridgeWizLan from "../../wiz";
import { disabledAdaptiveLightingCallback, getPilot } from "./pilot";

export function initAdaptiveLighting(
  wiz: HomebridgeWizLan,
  service: Service,
  accessory: PlatformAccessory,
  device: Device
) {
  const log = makeLogger(wiz, "Adaptive Lighting");

  log.debug(`Initializing adaptive lighting for ${device.mac}`);
  const controller = new wiz.api.hap.AdaptiveLightingController(service, {
    controllerMode: wiz.api.hap.AdaptiveLightingControllerMode.AUTOMATIC,
  });
  accessory.configureController(controller as any);
  disabledAdaptiveLightingCallback[device.mac] = () => {
    if (controller.isAdaptiveLightingActive()) {
      log.debug(`Disabling adaptive lighting for ${device.mac}`);
      controller.disableAdaptiveLighting();
    }
  };

  // we want to check if we should disable adaptive lighting due to an external change
  // every time before it updates
  let timeout: NodeJS.Timeout | null = null;
  const temperature = service.getCharacteristic(
    wiz.Characteristic.ColorTemperature
  );

  const checkIfDisableAdaptiveLighting = () => {
    log.debug(
      `Checking if ${device.mac} changed before adaptive lighting update`
    );
    // get pilot will disable for us :)
    getPilot(
      wiz,
      device,
      () => {},
      () => {}
    );
  };

  temperature.on("set", () => {
    if (controller.isAdaptiveLightingActive()) {
      if (timeout !== null) clearTimeout(timeout);
      // try to check if we should disable adaptive lighting 2s before the next update
      const wait = controller.getAdaptiveLightingUpdateInterval() - 2000;
      timeout = setTimeout(checkIfDisableAdaptiveLighting, wait);

      log.debug(
        `Detected temperature update for ${device.mac}, checking adaptive lighting eligibilty in ${wait}ms`
      );
    }
  });
  controller.on("disable", () => {
    if (timeout !== null) clearTimeout(timeout);
  });
}
