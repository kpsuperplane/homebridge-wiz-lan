const EventEmitter = require('events');
const dgram = require('dgram');
const getMAC = require('getmac').default;
const internalIp = require('internal-ip');

const Bulb = require('./Bulb');
const { compareMac } = require('./utils');

const createLogger = require('./logger');

function strMac() {
  return getMAC()
    .toUpperCase()
    .replace(/:/g, '');
}

function strIp() {
  return internalIp.v4.sync();
}

const discoveryMsgBuf = () => {
  return `{"method":"registration","params":{"phoneMac":"${strMac()}","register":true,"phoneIp":"${strIp()}"}}`;
};

class Client extends EventEmitter {
  constructor({ defaultSendOptions, logLevel, logger } = {}) {
    super();
    this.defaultSendOptions = {
      timeout: 10000,
      transport: 'tcp',
      useSharedSocket: false,
      sharedSocketTimeout: 20000,
      ...defaultSendOptions,
    };

    this.log = createLogger({ level: logLevel, logger });

    this.devices = new Map();
    this.discoveryTimer = null;
    this.discoveryPacketSequence = 0;
    this.maxSocketId = 0;
  }

  /**
   * @private
   */
  emit(eventName, ...args) {
    // Add device- / plug- / bulb- to eventName
    if ('host' in args[0]) {
      super.emit(`device-${eventName}`, ...args);
    } else {
      super.emit(eventName, ...args);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  getDeviceFromSysInfo(sysInfo, deviceOptions) {
    return new Bulb({
      ...deviceOptions,
      sysInfo,
      deviceType: this.getTypeFromSysInfo(sysInfo),
    });
  }

  /**
   * Guess the device type from provided `sysInfo`.
   *
   * Based on sys_info.[type|mic_type]
   * @param  {Object} sysInfo
   * @return {string} 'bulb' | 'device'
   */
  // eslint-disable-next-line class-methods-use-this
  getTypeFromSysInfo(sysInfo) {
    if ('dimming' in sysInfo) {
      return 'bulb';
    }
    return 'device';
  }

  startDiscovery({
    address,
    port = 38900,
    broadcast = '255.255.255.255',
    discoveryInterval = 10000,
    discoveryTimeout = 0,
    offlineTolerance = 3,
    deviceTypes,
    macAddresses = [],
    excludeMacAddresses = [],
    filterCallback,
    deviceOptions = {},
    devices,
  }) {
    // eslint-disable-next-line prefer-rest-params
    this.log.debug('client.startDiscovery(%j)', arguments[0]);

    try {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg, rinfo) => {
        const decryptedMsg = msg.toString('utf8');

        this.log.debug(
          `client.startDiscovery(): socket:message From: ${rinfo.address} ${rinfo.port} Message: ${decryptedMsg}`
        );

        let response;
        let sysInfo;
        try {
          response = JSON.parse(decryptedMsg);
          if (response.method !== 'syncPilot') {
            return;
          }
          sysInfo = response.params;
          // eslint-disable-next-line no-multi-assign
          sysInfo.deviceId = sysInfo.alias = sysInfo.mac;
        } catch (err) {
          this.log.debug(
            `client.startDiscovery(): Error parsing JSON: %s\nFrom: ${rinfo.address} ${rinfo.port} Original: [%s] Decrypted: [${decryptedMsg}]`,
            err,
            msg
          );
          this.emit('discovery-invalid', {
            rinfo,
            response: msg,
            decryptedResponse: msg,
          });
          return;
        }

        if (deviceTypes && deviceTypes.length > 0) {
          const deviceType = this.getTypeFromSysInfo(sysInfo);
          if (deviceTypes.indexOf(deviceType) === -1) {
            this.log.debug(
              `client.startDiscovery(): Filtered out: ${sysInfo.alias} [${sysInfo.deviceId}] (${deviceType}), allowed device types: (%j)`,
              deviceTypes
            );
            return;
          }
        }

        if (macAddresses && macAddresses.length > 0) {
          const mac =
            sysInfo.mac || sysInfo.mic_mac || sysInfo.ethernet_mac || '';
          if (!compareMac(mac, macAddresses)) {
            this.log.debug(
              `client.startDiscovery(): Filtered out: ${sysInfo.alias} [${sysInfo.deviceId}] (${mac}), allowed macs: (%j)`,
              macAddresses
            );
            return;
          }
        }

        if (excludeMacAddresses && excludeMacAddresses.length > 0) {
          const mac =
            sysInfo.mac || sysInfo.mic_mac || sysInfo.ethernet_mac || '';
          if (compareMac(mac, excludeMacAddresses)) {
            this.log.debug(
              `client.startDiscovery(): Filtered out: ${sysInfo.alias} [${sysInfo.deviceId}] (${mac}), excluded mac`
            );
            return;
          }
        }

        if (typeof filterCallback === 'function') {
          if (!filterCallback(sysInfo)) {
            this.log.debug(
              `client.startDiscovery(): Filtered out: ${sysInfo.alias} [${sysInfo.deviceId}], callback`
            );
            return;
          }
        }

        this.createOrUpdateDeviceFromSysInfo({
          sysInfo,
          host: rinfo.address,
          port: rinfo.port,
          options: deviceOptions,
        });
      });

      this.socket.on('error', err => {
        this.log.error('client.startDiscovery: UDP Error: %s', err);
        this.stopDiscovery();
        this.emit('error', err);
        // TODO
      });

      this.socket.bind(port, address, () => {
        this.isSocketBound = true;
        const sockAddress = this.socket.address();
        this.log.debug(
          `client.socket: UDP ${sockAddress.family} listening on ${sockAddress.address}:${sockAddress.port}`
        );
        this.socket.setBroadcast(true);

        this.discoveryTimer = setInterval(() => {
          this.sendDiscovery(broadcast, devices, offlineTolerance);
        }, discoveryInterval);

        this.sendDiscovery(broadcast, devices, offlineTolerance);
        if (discoveryTimeout > 0) {
          setTimeout(() => {
            this.log.debug(
              'client.startDiscovery: discoveryTimeout reached, stopping discovery'
            );
            this.stopDiscovery();
          }, discoveryTimeout);
        }
      });
    } catch (err) {
      this.log.error('client.startDiscovery: %s', err);
      this.emit('error', err);
    }

    return this;
  }

  /**
   * @private
   */
  createOrUpdateDeviceFromSysInfo({ sysInfo, host, port, options }) {
    const id = sysInfo.deviceId;
    let device;
    if (this.devices.has(id)) {
      device = this.devices.get(id);
      device.host = host;
      device.port = port;
      device.setSysInfo(sysInfo);
      device.status = 'online';
      device.seenOnDiscovery = this.discoveryPacketSequence;
      this.emit('online', device);
    } else {
      const deviceOptions = { ...options, client: this, host, port };
      device = this.getDeviceFromSysInfo(sysInfo, deviceOptions);
      device.status = 'online';
      device.seenOnDiscovery = this.discoveryPacketSequence;
      this.devices.set(id, device);
      this.emit('new', device);
    }
  }

  /**
   * Stops discovery and closes UDP socket.
   */
  stopDiscovery() {
    this.log.debug('client.stopDiscovery()');
    clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
    if (this.isSocketBound) {
      this.isSocketBound = false;
      this.socket.close();
    }
  }

  setPilot(host, state) {
    const msg = JSON.stringify({
      method: 'setPilot',
      env: 'pro',
      params: { mac: getMAC(), src: 'udp', ...state },
    });
    this.socket.send(msg, 0, msg.length, 38899, host);
  }

  sendDiscovery(address, devices = [], offlineTolerance) {
    this.log.debug(
      'client.sendDiscovery(%s, %j, %s)',
      address,
      devices,
      offlineTolerance
    );
    try {
      this.devices.forEach(device => {
        if (device.status !== 'offline') {
          const diff = this.discoveryPacketSequence - device.seenOnDiscovery;
          if (diff >= offlineTolerance) {
            // eslint-disable-next-line no-param-reassign
            device.status = 'offline';
            this.emit('offline', device);
          }
        }
      });

      // sometimes there is a race condition with setInterval where this is called after it was cleared
      // check and exit
      if (!this.isSocketBound) {
        return;
      }
      const msg = discoveryMsgBuf();
      this.socket.send(msg, 0, msg.length, 38899, address);

      devices.forEach(d => {
        this.log.debug('client.sendDiscovery() direct device:', d);
        this.socket.send(msg, 0, msg.length, d.port || 38899, d.host);
      });

      if (this.discoveryPacketSequence >= Number.MAX_VALUE) {
        this.discoveryPacketSequence = 0;
      } else {
        this.discoveryPacketSequence += 1;
      }
    } catch (err) {
      this.log.error('client.sendDiscovery: %s', err);
      this.emit('error', err);
    }
  }
}

module.exports = {
  Client,
};
