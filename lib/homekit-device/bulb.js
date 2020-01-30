const { HomeKitDevice } = require('.');

let Characteristic;

class HomeKitDeviceBulb extends HomeKitDevice {
  constructor(platform, wizDevice) {
    super(platform, wizDevice);

    Characteristic = platform.homebridge.hap.Characteristic;

    this.addBasicCharacteristics();

    this.addBrightnessCharacteristics();

    this.addColorCharacteristics();
  }

  /**
   * @private
   */
  addBasicCharacteristics() {
    this.addCharacteristic(Characteristic.On, {
      getValue: () => {
        return this.wizDevice.getLightState().on_off;
      },
      setValue: value => this.wizDevice.setLightState({ on_off: value }),
    });
    this.wizDevice.on('lightstate-on', () => {
      this.fireCharacteristicUpdateCallback(Characteristic.On, true);
    });
    this.wizDevice.on('lightstate-off', () => {
      this.fireCharacteristicUpdateCallback(Characteristic.On, false);
    });

    this.wizDevice.on('lightstate-update', lightState => {
      if ('on_off' in lightState) {
        this.fireCharacteristicUpdateCallback(
          Characteristic.On,
          lightState.on_off
        );
      }
      if ('brightness' in lightState) {
        this.fireCharacteristicUpdateCallback(
          Characteristic.Brightness,
          lightState.brightness
        );
      }
      if ('hue' in lightState) {
        this.log.debug(`Set hue ${lightState.saturation}`);
        this.fireCharacteristicUpdateCallback(
          Characteristic.Hue,
          lightState.hue
        );
      }
      if ('saturation' in lightState) {
        this.log.debug(`Set saturation ${lightState.saturation}`);
        this.fireCharacteristicUpdateCallback(
          Characteristic.Saturation,
          lightState.saturation
        );
      }
    });
  }

  /**
   * @private
   */
  addBrightnessCharacteristics() {
    this.addCharacteristic(Characteristic.Brightness, {
      getValue: () => {
        return this.wizDevice.getLightState().brightness;
      },
      setValue: value => this.wizDevice.setLightState({ brightness: value }),
    });
  }

  /**
   * @private
   */
  addColorCharacteristics() {
    this.addCharacteristic(Characteristic.Hue, {
      getValue: () => {
        this.log.debug('Get sat');
        return this.wizDevice.getLightState().hue || 0;
      },
      setValue: value => this.wizDevice.setLightState({ hue: value }),
    });

    this.addCharacteristic(Characteristic.Saturation, {
      getValue: () => {
        this.log.debug('Get hue');
        return this.wizDevice.getLightState().saturation || 0;
      },
      setValue: value => this.wizDevice.setLightState({ saturation: value }),
    });
  }
}

module.exports.HomeKitDeviceBulb = HomeKitDeviceBulb;
