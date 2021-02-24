import {
  API,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from "homebridge";

const PLUGIN_NAME = "homebridge-wiz-lan";
const PLATFORM_NAME = "homebridge-wiz-lan";

export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, HomebridgeWizLan as any);
};

interface Config extends PlatformConfig {}

interface Device {
  
}

class HomebridgeWizLan {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap
    .Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  token: string | null = null;
  refreshToken = "";
  authenticateRequest: Promise<string | void> | null = null;
  unit: number = 0;

  constructor(
    public readonly log: Logger,
    public readonly config: Config,
    public readonly api: API
  ) {
    this.log.debug("Finished initializing platform:", this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on("didFinishLaunching", () => {
      log.debug("Executed didFinishLaunching callback");
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  initServices(accessory: PlatformAccessory) {
    accessory
      .getService(this.Service.AccessoryInformation)!!
      .setCharacteristic(this.Characteristic.Manufacturer, "Wiz")
      .setCharacteristic(this.Characteristic.Model, "Light")
      .setCharacteristic(this.Characteristic.SerialNumber, "123-456-789");

    const device = accessory.context as Device;
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info("Loading accessory from cache:", accessory.displayName);

    this.initServices(accessory);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  tryAddDevice(device: Device) {
    const uuid = this.api.hap.uuid.generate("");
    const name = "";

    const existingAccessory = this.accessories.find(
      (accessory) => accessory.UUID === uuid
    );

    // check the accessory was not restored from cache
    if (!existingAccessory) {
      // create a new accessory
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context = device;

      this.log.info("Adding new accessory:", name);

      this.initServices(accessory);

      this.accessories.push(accessory);

      // register the accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
        accessory,
      ]);
    } else {
      existingAccessory.context = device;
      this.log.info("Updating accessory:", name);
      this.api.updatePlatformAccessories([existingAccessory]);
    }

    return device;
  }

  discoverDevices() {
    this.log.info("Discovering accessories with UDP broadcast...")
  }
}
