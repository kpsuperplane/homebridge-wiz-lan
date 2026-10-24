import {
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { FakeSocket, makeDevice } from "./__helpers__/factories";
import { makeFakeAPI, makeFakeLogger } from "./__mocks__/homebridge";

// Only mock the dgram package so HomebridgeWizLan's constructor doesn't open
// a real UDP socket. The real util/network functions then operate on our
// FakeSocket — keeping the surface untouched for other test files.
const sharedSocket = new FakeSocket();
// Every platform instance attaches its own error/message listeners to this one
// shared socket, so the default limit of 10 trips a spurious warning once the
// file has more than a handful of tests.
sharedSocket.setMaxListeners(0);
mock.module("dgram", () => ({
  default: { createSocket: () => sharedSocket as any },
  createSocket: () => sharedSocket as any,
}));

import HomebridgeWizLan from "../src/wiz";

const makePlatform = (config: any = {}) => {
  const api = makeFakeAPI();
  const log = makeFakeLogger();
  const platform = new HomebridgeWizLan(log as any, config, api);
  return { platform, api, log };
};

beforeEach(() => {
  sharedSocket.sent.length = 0;
});

describe("HomebridgeWizLan.constructor", () => {
  it("attaches the dgram socket to the platform", () => {
    const { platform } = makePlatform();
    expect(platform.socket).toBe(sharedSocket as any);
  });

  it("starts discovery when api emits didFinishLaunching", () => {
    const { api } = makePlatform();
    api.emit("didFinishLaunching");
    // sendDiscoveryBroadcast emits a registration message
    const reg = sharedSocket.sent.find((s) => s.msg.includes("registration"));
    expect(reg).toBeDefined();
  });

});

describe("HomebridgeWizLan.initDiscoveryInterval", () => {
  it("logs setup message when discoveryInterval is positive", () => {
    const { api, log } = makePlatform({ discoveryInterval: 30 });
    api.emit("didFinishLaunching");
    const setupMsg = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Re-broadcasting every 30"));
    expect(setupMsg).toBeDefined();
  });

  it("logs 'periodic re-discovery is off' when not configured", () => {
    const { api, log } = makePlatform({});
    api.emit("didFinishLaunching");
    const offMsg = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Periodic re-discovery is off"));
    expect(offMsg).toBeDefined();
  });
});

describe("HomebridgeWizLan.initDiscoveryInterval: broadcast floor", () => {
  it("clamps a discoveryInterval below the minimum and says so", () => {
    // Discovery is a subnet-wide broadcast; every host takes an interrupt for
    // it, so a typo here must not become a broadcast storm.
    const { api, log } = makePlatform({ discoveryInterval: 1 });
    api.emit("didFinishLaunching");
    const warning = (log.warn as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("below the"));
    expect(warning).toBeDefined();
    const setup = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Re-broadcasting every"));
    expect(setup).toContain("5 seconds");
  });

  it("leaves a sane discoveryInterval alone", () => {
    const { api, log } = makePlatform({ discoveryInterval: 30 });
    api.emit("didFinishLaunching");
    const setup = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Re-broadcasting every"));
    expect(setup).toContain("30 seconds");
  });
});

describe("HomebridgeWizLan.deviceShouldBeIgnored", () => {
  it("matches by MAC", () => {
    const { platform } = makePlatform({
      ignoredDevices: [{ mac: "AABBCCDDEEFF" }],
    });
    expect(
      platform.deviceShouldBeIgnored(
        makeDevice({ mac: "AABBCCDDEEFF", ip: "10.0.0.5" }),
      ),
    ).toBe(true);
  });

  it("matches by IP (host field)", () => {
    const { platform } = makePlatform({
      ignoredDevices: [{ host: "10.0.0.5" }],
    });
    expect(
      platform.deviceShouldBeIgnored(
        makeDevice({ mac: "OTHERMAC", ip: "10.0.0.5" }),
      ),
    ).toBe(true);
  });

  it("does not match unrelated devices", () => {
    const { platform } = makePlatform({
      ignoredDevices: [{ mac: "ZZZ" }],
    });
    expect(
      platform.deviceShouldBeIgnored(
        makeDevice({ mac: "AAA", ip: "1.1.1.1" }),
      ),
    ).toBe(false);
  });

  it("returns false when ignoredDevices is unset", () => {
    const { platform } = makePlatform({});
    expect(platform.deviceShouldBeIgnored(makeDevice())).toBe(false);
  });
});

describe("HomebridgeWizLan.tryAddDevice", () => {
  it("registers ESP10_SOCKET_01 as an outlet (issue #153)", () => {
    const { platform, api, log } = makePlatform();
    const device = makeDevice({ mac: "SOCKET153", model: "ESP10_SOCKET_01" });
    platform.tryAddDevice(device);

    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    const accessory = platform.accessories[0];
    expect(platform.initializedAccessories[accessory.UUID]).toBeDefined();
    const outlet = accessory.getService(platform.Service.Outlet)!;
    expect(outlet).toBeDefined();
    expect(outlet.getCharacteristic(platform.Characteristic.On).listenerCount("get")).toBe(1);
    expect(outlet.getCharacteristic(platform.Characteristic.On).listenerCount("set")).toBe(1);
    expect(accessory.getService(platform.Service.Lightbulb)).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("registers a new accessory for an unseen RGB bulb", () => {
    const { platform, api } = makePlatform({});
    platform.tryAddDevice(
      makeDevice({ mac: "NEW1", ip: "10.0.0.10", model: "ESP01_SHRGB_03" }),
    );
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(platform.accessories.length).toBe(1);
    expect(Object.keys(platform.initializedAccessories).length).toBe(1);
  });

  it("updates an existing accessory rather than re-registering", () => {
    const { platform, api } = makePlatform({});
    const device = makeDevice({
      mac: "EXIST1",
      ip: "10.0.0.11",
      model: "ESP01_SHRGB_03",
    });
    platform.tryAddDevice(device);
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);

    // re-add the same device — should be an update, not a re-register
    platform.tryAddDevice(device);
    expect(api.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    expect(api.updatePlatformAccessories).toHaveBeenCalled();
  });

  it("skips devices whose model is unrecognized", () => {
    const { platform, api, log } = makePlatform({});
    platform.tryAddDevice(
      makeDevice({ mac: "ALIEN", ip: "10.0.0.12", model: "XYZ_NOT_REAL" }),
    );
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalled();
  });

  it("uses the friendly name override from config.devices when MAC matches", () => {
    const { platform, api } = makePlatform({
      devices: [{ mac: "OVR1", name: "Kitchen Lamp" }],
    });
    platform.tryAddDevice(
      makeDevice({ mac: "OVR1", ip: "10.0.0.13", model: "ESP01_SHRGB_03" }),
    );
    const registered = (api.registerPlatformAccessories as any).mock
      .calls[0][2][0];
    expect(registered.displayName).toBe("Kitchen Lamp");
  });

  it("skips ignored devices (matched by MAC) without registering", () => {
    const { platform, api } = makePlatform({
      ignoredDevices: [{ mac: "IGN1" }],
    });
    platform.tryAddDevice(
      makeDevice({ mac: "IGN1", ip: "10.0.0.14", model: "ESP01_SHRGB_03" }),
    );
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it("keys initializedAccessories by UUID (the #128 refactor)", () => {
    const { platform, api } = makePlatform({});
    platform.tryAddDevice(
      makeDevice({ mac: "U1", ip: "10.0.0.15", model: "ESP01_SHRGB_03" }),
    );
    const uuid = api.hap.uuid.generate("U1");
    expect(platform.initializedAccessories[uuid]).toBeDefined();
  });
});

describe("HomebridgeWizLan.configureAccessory", () => {
  it("restores ESP10_SOCKET_01 as an outlet (issue #153)", () => {
    const { platform, api } = makePlatform();
    const accessory = new api.platformAccessory("Cached Socket", "uuid-socket153");
    accessory.context = makeDevice({ mac: "CACHED153", model: "ESP10_SOCKET_01" });
    platform.configureAccessory(accessory);

    expect(platform.initializedAccessories[accessory.UUID]).toBeDefined();
    expect(accessory.getService(platform.Service.Outlet)).toBeDefined();
    expect(accessory.getService(platform.Service.Lightbulb)).toBeUndefined();
    expect(api.registerPlatformAccessories).not.toHaveBeenCalled();
  });

  it("loads cached accessories and initializes them", () => {
    const { platform, api } = makePlatform({});
    const acc = new api.platformAccessory("Cached Bulb", "uuid-cached");
    acc.context = makeDevice({
      mac: "CACHED1",
      ip: "10.0.0.16",
      model: "ESP01_SHRGB_03",
    });
    platform.configureAccessory(acc as any);
    expect(platform.accessories).toContain(acc);
    expect(platform.initializedAccessories["uuid-cached"]).toBeDefined();
  });

  it("unregisters ignored accessories on load", () => {
    const { platform, api } = makePlatform({
      ignoredDevices: [{ mac: "IGN_CACHED" }],
    });
    const acc = new api.platformAccessory("Bulb", "uuid-ignored");
    acc.context = makeDevice({ mac: "IGN_CACHED", ip: "10.0.0.17" });
    platform.configureAccessory(acc as any);
    expect(api.unregisterPlatformAccessories).toHaveBeenCalled();
    expect(platform.accessories).not.toContain(acc);
  });

  it("skips accessories whose context is missing a model (legacy schema)", () => {
    const { platform, api } = makePlatform({});
    const acc = new api.platformAccessory("Legacy", "uuid-legacy");
    acc.context = {} as any;
    platform.configureAccessory(acc as any);
    expect(platform.initializedAccessories["uuid-legacy"]).toBeUndefined();
  });
});

describe("HomebridgeWizLan.initRefreshInterval", () => {
  it("does not schedule any timer when refreshInterval=0 (default)", () => {
    const { platform, log } = makePlatform({});
    // No throws, and at least one info log mentions Pings are off
    const offMsg = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Pings are off"));
    expect(offMsg).toBeDefined();
    // No accessories ping after a moment
    expect(Object.keys(platform.initializedAccessories).length).toBe(0);
  });

  it("logs setup message when refreshInterval is positive", () => {
    const { log } = makePlatform({ refreshInterval: 30 });
    const setupMsg = (log.info as any).mock.calls
      .map((c: any[]) => String(c[0]))
      .find((m: string) => m.includes("Setting up ping"));
    expect(setupMsg).toBeDefined();
  });

  it("spreads the sweep instead of probing every device in one tick", async () => {
    // A synchronous burst of N probes is what a flood looks like on the wire,
    // and the correlated loss it causes is what makes bulbs miss their
    // deadline and flap to "No Response".
    const { platform, api } = makePlatform({ refreshInterval: 1 });
    const pinged: string[] = [];
    for (const name of ["a", "b", "c", "d", "e"]) {
      platform.initializedAccessories[name] = {
        getPilot: () => {
          pinged.push(name);
          return Promise.resolve({} as any);
        },
      } as any;
    }

    await new Promise((r) => setTimeout(r, 1050));
    // The tick fires the first device immediately and staggers the rest.
    expect(pinged.length).toBe(1);
    await new Promise((r) => setTimeout(r, 450));
    expect(pinged.length).toBe(5);
    api.emit("shutdown");
  }, 10000);
});
