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
import { bindSocket, createSocket, MIN_DISCOVERY_INTERVAL_SECONDS, registerDiscoveryHandler, sendDiscoveryBroadcast } from "./util/network";

// The refresh sweep used to emit one probe per device in a single synchronous
// tick. A burst like that is what a flood looks like on the wire, and the
// correlated packet loss it causes is exactly what makes bulbs miss their
// deadline and flap to "No Response". Spread the sweep instead, up to this
// much spacing between devices (the whole sweep still fits in one interval).
const REFRESH_STAGGER_MAX_MS = 100;

/**
 * Normalize the MAC address formats used by Wiz discovery and Homebridge
 * configuration. Wiz reports compact uppercase addresses, while users often
 * copy lowercase addresses with colon or hyphen separators.
 */
function normalizeMac(mac?: string) {
  return typeof mac === "string"
    ? mac.trim().replace(/[.:-]/g, "").toUpperCase()
    : undefined;
}

export default class HomebridgeWizLan {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly initializedAccessories: {[uuid: string]: WizAccessory<any>} = {};
  public readonly socket: Socket;

  constructor(
    public readonly log: Logger,
    public readonly config: Config,
    public readonly api: API
  ) {
    // Assign after `this.api` is set, not via field initializer — under
    // [[Define]] class-field semantics the initializer would run before the
    // parameter property is assigned and dereference `undefined.hap`.
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
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
        this.initDiscoveryInterval();
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

  initDiscoveryInterval() {
    const interval = Number(this.config.discoveryInterval ?? 0);
    const refresh = Number(this.config.refreshInterval ?? 0);
    if (!(interval > 0)) {
      this.log.info("[Discovery] Periodic re-discovery is off");
      if (refresh > 0) {
        // Prior to 3.4.0 the refresh tick also re-broadcast discovery, so
        // bulbs that came back with a new DHCP lease were re-learned for
        // free. That coupling is gone — opt into discoveryInterval to keep it.
        this.log.warn(
          "[Discovery] refreshInterval is set but discoveryInterval is 0. " +
          "Bulbs that change IP (e.g. new DHCP lease) will not be re-learned automatically — " +
          "set discoveryInterval > 0 to restore the pre-3.4.0 behavior."
        );
      }
    } else {
      // Discovery is a subnet-wide broadcast — every host on the LAN takes an
      // interrupt for it, not just the bulbs. Floor the configured interval so
      // a typo can't turn re-discovery into a broadcast storm.
      let effective = interval;
      if (effective < MIN_DISCOVERY_INTERVAL_SECONDS) {
        this.log.warn(
          `[Discovery] discoveryInterval of ${interval}s is below the ${MIN_DISCOVERY_INTERVAL_SECONDS}s minimum ` +
          `(discovery is a LAN-wide broadcast) — using ${MIN_DISCOVERY_INTERVAL_SECONDS}s`
        );
        effective = MIN_DISCOVERY_INTERVAL_SECONDS;
      }
      this.log.info(`[Discovery] Re-broadcasting every ${effective} seconds`);
      const timer = setInterval(() => {
        this.log.debug("[Discovery] Sending periodic discovery broadcast...");
        sendDiscoveryBroadcast(this);
      }, effective * 1000);
      this.api.on("shutdown", () => clearInterval(timer));
    }
  }

  initRefreshInterval() {
    const interval = Number(this.config.refreshInterval ?? 0);
    if (!(interval > 0)) {
      this.log.info("[Refresh] Pings are off");
    } else {
      this.log.info(`[Refresh] Setting up ping for every ${interval} seconds`);
      let staggered: NodeJS.Timeout[] = [];
      const timer = setInterval(() => {
        const accessories = Object.values(this.initializedAccessories);
        this.log.debug(`[Refresh] Pinging ${accessories.length} accessories...`);
        // A sweep that overruns its interval would otherwise pile up on the
        // next one; drop whatever is still queued from last time.
        staggered.forEach(clearTimeout);
        staggered = [];
        const spacing = Math.min(
          REFRESH_STAGGER_MAX_MS,
          (interval * 1000) / Math.max(accessories.length, 1)
        );
        accessories.forEach((accessory, index) => {
          const ping = () => {
            accessory.getPilot().catch((error) => {
              // HapStatusError means the device was already logged as offline — skip redundant warn
              if (typeof (error as any).hapStatus === "number") return;
              this.log.warn(error);
            });
          };
          if (index === 0) {
            ping();
            return;
          }
          staggered.push(setTimeout(ping, Math.round(index * spacing)));
        });
      }, interval * 1000);
      this.api.on("shutdown", () => {
        clearInterval(timer);
        staggered.forEach(clearTimeout);
      });
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
    const deviceMac = normalizeMac(device.mac);
    if (this.config.ignoredDevices?.some(ignoredDevice =>
      (ignoredDevice.mac && normalizeMac(ignoredDevice.mac) === deviceMac) ||
      ignoredDevice.host === device.ip,
    )){
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
        if ((configDevice.mac && normalizeMac(configDevice.mac) === normalizeMac(device.mac)) ||
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
      this.log.info("Adding new accessory:", name);

      this.initAccessory(accessory);

      this.accessories.push(accessory);

      // register the accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    } else {
      existingAccessory.context = device;
      this.log.info(`Updating accessory: ${name}${name == existingAccessory.displayName ? "" : ` [formerly ${existingAccessory.displayName}]`}`);
      existingAccessory.displayName = name;
      this.api.updatePlatformAccessories([existingAccessory]);
      // try initializing again in case it didn't the last time
      // (e.g. platform upgrade)
      this.initAccessory(existingAccessory);
    }
  }
}
