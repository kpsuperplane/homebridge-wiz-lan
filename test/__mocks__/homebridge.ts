import { EventEmitter } from "events";
import { mock } from "bun:test";

// Minimal stand-ins for the homebridge HAP surface that this plugin reaches
// into. Only the bits used by src/ are modelled — adding more is cheap.

export class FakeCharacteristic extends EventEmitter {
  public value: any = null;
  public updateValue = mock((v: any) => {
    this.value = v;
    return this;
  });
  public setValue = mock((v: any) => {
    this.value = v;
    return this;
  });
  public setCharacteristic = mock((_c: any, _v: any) => this);
  constructor(public readonly UUID: string) {
    super();
  }
}

export class FakeService extends EventEmitter {
  public characteristics: Map<any, FakeCharacteristic> = new Map();
  public linked: FakeService[] = [];
  public subtype?: string;
  constructor(
    public readonly UUID: string,
    public displayName?: string,
    subtype?: string,
  ) {
    super();
    this.subtype = subtype;
  }
  getCharacteristic = (key: any) => {
    if (!this.characteristics.has(key)) {
      this.characteristics.set(key, new FakeCharacteristic(String(key)));
    }
    return this.characteristics.get(key)!;
  };
  testCharacteristic = (key: any) => this.characteristics.has(key);
  setCharacteristic = (key: any, value: any) => {
    this.getCharacteristic(key).updateValue(value);
    return this;
  };
  removeCharacteristic = (ch: FakeCharacteristic) => {
    for (const [k, v] of this.characteristics.entries()) {
      if (v === ch) this.characteristics.delete(k);
    }
  };
  addLinkedService = (svc: FakeService) => {
    this.linked.push(svc);
  };
}

const makeServiceCtor = (uuid: string) => {
  const ctor = function (this: FakeService, name?: string, subtype?: string) {
    return new FakeService(uuid, name, subtype);
  } as unknown as { new (name?: string, subtype?: string): FakeService } & {
    UUID: string;
  };
  (ctor as any).UUID = uuid;
  return ctor;
};

export const FakeServiceCtors = {
  Lightbulb: makeServiceCtor("Lightbulb"),
  Outlet: makeServiceCtor("Outlet"),
  Television: makeServiceCtor("Television"),
  AccessoryInformation: makeServiceCtor("AccessoryInformation"),
  InputSource: makeServiceCtor("InputSource"),
} as const;

const charKey = (name: string) => name;
export const FakeCharacteristicCtors: Record<string, string> & {
  IsConfigured: { CONFIGURED: number };
  InputSourceType: { HDMI: number };
} = Object.assign(
  {
    On: charKey("On"),
    Brightness: charKey("Brightness"),
    ColorTemperature: charKey("ColorTemperature"),
    Hue: charKey("Hue"),
    Saturation: charKey("Saturation"),
    Active: charKey("Active"),
    ActiveIdentifier: charKey("ActiveIdentifier"),
    Identifier: charKey("Identifier"),
    ConfiguredName: charKey("ConfiguredName"),
    IsConfigured: charKey("IsConfigured"),
    InputSourceType: charKey("InputSourceType"),
    Name: charKey("Name"),
    Manufacturer: charKey("Manufacturer"),
    Model: charKey("Model"),
    SerialNumber: charKey("SerialNumber"),
  },
  {
    IsConfigured: { CONFIGURED: 1 } as any,
    InputSourceType: { HDMI: 3 } as any,
  },
) as any;

export class FakePlatformAccessory extends EventEmitter {
  public services: FakeService[] = [];
  public context: any = {};
  constructor(
    public displayName: string,
    public UUID: string,
  ) {
    super();
    // Every accessory in real HAP has an AccessoryInformation service.
    this.services.push(new FakeService("AccessoryInformation"));
  }
  getService = (key: any) => {
    const uuid = typeof key === "function" ? (key as any).UUID : key;
    return this.services.find((s) => s.UUID === uuid);
  };
  addService = (svcOrCtor: any, name?: string, subtype?: string) => {
    const svc: FakeService =
      svcOrCtor instanceof FakeService
        ? svcOrCtor
        : new (svcOrCtor as any)(name, subtype);
    if (subtype) svc.subtype = subtype;
    this.services.push(svc);
    return svc;
  };
  removeService = (svc: FakeService) => {
    this.services = this.services.filter((s) => s !== svc);
  };
  configureController = mock(() => {});
}

export class FakeAdaptiveLightingController extends EventEmitter {
  private active = true;
  public isAdaptiveLightingActive = mock(() => this.active);
  public disableAdaptiveLighting = mock(() => {
    this.active = false;
    this.emit("disable");
  });
  public getAdaptiveLightingUpdateInterval = mock(() => 60_000);
  constructor(public service: FakeService, public opts: any) {
    super();
  }
}

export class FakeHapStatusError extends Error {
  constructor(public readonly hapStatus: number) {
    super(`HAP error ${hapStatus}`);
  }
}

export const FakeHAPStatus = {
  SERVICE_COMMUNICATION_FAILURE: -70402,
  SUCCESS: 0,
} as const;

export const makeFakeAPI = () => {
  const api = new EventEmitter() as any;
  api.hap = {
    Service: FakeServiceCtors,
    Characteristic: FakeCharacteristicCtors,
    uuid: {
      generate: (input: string) => `uuid-${input}`,
    },
    AdaptiveLightingController: FakeAdaptiveLightingController,
    AdaptiveLightingControllerMode: { AUTOMATIC: 1 },
    HapStatusError: FakeHapStatusError,
    HAPStatus: FakeHAPStatus,
  };
  api.platformAccessory = FakePlatformAccessory;
  api.registerPlatform = mock(() => {});
  api.registerPlatformAccessories = mock(() => {});
  api.unregisterPlatformAccessories = mock(() => {});
  api.updatePlatformAccessories = mock(() => {});
  return api;
};

export const makeFakeLogger = () => ({
  debug: mock((..._args: any[]) => {}),
  info: mock((..._args: any[]) => {}),
  warn: mock((..._args: any[]) => {}),
  error: mock((..._args: any[]) => {}),
  log: mock((..._args: any[]) => {}),
});
