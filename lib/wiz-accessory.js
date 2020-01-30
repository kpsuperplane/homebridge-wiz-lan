const AccessoryInformation = require('./accessory-information');

const { getOrAddCharacteristic } = require('./utils');

const { HomeKitDevice } = require('./homekit-device');

class WizAccessory {
  constructor(
    platform,
    config,
    homebridgeAccessory,
    wizDevice,
    category,
    services
  ) {
    this.platform = platform;
    const PlatformAccessory = platform.homebridge.platformAccessory;
    const { Characteristic } = platform.homebridge.hap;
    const UUIDGen = platform.homebridge.hap.uuid;

    this.log = platform.log;
    this.config = config || {};
    this.homebridgeAccessory = homebridgeAccessory;
    this.hkDevice = HomeKitDevice.create(platform, wizDevice);
    if (this.hkDevice === null) {
      return;
    }
    this.services = {};

    this.name = this.hkDevice.name;

    const categoryName = platform.getCategoryName(category);

    if (!this.homebridgeAccessory) {
      const uuid = UUIDGen.generate(this.hkDevice.id);
      this.log.debug(
        `[${this.name}] Creating new Accessory [${
          this.hkDevice.id
        }] [${uuid}] category: ${categoryName || ''}`
      );
      this.homebridgeAccessory = new PlatformAccessory(
        this.name,
        uuid,
        category
      );
      this.platform.registerPlatformAccessory(this.homebridgeAccessory);
    } else {
      this.log.debug(
        `[${this.name}] Existing Accessory found [${
          homebridgeAccessory.context.deviceId
        }] [${homebridgeAccessory.UUID}] category: ${categoryName || ''}`
      );
      this.homebridgeAccessory.displayName = this.name;
      if (this.homebridgeAccessory.category !== category) {
        this.log.warn(
          `[${
            this.name
          }] Correcting Accessory Category from: ${platform.getCategoryName(
            this.homebridgeAccessory.category
          )} to: ${categoryName || ''}`
        );
        this.homebridgeAccessory.category = category;
      }
    }

    this.services.AccessoryInformation = AccessoryInformation(
      platform.homebridge.hap
    )(this.homebridgeAccessory, this.hkDevice);

    this.homebridgeAccessory.context.deviceId = this.hkDevice.id;

    services.forEach(serviceConstructor => {
      const serviceName = this.platform.getServiceName(serviceConstructor);
      let service = this.homebridgeAccessory.getService(serviceConstructor);
      if (!service) {
        this.log.debug(`[${this.name}] Creating new ${serviceName} Service`);
        service = this.homebridgeAccessory.addService(
          serviceConstructor,
          this.name
        );
      } else {
        service.setCharacteristic(Characteristic.Name, this.name);
      }
      this.services[serviceName] = service;
    });

    if (this.services.Lightbulb) {
      const characteristics = [
        Characteristic.Name,
        Characteristic.On,
        Characteristic.Brightness,
        Characteristic.ColorTemperature,
        Characteristic.Hue,
        Characteristic.Saturation,
      ];
      this.setupCharacteristics(this.services.Lightbulb, characteristics);
    }

    // Remove Old Services
    this.homebridgeAccessory.services.forEach(service => {
      if (service === this.services.AccessoryInformation) return;
      if (service === this.services.Lightbulb) return;
      if (service === this.services.Outlet) return;
      this.log.warn(
        `[${this.name}] Removing stale Service: [%s] uuid:[%s] subtype:[%s]`,
        this.platform.getServiceName(service),
        service.UUID,
        service.subtype || ''
      );
      this.homebridgeAccessory.removeService(service);
    });

    // console.log.debug(this.homebridgeAccessory.displayName);
    // this.homebridgeAccessory.services.forEach((service) => {
    //   console.dir(this.platform.getServiceName(service));
    //   console.dir(service.characteristics.map(c => platform.getCharacteristicName(c)));
    // });
  }

  /**
   * @private
   */
  setupCharacteristics(service, characteristics) {
    const characteristicsToRemove = service.characteristics.filter(
      existingCharacteristic => {
        return !characteristics.find(
          characteristicToSetup =>
            characteristicToSetup.UUID === existingCharacteristic.UUID
        );
      }
    );

    characteristicsToRemove.forEach(characteristicToRemove => {
      this.log.warn(
        `[${this.name}] Removing stale Characteristic: [%s.%s] uuid:[%s]`,
        this.platform.getServiceName(service),
        this.platform.getCharacteristicName(characteristicToRemove),
        characteristicToRemove.UUID
      );
      service.removeCharacteristic(characteristicToRemove);
    });

    characteristics.forEach(characteristic => {
      if (this.hkDevice.supportsCharacteristic(characteristic)) {
        const c = getOrAddCharacteristic(service, characteristic);

        const props = this.hkDevice.getCharacteristicProps(characteristic);
        if (props) {
          c.setProps(props);
        }


        c.on('get', cb =>
          cb(null, this.hkDevice.getCharacteristicValue(characteristic))
        );

        if (this.hkDevice.supportsCharacteristicSet(characteristic)) {
          c.on('set', (value, cb) => {
            this.hkDevice.setCharacteristicValue(characteristic, value);
            cb();
          });
        }

        this.hkDevice.setCharacteristicUpdateCallback(characteristic, value => {
          service.updateCharacteristic(characteristic, value);
        });
        return;
      }
      service.removeCharacteristic(characteristic);
    });
  }
}

module.exports.WizAccessory = WizAccessory;
