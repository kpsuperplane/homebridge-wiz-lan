import dgram from "dgram";
import getMac from "getmac";
import internalIp from "internal-ip";

import { Pilot as BulbPilot } from "../accessories/WizLight/pilot";
import { Pilot as SocketPilot } from "../accessories/WizSocket/pilot";
import { Device } from "../types";
import HomebridgeWizLan from "../wiz";
import { makeLogger } from "./logger";

function strMac() {
  return getMac().toUpperCase().replace(/:/g, "");
}

function strIp() {
  return internalIp.v4.sync() ?? "0.0.0.0";
}

const BROADCAST_PORT = 38899;

function getNetworkConfig({ config }: HomebridgeWizLan) {
  return {
    ADDRESS: config.address ?? strIp(),
    PORT: config.port ?? 38900,
    BROADCAST: config.broadcast ?? "255.255.255.255",
    MAC: config.mac ?? strMac(),
  };
}

const getPilotQueue: {
  [key: string]: ((error: Error | null, pilot: any) => void)[];
} = {};
const getPilotDebounce: {
  [key: string]: {
    timeout: NodeJS.Timeout;
    callbacks: ((error: Error | null, pilot: any) => void)[];
  };
} = {};
export function getPilot<T>(
  wiz: HomebridgeWizLan,
  device: Device,
  callback: (error: Error | null, pilot: T) => void
) {
  const timeout = setTimeout(() => {
    const { callbacks } = getPilotDebounce[device.mac];
    getPilotInternal(wiz, device, (error, pilot) => {
      callbacks.map((cb) => cb(error, pilot));
    });
    delete getPilotDebounce[device.mac];
  }, 50);
  if (device.mac in getPilotDebounce) {
    clearTimeout(getPilotDebounce[device.mac].timeout);
  }
  getPilotDebounce[device.mac] = {
    timeout,
    callbacks: [callback, ...(getPilotDebounce[device.mac]?.callbacks ?? [])],
  };
}
function getPilotInternal<T>(
  wiz: HomebridgeWizLan,
  device: Device,
  callback: (error: Error | null, pilot: T) => void
) {
  if (device.mac in getPilotQueue) {
    getPilotQueue[device.mac].push(callback);
  } else {
    getPilotQueue[device.mac] = [callback];
  }
  wiz.log.debug(`[getPilot] Sending getPilot to ${device.mac}`);
  wiz.socket.send(
    `{"method":"getPilot","params":{}}`,
    BROADCAST_PORT,
    device.ip,
    (error: Error | null) => {
      if (error !== null && device.mac in getPilotQueue) {
        wiz.log.debug(
          `[Socket] Failed to send getPilot response to ${
            device.mac
          }: ${error.toString()}`
        );
        const callbacks = getPilotQueue[device.mac];
        delete getPilotQueue[device.mac];
        callbacks.map((f) => f(error, null));
      }
    }
  );
}

const setPilotQueue: { [key: string]: ((error: Error | null) => void)[] } = {};
export function setPilot(
  wiz: HomebridgeWizLan,
  device: Device,
  pilot: BulbPilot | SocketPilot,
  callback: (error: Error | null) => void
) {
  if (wiz.config.lastStatus) {
    // Keep only the settings that cannot change the bulb color
    Object.keys(pilot).forEach((key: string) => {
      if (['sceneId', 'speed', 'temp', 'dimming', 'r', 'g', 'b'].includes(key)) {
        delete pilot[key as keyof typeof pilot]
      }
    });
  }
  const msg = JSON.stringify({
    method: "setPilot",
    env: "pro",
    params: Object.assign(
      {
        mac: device.mac,
        src: "udp",
      },
      pilot,
    ),
  });
  if (device.ip in setPilotQueue) {
    setPilotQueue[device.ip].push(callback);
  } else {
    setPilotQueue[device.ip] = [callback];
  }
  wiz.log.debug(`[SetPilot][${device.ip}:${BROADCAST_PORT}] ${msg}`);
  wiz.socket.send(msg, BROADCAST_PORT, device.ip, (error: Error | null) => {
    if (error !== null && device.mac in setPilotQueue) {
      wiz.log.debug(
        `[Socket] Failed to send setPilot response to ${
          device.mac
        }: ${error.toString()}`
      );
      const callbacks = setPilotQueue[device.mac];
      delete setPilotQueue[device.mac];
      callbacks.map((f) => f(error));
    }
  });
}

export function createSocket(wiz: HomebridgeWizLan) {
  const log = makeLogger(wiz, "Socket");

  const socket = dgram.createSocket("udp4");

  socket.on("error", (err) => {
    log.error(`UDP Error: ${err}`);
  });

  socket.on("message", (msg, rinfo) => {
    const decryptedMsg = msg.toString("utf8");
    log.debug(
      `[${rinfo.address}:${rinfo.port}] Received message: ${decryptedMsg}`
    );
  });

  wiz.api.on("shutdown", () => {
    log.debug("Shutting down socket");
    socket.close();
  });

  return socket;
}

export function bindSocket(wiz: HomebridgeWizLan, onReady: () => void) {
  const log = makeLogger(wiz, "Socket");
  const { PORT, ADDRESS } = getNetworkConfig(wiz);
  log.info(`Setting up socket on ${ADDRESS ?? "0.0.0.0"}:${PORT}`);
  wiz.socket.bind(PORT, ADDRESS, () => {
    const sockAddress = wiz.socket.address();
    log.debug(
      `Socket Bound: UDP ${sockAddress.family} listening on ${sockAddress.address}:${sockAddress.port}`
    );
    wiz.socket.setBroadcast(true);
    onReady();
  });
}

export function registerDiscoveryHandler(
  wiz: HomebridgeWizLan,
  addDevice: (device: Device) => void
) {
  const log = makeLogger(wiz, "Discovery");

  log.debug("Initiating discovery handlers");

  try {
    wiz.socket.on("message", (msg, rinfo) => {
      const decryptedMsg = msg.toString("utf8");
      let response: any;
      const ip = rinfo.address;
      try {
        response = JSON.parse(decryptedMsg);
      } catch (err) {
        log.debug(
          `Error parsing JSON: ${err}\nFrom: ${rinfo.address} ${rinfo.port} Original: [${msg}] Decrypted: [${decryptedMsg}]`
        );
        return;
      }
      if (response.method === "registration") {
        const mac = response.result.mac;
        log.debug(`[${ip}@${mac}] Sending config request (getSystemConfig)`);
        // Send system config request
        wiz.socket.send(
          `{"method":"getSystemConfig","params":{}}`,
          BROADCAST_PORT,
          ip
        );
      } else if (response.method === "getSystemConfig") {
        const mac = response.result.mac;
        log.debug(`[${ip}@${mac}] Received config`);
        addDevice({
          ip,
          mac,
          model: response.result.moduleName,
        });
      } else if (response.method === "getPilot") {
        const mac = response.result.mac;
        if (mac in getPilotQueue) {
          const callbacks = getPilotQueue[mac];
          delete getPilotQueue[mac];
          callbacks.map((f) => f(null, response.result));
        }
      } else if (response.method === "setPilot") {
        const ip = rinfo.address;
        if (ip in setPilotQueue) {
          const callbacks = setPilotQueue[ip];
          delete setPilotQueue[ip];
          callbacks.map((f) =>
            f(response.error ? new Error(response.error.toString()) : null)
          );
        }
      }
    });
  } catch (err) {
    log.error(`Error: ${err}`);
  }
}

export function sendDiscoveryBroadcast(service: HomebridgeWizLan) {
  const { ADDRESS, MAC, BROADCAST } = getNetworkConfig(service);

  const log = makeLogger(service, "Discovery");
  log.info(`Sending discovery UDP broadcast to ${BROADCAST}:${BROADCAST_PORT}`);

  // Send generic discovery message
  service.socket.send(
    `{"method":"registration","params":{"phoneMac":"${MAC}","register":false,"phoneIp":"${ADDRESS}"}}`,
    BROADCAST_PORT,
    BROADCAST
  );

  // Send discovery message to listed devices
  if (Array.isArray(service.config.devices)) {
    for (const device of service.config.devices) {
      if (device.host) {
        log.info(`Sending discovery UDP broadcast to ${device.host}:${BROADCAST_PORT}`);
        service.socket.send(
          `{"method":"registration","params":{"phoneMac":"${MAC}","register":false,"phoneIp":"${ADDRESS}"}}`,
          BROADCAST_PORT,
          device.host
        );
      }
    }
  }
}
