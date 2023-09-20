import { Socket } from "dgram";
import {
  API,
  Characteristic,
  Logger,
  PlatformAccessory,
  Service,
} from "homebridge";

import Accessories, { WizAccessory } from './accessories';
import { PLATFORM_NAME, PLUGIN_NAME } from "./constants";
import { Config, Device } from "./types";
import { bindSocket, createSocket, registerDiscoveryHandler, sendDiscoveryBroadcast } from "./util/network";

export default class HomebridgeWizLan {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly initializedAccessories: {[uuid: string]: WizAccessory<any>} = {};
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
        sendDiscoveryBroadcast(this);
      });
    });

    this.initRefreshInterval();
  }

  initAccessory(platformAccessory: PlatformAccessory) {

    // Already initialized!!
    if (platformAccessory.UUID in this.initializedAccessories) {
      return;
    }

    const device = platformAccessory.context as Device;

    this.log.debug(`Initializing device ${device}...`)

    // Skip if it doesn't have the new context schema
    if (typeof device?.model !== "string") {
      return;
    }

    platformAccessory
      .getService(this.Service.AccessoryInformation)!!
      .setCharacteristic(this.Characteristic.Manufacturer, "Wiz")
      .setCharacteristic(this.Characteristic.Model, device.model)
      .setCharacteristic(this.Characteristic.SerialNumber, device.mac);

    const AccessoryClass = Accessories.find(accessory => accessory.is(device));

    if (typeof AccessoryClass === 'undefined') {
      this.log.warn(`Unknown device ${device.toString()}, skipping...`);
      return;
    }

    const accessory = new AccessoryClass(platformAccessory, device, this);
    accessory.init();

    this.initializedAccessories[platformAccessory.UUID] = accessory;
    return accessory;
  }

  initRefreshInterval() {
    const interval = Number(this.config.refreshInterval ?? 0);
    if (interval === 0) {
      this.log.info("[Refresh] Pings are off");
    } else {
      this.log.info(`[Refresh] Setting up ping for every ${interval} seconds`);
      setInterval(() => {
        const accessories = Object.values(this.initializedAccessories);
        this.log.debug(`[Refresh] Pinging ${accessories.length} accessories...`);
        for (const accessory of accessories) {
          accessory.getPilot().catch((error) => this.log.error(error));
        }
      }, interval * 1000);
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(platformAccessory: PlatformAccessory) {
    this.log.info("Loading accessory from cache:", platformAccessory.displayName);
    if (this.deviceShouldBeIgnored(platformAccessory.context as Device)) {
      this.log.info(`Unregistering ignored device ${JSON.stringify(platformAccessory.context)}...`);
      // This makes HB crash, BUT it removes the accessory from the cache
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [platformAccessory]);
      return;
    }

    this.initAccessory(platformAccessory);
    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(platformAccessory);
  }

  deviceShouldBeIgnored(device: Device) {
    if (this.config.ignoredDevices?.some(ignoredDevice => ignoredDevice.mac === device.mac || ignoredDevice.host === device.ip)){
      this.log.info(`Ignoring device with ${device.ip} and ${device.mac}...`);
      return true;
    }
    return false;
  }

  tryAddDevice(device: Device) {

    const accessory = Accessories.find(accessory => accessory.is(device));

    if (typeof accessory === 'undefined') {
      this.log.warn(`Unknown device ${device.model.toString()}, skipping...`);
      return;
    }


    const defaultName = `Wiz ${accessory.getName(device)} ${device.mac}`;
    let name = defaultName

    if (this.deviceShouldBeIgnored(device)) {
      return;
    }

    const uuid = this.api.hap.uuid.generate(device.mac);

    const existingAccessory = this.accessories.find(
      (accessory) => accessory.UUID === uuid
    );

    this.log.debug(`Considering alternative names in ${JSON.stringify(this.config.devices)} from ${JSON.stringify(this.config)}...`);
    if (Array.isArray(this.config.devices)) {
      this.log.debug(`Found some configs...`);
      for (const configDevice of this.config.devices) {
        this.log.debug(`Pondering ${JSON.stringify(configDevice)} versus ${JSON.stringify(device)}...`);
        if ((configDevice.mac && device.mac == configDevice.mac) ||
            (configDevice.host && device.ip == configDevice.host)) {
          this.log.debug(`Found a match...`);
          if (configDevice.name) {
            this.log.debug(`Changing name to ${configDevice.name}...`);
            name = configDevice.name;
          }
        }
      }
    }

    // check the accessory was not restored from cache
    if (!existingAccessory) {
      // create a new accessory
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context = device;
      if (this.deviceShouldBeIgnored(device)) {
        return;
      }
      this.log.info("Adding new accessory:", name);

      this.initAccessory(accessory);

      this.accessories.push(accessory);

      // register the accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    } else {
      existingAccessory.context = device;
      if (this.deviceShouldBeIgnored(device)) {
        return;
      }
      this.log.info(`Updating accessory: ${name}${name == existingAccessory.displayName ? "" : ` [formerly ${existingAccessory.displayName}]`}`);
      existingAccessory.displayName = name;
      this.api.updatePlatformAccessories([existingAccessory]);
      // try initializing again in case it didn't the last time
      // (e.g. platform upgrade)
      this.initAccessory(existingAccessory);
    }
  }
}
