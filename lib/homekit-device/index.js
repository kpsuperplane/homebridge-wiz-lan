/* eslint-disable no-console */
class HomeKitDevice {
  static create(platform, wizDevice) {
    // require needed here to avoid circular dependency
    // eslint-disable-next-line global-require
    const { HomeKitDeviceBulb } = require('./bulb');
    // eslint-disable-next-line global-require
    if (wizDevice.deviceType === 'bulb') {
      return new HomeKitDeviceBulb(platform, wizDevice);
    }
    return null;
  }

  constructor(platform, wizDevice) {
    this.platform = platform;
    this.log = platform.log;
    this.wizDevice = wizDevice;

    this.characteristics = {};

    this.addCharacteristic(platform.homebridge.hap.Characteristic.Name, {
      getValue: () => {
        return this.name;
      },
    });
  }

  get id() {
    return this.wizDevice.id;
  }

  get name() {
    return this.wizDevice.alias;
  }

  // eslint-disable-next-line class-methods-use-this
  get manufacturer() {
    return 'TP-Link';
  }

  get model() {
    return this.wizDevice.model;
  }

  get serialNumber() {
    return `${this.wizDevice.mac} ${this.wizDevice.id}`;
  }

  get firmwareRevision() {
    return this.wizDevice.softwareVersion;
  }

  get hardwareRevision() {
    return this.wizDevice.hardwareVersion;
  }

  supportsCharacteristic(characteristic) {
    return this.getCharacteristic(characteristic) != null;
  }

  supportsCharacteristicSet(characteristic) {
    const c = this.getCharacteristic(characteristic);
    if (c == null) return false;
    return typeof c.setValue === 'function';
  }

  addCharacteristic(characteristic, { getValue, setValue, props }) {
    this.characteristics[characteristic.UUID] = { getValue, setValue, props };
  }

  /**
   * @private
   */
  getCharacteristic(characteristic) {
    return this.characteristics[characteristic.UUID];
  }

  getCharacteristicProps(characteristic) {
    this.log.debug(
      '[%s] getCharacteristicProps',
      this.name,
      this.platform.getCharacteristicName(characteristic)
    );
    return this.getCharacteristic(characteristic).props;
  }

  getCharacteristicValue(characteristic) {
    this.log.debug(
      '[%s] getCharacteristicValue',
      this.name,
      this.platform.getCharacteristicName(characteristic)
    );
    return this.getCharacteristic(characteristic).getValue();
  }

  setCharacteristicValue(characteristic, value) {
    this.log.debug(
      '[%s] setCharacteristicValue [%s]',
      this.name,
      value,
      this.platform.getCharacteristicName(characteristic)
    );
    return this.getCharacteristic(characteristic).setValue(value);
  }

  fireCharacteristicUpdateCallback(characteristic, value) {
    this.log.debug(
      '[%s] fireCharacteristicUpdateCallback [%s]',
      this.name,
      value,
      this.platform.getCharacteristicName(characteristic)
    );
    const c = this.getCharacteristic(characteristic);
    if (c && typeof c.updateCallback === 'function') {
      this.getCharacteristic(characteristic).updateCallback(value);
    }
  }

  setCharacteristicUpdateCallback(characteristic, callbackFn) {
    this.log.debug(
      '[%s] setCharacteristicUpdateCallback [%s]',
      this.name,
      this.platform.getCharacteristicName(characteristic),
      callbackFn.name
    );
    this.getCharacteristic(characteristic).updateCallback = callbackFn;
  }
}

module.exports.HomeKitDevice = HomeKitDevice;
