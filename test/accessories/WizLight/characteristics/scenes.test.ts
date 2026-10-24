import { describe, expect, it } from "bun:test";
import { initScenes } from "../../../../src/accessories/WizLight/characteristics/scenes";
import {
  makeAccessoryWithService,
  makeDevice,
  makeFakeWiz,
} from "../../../__helpers__/factories";
import { FakeServiceCtors } from "../../../__mocks__/homebridge";

// initScenes is the only public surface for the scene-selection logic. Drive
// it with each device family and inspect the InputSource services that get
// added to the accessory — that's the observable side of the filtering.

const sceneIdsAdded = (accessory: any) =>
  accessory.services
    .filter((s: any) => s.UUID === FakeServiceCtors.InputSource.UUID)
    .map((s: any) => Number(s.getCharacteristic("Identifier").value))
    .sort((a: number, b: number) => a - b);

describe("scenes: enableScenes=false", () => {
  it("removes any existing Television service and adds no InputSource services", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    accessory.addService(FakeServiceCtors.Television, "scenes");

    initScenes(wiz, accessory as any, makeDevice({ model: "ESP01_SHRGB_03" }));

    expect(
      accessory.services.find(
        (s: any) => s.UUID === FakeServiceCtors.Television.UUID,
      ),
    ).toBeUndefined();
    expect(sceneIdsAdded(accessory)).toEqual([]);
  });

  it("removes a cached invalid Active characteristic from the Lightbulb service", () => {
    const wiz = makeFakeWiz({ enableScenes: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const lightbulb = accessory.getService(FakeServiceCtors.Lightbulb)!;
    lightbulb.getCharacteristic(wiz.Characteristic.Active);

    initScenes(wiz, accessory as any, makeDevice({ model: "ESP01_SHRGB_03" }));

    expect(lightbulb.testCharacteristic(wiz.Characteristic.Active)).toBe(false);
  });
});

describe("scenes: enableScenes=true device filtering", () => {
  it("adds the RGB scene set for SHRGB devices (includes RGB-only scenes)", () => {
    const wiz = makeFakeWiz({ enableScenes: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    initScenes(wiz, accessory as any, makeDevice({ model: "ESP01_SHRGB_03" }));

    const ids = sceneIdsAdded(accessory);
    // All 33 scenes are RGB-compatible (index 0..32)
    expect(ids).toEqual(Array.from({ length: 33 }, (_, i) => i));
  });

  it("adds the TW scene set for SHTW devices (excludes RGB-only ones)", () => {
    const wiz = makeFakeWiz({ enableScenes: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    initScenes(wiz, accessory as any, makeDevice({ model: "ESP10_SHTW_01" }));

    const ids = sceneIdsAdded(accessory);
    // TW includes only scenes whose compat array contains "TW".
    // From scenes.ts: 0, 6, 9, 10, 11, 12, 13, 14, 15, 16, 18, 29, 30, 31, 32
    expect(ids).toEqual([0, 6, 9, 10, 11, 12, 13, 14, 15, 16, 18, 29, 30, 31, 32]);
    // RGB-only scenes (Ocean=1, Romance=2, Forest=7, etc.) must not appear
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(7);
  });

  it("adds the DW (single-color) scene set for non-RGB, non-TW dimmer models", () => {
    const wiz = makeFakeWiz({ enableScenes: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    initScenes(wiz, accessory as any, makeDevice({ model: "ESP06_SHDW_01" }));

    const ids = sceneIdsAdded(accessory);
    // DW: 0, 9, 10, 13, 14, 29, 30, 31, 32
    expect(ids).toEqual([0, 9, 10, 13, 14, 29, 30, 31, 32]);
  });
});
