import { Socket } from "dgram";
import {
  API,
  Logger,
  PlatformAccessory,
  Service,
  Characteristic,
} from "homebridge";

import { PLATFORM_NAME, PLUGIN_NAME } from "./constants";
import { Config, Device } from "./types";
import Accessories from './accessories';
import { bindSocket, createSocket, registerDiscoveryHandler, sendDiscoveyBroadcast } from "./util/network";

export default class HomebridgeWizLan {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap
    .Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly initializedAccessories = new Set<PlatformAccessory>();
  public readonly socket: Socket;

  constructor(
    public readonly log: Logger,
    public readonly config: Config,
    public readonly api: API
  ) {
    this.socket = createSocket(this);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on("didFinishLaunching", () => {
      log.debug("Executed didFinishLaunching callback");
      // run the method to discover / register your devices as accessories
      bindSocket(this, () => {
        registerDiscoveryHandler(this, this.tryAddDevice.bind(this));
        sendDiscoveyBroadcast(this);
      });
    });
  }

  initAccessory(platformAccessory: PlatformAccessory) {

    // Already initialized!!
    if (this.initializedAccessories.has(platformAccessory)) {
      return;
    }

    const device = platformAccessory.context as Device;

    // Skip if it doesn't have the new context schema
    if (typeof device?.model !== "string") {
      return;
    }

    platformAccessory
      .getService(this.Service.AccessoryInformation)!!
      .setCharacteristic(this.Characteristic.Manufacturer, "Wiz")
      .setCharacteristic(this.Characteristic.Model, device.model)
      .setCharacteristic(this.Characteristic.SerialNumber, device.mac);

    const accessory = Accessories.find(accessory => accessory.is(device));

    if (typeof accessory === 'undefined') {
      this.log.warn(`Unknown device ${device.toString()}, skipping...`);
      return;
    } 

    accessory.init(platformAccessory, device, this);

    this.initializedAccessories.add(platformAccessory);
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info("Loading accessory from cache:", accessory.displayName);

    this.initAccessory(accessory);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  tryAddDevice(device: Device) {

    const accessory = Accessories.find(accessory => accessory.is(device));

    if (typeof accessory === 'undefined') {
      this.log.warn(`Unknown device ${device.toString()}, skipping...`);
      return;
    } 

    const uuid = this.api.hap.uuid.generate(device.mac);
    const name = `Wiz ${accessory.getName(device)} ${device.mac}`;

    const existingAccessory = this.accessories.find(
      (accessory) => accessory.UUID === uuid
    );

    // check the accessory was not restored from cache
    if (!existingAccessory) {
      // create a new accessory
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context = device;

      this.log.info("Adding new accessory:", name);

      this.initAccessory(accessory);

      this.accessories.push(accessory);

      // register the accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    } else {
      existingAccessory.context = device;
      this.log.info("Updating accessory:", name);
      this.api.updatePlatformAccessories([existingAccessory]);
      // try initializing again in case it didn't the last time 
      // (e.g. platform upgrade)
      this.initAccessory(existingAccessory);
    }
  }
}
