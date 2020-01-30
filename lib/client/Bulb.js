const EventEmitter = require('events');
const ct = require('color-temperature');

class Bulb extends EventEmitter {
  constructor({ host, port, sysInfo, status, client }) {
    super();
    this.host = host;
    this.port = port;
    this.client = client;
    this.status = status;
    this.seenOnDiscovery = false;
    this.lightStatePromise = null;
    this.lightStatePromiseResolve = null;
    this.colorChange = null;
    this.setSysInfo(sysInfo);
  }

  findChanges(a, b) {
    let changed = false;
    const diff = {};
    (new Set([...Object.keys(a), ...Object.keys(b)])).forEach(key => {
      if (a[key] !== b[key] && b[key] !== undefined) {
        changed = true;
        diff[key] = b[key];
      } 
    });
    return [changed, diff];
  }
  // from https://gist.github.com/mjackson/5311256
  rgbToHsv({ r, g, b, red, green, blue }) {
    r = red || r;
    g = green || g;
    b = blue || b;
    (r /= 255), (g /= 255), (b /= 255);

    var max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    var h,
      s,
      v = max;

    var d = max - min;
    s = max == 0 ? 0 : d / max;

    if (max == min) {
      h = 0; // achromatic
    } else {
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }

      h /= 6;
    }
    return { hue: Math.round(h * 360), saturation: Math.round(s * 100) };
  }
  hsvToColor(h, s) {
    // First, convert to RGB
    const v = 1;
    var r, g, b;

    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);

    switch (i % 6) {
      case 0:
        (r = v), (g = t), (b = p);
        break;
      case 1:
        (r = q), (g = v), (b = p);
        break;
      case 2:
        (r = p), (g = v), (b = t);
        break;
      case 3:
        (r = p), (g = q), (b = v);
        break;
      case 4:
        (r = t), (g = p), (b = v);
        break;
      case 5:
        (r = v), (g = p), (b = q);
        break;
    }
    const rgb = { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };

    // See if it might actually be a color temperature
    const h360 = h * 360;
    const s100 = s * 100;
    if (
      (h360 >= 0 && h360 <= 30 && s100 >= 0 && s100 <= 76) ||
      (h360 >= 220 && h360 <= 360 && s100 >= 0 && s100 <= 25)
    ) {
      const possibleKelvin = ct.rgb2colorTemperature({
        red: rgb.r,
        green: rgb.g,
        blue: rgb.b
      });
      this.client.log.debug(`Considering possible Kelvin conversio of ${possibleKelvin}`);
      // check if bulb supports it
      if (possibleKelvin >= this.kelvinRange.min && possibleKelvin <= this.kelvinRange.max) {
        return { temp: possibleKelvin };
      }
    }

    return rgb;
  }

  get kelvinRange() {
    return {min: 2200, max: 6500};
  }

  get id() {
    return this.sysInfo.deviceId;
  }

  get UUID() {
    return this.sysInfo.deviceId;
  }

  get alias() {
    return this.sysInfo.deviceId;
  }

  get deviceId() {
    return this.sysInfo.deviceId;
  }

  // eslint-disable-next-line class-methods-use-this
  get deviceType() {
    return 'bulb';
  }

  buildState = () => {
    if (this.sysInfo === undefined)
      return {
        on_off: false,
        r: 255,
        g: 255,
        b: 255,
        brightness: 0,
      };
    const color =
      'temp' in this.sysInfo
        ? { ...this.rgbToHsv(ct.colorTemperature2rgb(this.sysInfo.temp)) }
        : { ...this.rgbToHsv(this.sysInfo) };
    return {
      on_off: this.sysInfo.state,
      brightness: Math.round(this.sysInfo.dimming * 1.1 - 10),
      ...color,
    };
  };

  setSysInfo = sysInfo => {
    const oldState = this.buildState();
    this.sysInfo = sysInfo;
    const newState = this.buildState();
    if (oldState.on_off && !newState.on_off) {
      this.emit('lightstate-off');
    } else if (!oldState.on_off && newState.on_off) {
      this.emit('lightstate-on');
    }

    const [hasChanged, diff] = this.findChanges(oldState, newState);
    if (hasChanged) {
      this.emit('lightstate-update', diff);
    }
  };

  getLightState = () => {
    return this.buildState();
  };

  setLightState = state => {
    let color = 'temp' in this.sysInfo ? {
      temp: this.sysInfo.temp,
    } : {
      r: this.sysInfo.r,
      g: this.sysInfo.g,
      b: this.sysInfo.b,
    };
    if ('hue' in state || 'saturation' in state) {
      if (this.colorChange === null) {
        this.colorChange = state;
        return;
      } else {
        const {hue, saturation} = {...this.colorChange, ...state};
        this.colorChange = null;
        color = this.hsvToColor(hue / 360, saturation / 100);
      }
    }
    const sysInfo = {
      dimming: 'brightness' in state ? Math.round((Math.max(1, state.brightness) + 10) / 1.1): this.sysInfo.dimming,
      state: state.brightness === 0 ? false : ('on_off' in state ? state.on_off : this.sysInfo.state),
      ...color,
    };
    this.client.log.debug(`Setting sysInfo to ${sysInfo}`);
    this.sysInfo = sysInfo;
    this.client.setPilot(this.host, sysInfo);
    return;
  };
}

module.exports = Bulb;
