const EventEmitter = require('events');
const dgram = require('dgram');
const { compareMac } = require('./utils');

const discoveryMsgBuf =
  '{"system":{"get_sysinfo":{}},"emeter":{"get_realtime":{}},"smartlife.iot.common.emeter":{"get_realtime":{}}}';

class Client extends EventEmitter {
  startDiscovery({
    address,
    port,
    broadcast = '255.255.255.255',
    discoveryInterval = 10000,
    discoveryTimeout = 0,
    offlineTolerance = 3,
    deviceTypes,
    macAddresses = [],
    excludeMacAddresses = [],
    filterCallback,
    breakoutChildren = true,
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
        let emeterRealtime;
        try {
          response = JSON.parse(decryptedMsg);
          sysInfo = response.system.get_sysinfo;
          emeterRealtime = response;
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
          emeterRealtime,
          host: rinfo.address,
          port: rinfo.port,
          breakoutChildren,
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
      this.socket.send(
        discoveryMsgBuf,
        0,
        discoveryMsgBuf.length,
        9999,
        address
      );

      devices.forEach(d => {
        this.log.debug('client.sendDiscovery() direct device:', d);
        this.socket.send(
          discoveryMsgBuf,
          0,
          discoveryMsgBuf.length,
          d.port || 9999,
          d.host
        );
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
