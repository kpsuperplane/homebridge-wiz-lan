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
import { isRGB, isTW, turnOffIfNeeded } from "../util";

enum SCENES {
  "Ocean" = 1,
  "Romance",
  "Sunset",
  "Party",
  "Fireplace",
  "Cozy",
  "Forest",
  "Pastel Colors",
  "Wake up",
  "Bedtime",
  "Warm White",
  "Daylight",
  "Cool white",
  "Night light",
  "Focus",
  "Relax",
  "True colors",
  "TV time",
  "Plantgrowth",
  "Spring",
  "Summer",
  "Fall",
  "Deepdive",
  "Jungle",
  "Mojito",
  "Club",
  "Christmas",
  "Halloween",
  "Candlelight",
  "Golden white",
  "Pulse",
  "Steampunk",
}

const DW_BULBS_SUPPORTED_SCENES_IDS = [9, 10, 13, 14, 29, 30, 31, 32];
const TW_BULBS_SUPPORTED_SCENES_IDS = [
  6, 9, 10, 11, 12, 13, 14, 15, 16, 18, 29, 30, 31, 32,
];
const RGB_BULBS_SUPPORTED_SCENES_IDS = Object.keys(SCENES).reduce(
  (ids, key) => (isNaN(Number(key)) ? ids : [...ids, Number(key)]),
  [] as number[]
);

/** 
* Returns supported scenes for device. Based on https://bit.ly/3hLImPa.
* @param device
* @return array of ids of scenes supported by the particular light type
*/
function supportedScenesIdsForDevice(device: Device) {
  if (isTW(device)) return TW_BULBS_SUPPORTED_SCENES_IDS;
  else if (isRGB(device)) return RGB_BULBS_SUPPORTED_SCENES_IDS;
  return DW_BULBS_SUPPORTED_SCENES_IDS;
}

export function transformEffectId(pilot: Pilot): number {
  return Number(pilot.sceneId);
}

export function transformEffectActive(pilot: Pilot): boolean {
  return Number(pilot.sceneId) > 0;
}

export function initScenes(
  wiz: HomebridgeWizLan,
  accessory: PlatformAccessory,
  device: Device
) {
  const { Characteristic, Service } = wiz;

  let scenesService = accessory.getService(Service.Television);
  const service = accessory.getService(Service.Lightbulb)!;
  if (!scenesService) {
    scenesService = new Service.Television("Scenes");
    accessory.addService(scenesService);

    scenesService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .on("get", callback =>
        getPilot(
          wiz,
          accessory,
          device,
          pilot => callback(null, transformEffectId(pilot)),
          callback
        )
      )
      .on(
        "set",
        (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
          const sceneId = Number(newValue);
          setPilot(wiz, accessory, device, { sceneId }, next);
          if (sceneId !== 0) device.lastSelectedSceneId = sceneId;
        }
      );

    scenesService
      .getCharacteristic(Characteristic.Active)
      .on("get", callback =>
        getPilot(
          wiz,
          accessory,
          device,
          pilot => callback(null, transformEffectActive(pilot)),
          callback
        )
      )
      .on(
        "set",
        (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
          console.log("active: ", newValue);
          if (newValue === 0) {
            scenesService!.setCharacteristic(
              Characteristic.ActiveIdentifier,
              0
            );

            next(null);
          } else {
            scenesService!.setCharacteristic(
              Characteristic.ActiveIdentifier,
              device.lastSelectedSceneId ?? 1
            );
            turnOffIfNeeded(Characteristic.Hue, service);
            turnOffIfNeeded(Characteristic.Saturation, service);

            next(null);
          }
        }
      );

    const scenesIds = supportedScenesIdsForDevice(device);

    scenesIds.forEach((sceneId: number) => {
      const sceneName = SCENES[sceneId];
      console.log(sceneName);
      const effectInputSource = accessory.addService(
        Service.InputSource,
        sceneId,
        sceneName
      );
      effectInputSource
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
      scenesService!.addLinkedService(effectInputSource);
    });
  }
}
