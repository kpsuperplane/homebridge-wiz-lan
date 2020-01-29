const { HomeKitDevice } = require('.');

const { kelvinToMired, miredToKelvin } = require('../utils');

let Characteristic;

class HomeKitDeviceBulb extends HomeKitDevice {
  constructor(platform, wizDevice) {
    super(platform, wizDevice);

    Characteristic = platform.homebridge.hap.Characteristic;

    this.addBasicCharacteristics();

    this.addBrightnessCharacteristics();
    this.addColorTemperatureCharacteristics();

    // if (wizDevice.supportsColor) {
    this.addColorCharacteristics();
    // }
  }

  identify(paired, callback) {
    this.log.debug(`[${this.name}] identify`);
    this.log.warn(`[${this.name}] identify, not implemented`);
    // TODO
    callback();
  }

  /**
   * @private
   */
  addBasicCharacteristics() {
    this.addCharacteristic(Characteristic.On, {
      getValue: async () => {
        return this.wizDevice.getLightState().then(state => state.on_off);
      },
      setValue: async value => {
        return this.wizDevice.setLightState({ on_off: value });
      },
    });
    this.wizDevice.on('lightstate-on', () => {
      this.fireCharacteristicUpdateCallback(Characteristic.On, true);
    });
    this.wizDevice.on('lightstate-off', () => {
      this.fireCharacteristicUpdateCallback(Characteristic.On, false);
    });

    this.wizDevice.on('lightstate-update', lightState => {
      if (lightState.on_off != null) {
        this.fireCharacteristicUpdateCallback(
          Characteristic.On,
          lightState.on_off
        );
      }
      if (lightState.brightness != null) {
        this.fireCharacteristicUpdateCallback(
          Characteristic.Brightness,
          lightState.brightness
        );
      }
      if (lightState.color_temp != null && lightState.color_temp > 0) {
        this.fireCharacteristicUpdateCallback(Characteristic.Hue, 0);
        this.fireCharacteristicUpdateCallback(Characteristic.Saturation, 0);
        this.fireCharacteristicUpdateCallback(
          Characteristic.ColorTemperature,
          Math.round(kelvinToMired(lightState.color_temp))
        );
      } else {
        if (lightState.hue != null || lightState.saturation != null) {
          this.fireCharacteristicUpdateCallback(
            Characteristic.ColorTemperature,
            0
          );
        }
        if (lightState.hue != null) {
          this.fireCharacteristicUpdateCallback(
            Characteristic.Hue,
            lightState.hue
          );
        }
        if (lightState.saturation != null) {
          this.fireCharacteristicUpdateCallback(
            Characteristic.Saturation,
            lightState.saturation
          );
        }
      }
    });
  }

  /**
   * @private
   */
  addBrightnessCharacteristics() {
    this.addCharacteristic(Characteristic.Brightness, {
      getValue: async () => {
        return this.wizDevice.getLightState().then(ls => {
          return ls.brightness;
        });
      },
      setValue: async value => {
        return this.wizDevice.setLightState({ brightness: value });
      },
    });
  }

  /**
   * @private
   */
  addColorTemperatureCharacteristics() {
    const { min, max } = this.wizDevice.getColorTemperatureRange;
    this.log.error({
      minValue: Math.ceil(kelvinToMired(max)), // K and Mired are reversed
      maxValue: Math.floor(kelvinToMired(min)), // K and Mired are reversed
    });

    this.addCharacteristic(Characteristic.ColorTemperature, {
      props: {
        minValue: Math.ceil(kelvinToMired(max)), // K and Mired are reversed
        maxValue: Math.floor(kelvinToMired(min)), // K and Mired are reversed
      },
      getValue: async () => {
        return this.wizDevice.getLightState().then(ls => {
          return Math.round(kelvinToMired(ls.color_temp));
        });
      },
      setValue: async value => {
        return this.wizDevice.setLightState({
          color_temp: Math.round(miredToKelvin(value)),
        });
      },
    });
  }

  /**
   * @private
   */
  addColorCharacteristics() {
    this.addCharacteristic(Characteristic.Hue, {
      getValue: async () => {
        return this.wizDevice.getLightState().then(ls => {
          return ls.hue;
        });
      },
      setValue: async value => {
        return this.wizDevice.setLightState({ hue: value });
      },
    });

    this.addCharacteristic(Characteristic.Saturation, {
      getValue: async () => {
        return this.wizDevice.getLightState().then(ls => {
          return ls.saturation;
        });
      },
      setValue: async value => {
        return this.wizDevice.setLightState({ saturation: value });
      },
    });
  }
}

module.exports.HomeKitDeviceBulb = HomeKitDeviceBulb;
