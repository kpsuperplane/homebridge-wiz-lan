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
  "No Scene",
  "Ocean",
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

const DW_BULBS_SUPPORTED_SCENES_IDS = [0, 9, 10, 13, 14, 29, 30, 31, 32];
const TW_BULBS_SUPPORTED_SCENES_IDS = [0, 
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
  return pilot.sceneId ?? 0;
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
  const lightbulbService = accessory.getService(Service.Lightbulb)!;
  if (!scenesService) {
    scenesService = new Service.Television("Scenes");
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
        const value = Boolean(newValue);
        console.log(newValue);
        lightbulbService.getCharacteristic(Characteristic.On).updateValue(value);
        setPilot(wiz, accessory, device, { state: value }, next);
      }
    );
  
  lightbulbService.getCharacteristic(Characteristic.Active).on("set", (newValue: CharacteristicValue, next: CharacteristicSetCallback) => {
    const value = Boolean(newValue);
    scenesService!.getCharacteristic(Characteristic.Active).updateValue(value);
    next();
  });

  const turnOff = (_: CharacteristicValue, _next: CharacteristicSetCallback) => {
    scenesService!.getCharacteristic(Characteristic.ActiveIdentifier).updateValue(0);
  };
  lightbulbService.getCharacteristic(Characteristic.Saturation).on("set", turnOff);
  lightbulbService.getCharacteristic(Characteristic.Hue).on("set", turnOff);
  lightbulbService.getCharacteristic(Characteristic.ColorTemperature).on("set", turnOff);

  const scenesIds = supportedScenesIdsForDevice(device);
  // remove any scenes that should not exist
  accessory.services.filter(service => service.subtype != null).forEach(service => {
    const id = Number(service.getCharacteristic(Characteristic.Identifier).value as number);
    const index = scenesIds.indexOf(id);
    if (index === -1) {
      accessory.removeService(service);
    } else {
      scenesIds.splice(index, 1);
    }
  }); 

  // now add any new ones
  scenesIds.forEach((sceneId: number) => {
    const sceneName = SCENES[sceneId];
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
