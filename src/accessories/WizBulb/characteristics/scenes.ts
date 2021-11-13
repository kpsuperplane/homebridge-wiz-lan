import {
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service as WizService,
} from "homebridge";
import HomebridgeWizLan from "../../../wiz";
import { Device } from "../../../types";
import {
  getPilot as _getPilot,
  setPilot as _setPilot,
} from "../../../util/network";
import { getPilot, setPilot } from "../pilot";
import { Pilot } from "../pilot";
import { isRGB, isTW } from "../util";
import { transformOnOff } from ".";

const SCENES = [
  ["No Scene", ["RGB", "DW", "TW"]], //0
  ["Ocean", ["RGB"]], // 1
  ["Romance", ["RGB"]], // 2
  ["Sunset", ["RGB"]], // 3
  ["Party", ["RGB"]], // 4
  ["Fireplace", ["RGB"]], // 5
  ["Cozy", ["RGB", "TW"]], // 6
  ["Forest", ["RGB"]], // 7
  ["Pastel Colors", ["RGB"]], // 8
  ["Wake up", ["RGB", "DW", "TW"]], // 9
  ["Bedtime", ["RGB", "DW", "TW"]], // 10
  ["Warm White", ["RGB", "TW"]], // 11
  ["Daylight", ["RGB", "TW"]], // 12
  ["Cool white", ["RGB", "DW", "TW"]], // 13
  ["Night light", ["RGB", "DW", "TW"]], // 14
  ["Focus", ["RGB", "TW"]], // 15
  ["Relax", ["RGB", "TW"]], // 16
  ["True colors", ["RGB"]], // 17
  ["TV time", ["RGB", "TW"]], // 18
  ["Plantgrowth", ["RGB"]], // 19
  ["Spring", ["RGB"]], // 20
  ["Summer", ["RGB"]], // 21
  ["Fall", ["RGB"]], // 22
  ["Deepdive", ["RGB"]], // 23
  ["Jungle", ["RGB"]], // 24
  ["Mojito", ["RGB"]], // 25
  ["Club", ["RGB"]], // 26
  ["Christmas", ["RGB"]], // 27
  ["Halloween", ["RGB"]], // 28
  ["Candlelight", ["RGB", "DW", "TW"]], // 29
  ["Golden white", ["RGB", "DW", "TW"]], // 30
  ["Pulse", ["RGB", "DW", "TW"]], // 31
  ["Steampunk", ["RGB", "DW", "TW"]], // 32
];

function getScenes(type: string) {
  return SCENES.map((scene, idx) => ({ idx, scene }))
    .filter((item) => item.scene[1].includes(type))
    .map((item) => item.idx);
}

/**
 * Returns supported scenes for device. Based on https://bit.ly/3hLImPa.
 * @param device
 * @return array of ids of scenes supported by the particular light type
 */
function supportedScenesIdsForDevice(device: Device) {
  if (isTW(device)) return getScenes("TW");
  else if (isRGB(device)) return getScenes("RGB");
  return getScenes("DW");
}

export function transformEffectId(pilot: Pilot): number {
  return pilot.sceneId ?? 0;
}

export function initScenes(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device
) {
  const { Characteristic, Service, config } = wiz;

  let scenesService = accessory.getService(Service.Television);
  const lightbulbService = accessory.getService(Service.Lightbulb)!;

  if (config.enableScenes !== true) {
    if (scenesService != null) {
      accessory.removeService(scenesService);
    }
    accessory.services
      .filter((service) => service.subtype != null)
      .forEach(service => accessory.removeService(service));
    return;
  }

  if (scenesService == null) {
    scenesService = new Service.Television(accessory.displayName);
    accessory.addService(scenesService);
  }

  scenesService
    .getCharacteristic(Characteristic.ActiveIdentifier)
    .on("get", (callback) =>
      getPilot(
        wiz,
        accessory,
        device,
        (pilot) => callback(null, transformEffectId(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        const sceneId = Number(newValue);
        if (sceneId === 0) {
          // set to white if no scene
          setPilot(wiz, accessory, device, { temp: 3000 }, next);
        } else {
          setPilot(wiz, accessory, device, { sceneId }, next);
          if (sceneId !== 0) device.lastSelectedSceneId = sceneId;
        }
      }
    );

  scenesService
    .getCharacteristic(Characteristic.Active)
    .on("get", (callback) =>
      getPilot(
        wiz,
        accessory,
        device,
        (pilot) => callback(null, transformOnOff(pilot)),
        callback
      )
    )
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        const value = Boolean(newValue);
        lightbulbService
          .getCharacteristic(Characteristic.On)
          .updateValue(value);
        setPilot(wiz, accessory, device, { state: value }, next);
      }
    );

  lightbulbService
    .getCharacteristic(Characteristic.Active)
    .on(
      "set",
      (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
        const value = Boolean(newValue);
        scenesService!
          .getCharacteristic(Characteristic.Active)
          .updateValue(value);
        next();
      }
    );

  const turnOff = (
    _: CharacteristicValue,
    _next: CharacteristicSetCallback
  ) => {
    scenesService!
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .updateValue(0);
  };
  lightbulbService
    .getCharacteristic(Characteristic.Saturation)
    .on("set", turnOff);
  lightbulbService.getCharacteristic(Characteristic.Hue).on("set", turnOff);
  lightbulbService
    .getCharacteristic(Characteristic.ColorTemperature)
    .on("set", turnOff);

  const configureInputSource = (sceneId: number, service: WizService) => {
    const sceneName = SCENES[sceneId][0];
    service
      .setCharacteristic(Characteristic.Identifier, sceneId)
      .setCharacteristic(Characteristic.ConfiguredName, sceneName)
      .setCharacteristic(
        Characteristic.IsConfigured,
        Characteristic.IsConfigured.CONFIGURED
      )
      .setCharacteristic(
        Characteristic.InputSourceType,
        Characteristic.InputSourceType.HDMI
      );
    scenesService!.addLinkedService(service);
  };

  const supportedSceneIds = supportedScenesIdsForDevice(device);
  // remove any scenes that should not exist
  const existingSceneIds = accessory.services
    .filter((service) => service.subtype != null)
    .map((service) => {
      const id = Number(
        service.getCharacteristic(Characteristic.Identifier).value as number
      );
      if (supportedSceneIds.includes(id)) {
        configureInputSource(id, service);
        return id;
      } else {
        accessory.removeService(service);
      }
      return null;
    });

  const missingSceneIds = supportedSceneIds.filter(
    (id) => !existingSceneIds.includes(id)
  );

  // now add any new ones
  missingSceneIds.forEach((sceneId: number) => {
    const sceneName = SCENES[sceneId][0];
    const service = accessory.addService(
      Service.InputSource,
      sceneId,
      sceneName
    );
    configureInputSource(sceneId, service);
  });
}
