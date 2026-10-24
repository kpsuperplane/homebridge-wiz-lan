import { describe, expect, it } from "bun:test";
import WizLight from "../../../src/accessories/WizLight";
import {
  makeAccessoryWithService,
  makeDevice,
  makeFakeWiz,
} from "../../__helpers__/factories";
import { FakeServiceCtors } from "../../__mocks__/homebridge";

describe("WizLight.is — model predicates", () => {
  it.each([
    "ESP01_SHRGB_03",
    "ESP10_SHDW_01",
    "ESP10_SHTW_01",
    "ESP15_MHWRGB_01",
    "ESP06_DHRGB_01",
    "ESP17_MHORGB_01",
    "ESP25_SHORGB_01",
  ])("returns true for known light model %s", (model) => {
    expect(WizLight.is(makeDevice({ model }))).toBe(true);
  });

  it.each(["ESP10_SOCKET_06", "ESP25_SOCKET_01", "UNKNOWN_MODEL"])(
    "returns false for non-light model %s",
    (model) => {
      expect(WizLight.is(makeDevice({ model }))).toBe(false);
    },
  );
});

describe("WizLight.getName — friendly names", () => {
  const cases: Array<[string, string]> = [
    ["ESP01_SHRGB_03", "RGB Bulb"],
    ["ESP10_SHDW_01", "Dimmer Bulb"],
    ["ESP10_SHTW_01", "Tunable White Bulb"],
    ["ESP06_DHRGB_01", "Light Pole"],
    ["ESP15_MHWRGB_01", "LED String Lights"],
    ["ESP17_MHORGB_01", "Light Strip"],
    ["ESP25_SHORGB_01", "Light Strip"],
    ["UNKNOWN_FOO_BAR", "Unknown Bulb"],
  ];
  for (const [model, name] of cases) {
    it(`${model} -> "${name}"`, () => {
      expect(WizLight.getName(makeDevice({ model }))).toBe(name);
    });
  }
});

describe("WizLight.init — characteristic registration", () => {
  it("SHORGB strips expose on/off, brightness, and RGB controls (issue #165)", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP25_SHORGB_01" });
    expect(WizLight.is(device)).toBe(true);
    new (WizLight as any)(accessory, device, wiz).init();
    const service = accessory.getService(FakeServiceCtors.Lightbulb)!;
    for (const name of ["On", "Brightness", "Hue", "Saturation"]) {
      const characteristic = service.getCharacteristic(wiz.Characteristic[name]);
      expect(characteristic.listenerCount("get")).toBe(1);
      expect(characteristic.listenerCount("set")).toBe(1);
    }
    expect(accessory.getService(FakeServiceCtors.Outlet)).toBeUndefined();
  });

  it("RGB device registers Hue/Saturation + ColorTemperature on the Lightbulb service", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP01_SHRGB_03" });
    const light = new (WizLight as any)(accessory, device, wiz);
    light.init();
    const svc = accessory.getService(FakeServiceCtors.Lightbulb)!;
    expect(svc.characteristics.has("Hue")).toBe(true);
    expect(svc.characteristics.has("Saturation")).toBe(true);
    expect(svc.characteristics.has("ColorTemperature")).toBe(true);
  });

  it("TW (non-RGB) device registers ColorTemperature but not Hue/Saturation", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP10_SHTW_01" });
    const light = new (WizLight as any)(accessory, device, wiz);
    light.init();
    const svc = accessory.getService(FakeServiceCtors.Lightbulb)!;
    expect(svc.characteristics.has("ColorTemperature")).toBe(true);
    expect(svc.characteristics.has("Hue")).toBe(false);
    expect(svc.characteristics.has("Saturation")).toBe(false);
  });

  it("single-color dimmer registers neither ColorTemperature nor color characteristics", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP10_SHDW_01" });
    const light = new (WizLight as any)(accessory, device, wiz);
    light.init();
    const svc = accessory.getService(FakeServiceCtors.Lightbulb)!;
    expect(svc.characteristics.has("Hue")).toBe(false);
    expect(svc.characteristics.has("Saturation")).toBe(false);
    expect(svc.characteristics.has("ColorTemperature")).toBe(false);
  });

  it("On + Brightness are always registered", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP10_SHDW_01" });
    new (WizLight as any)(accessory, device, wiz).init();
    const svc = accessory.getService(FakeServiceCtors.Lightbulb)!;
    expect(svc.characteristics.has("On")).toBe(true);
    expect(svc.characteristics.has("Brightness")).toBe(true);
  });

  it("enableScenes=true causes a Television service to be added for RGB", () => {
    const wiz = makeFakeWiz({ enableScenes: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ model: "ESP01_SHRGB_03" });
    new (WizLight as any)(accessory, device, wiz).init();
    expect(accessory.getService(FakeServiceCtors.Television)).toBeDefined();
  });
});
