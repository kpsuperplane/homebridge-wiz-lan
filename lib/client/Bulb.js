const EventEmitter = require('events');

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
    this.setSysInfo(sysInfo);
  }

  findChanges(a, b) {
    let changed = false;
    const diff = {};
    (new Set([...Object.keys(a), ...Object.keys(b)])).forEach(key => {
      if (a[key] !== b[key]) {
        changed = true;
        diff[key] = b[key];
      } else {
        diff[key] = null;
      }
    });
    return [changed, diff];
  }
  // from https://gist.github.com/mjackson/5311256
  rgbToHsv({ r, g, b }) {
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
  hsvToRgb(h, s) {
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
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
  }

  get getColorTemperatureRange() {
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
        temp: 2220,
        brightness: 0,
      };
    const color =
      'temp' in this.sysInfo
        ? { color_temp: this.sysInfo.temp, hue: null, saturation: null }
        : { ...this.rgbToHsv(this.sysInfo), color_temp: null };
    return {
      on_off: this.sysInfo.state,
      brightness: this.sysInfo.dimming,
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
    return Promise.resolve(this.buildState());
  };

  setLightState = state => {
    let color = {
      r: this.sysInfo.r,
      g: this.sysInfo.g,
      b: this.sysInfo.b,
      temp: this.sysInfo.temp,
    };
    if ('color_temp' in state) {
      color = {temp: state.color_temp};
    } else if ('hue' in state) {
      color = this.hsvToRgb(state.hue / 360, this.buildState().saturation / 100);
    } else if ('saturation' in state) {
      color = this.hsvToRgb(this.buildState().hue / 360, state.saturation / 100);
    }
    const sysInfo = {
      dimming: 'brightness' in state ? state.brightness : this.sysInfo.dimming,
      state: 'on_off' in state ? state.on_off : this.sysInfo.state,
      ...color,
    };
    this.sysInfo = sysInfo;
    this.client.setPilot(this.host, sysInfo);
  };
}

module.exports = Bulb;
