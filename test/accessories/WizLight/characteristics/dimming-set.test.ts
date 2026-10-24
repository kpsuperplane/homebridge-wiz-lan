import { beforeEach, describe, expect, it, mock } from "bun:test";

const pendingSet: ((error: Error | null) => void)[] = [];
const setPilotMock = mock(
  (
    _wiz: any,
    _device: any,
    _pilot: any,
    callback: (error: Error | null) => void,
  ) => {
    pendingSet.push(callback);
  },
);

mock.module("../../../../src/util/network", () => ({
  getPilot: mock(),
  setPilot: setPilotMock,
  hasInFlightGetPilot: () => false,
}));

import { initDimming } from "../../../../src/accessories/WizLight/characteristics/dimming";
import { initOnOff } from "../../../../src/accessories/WizLight/characteristics/onOff";
import {
  cachedPilot,
  writeGeneration,
} from "../../../../src/accessories/WizLight/pilot";
import {
  makeAccessoryWithService,
  makeDevice,
  makeFakeWiz,
  makeLightPilot,
} from "../../../__helpers__/factories";

const TEST_MAC = "AABBCCDDEEFF";

beforeEach(() => {
  for (const key of Object.keys(cachedPilot)) delete cachedPilot[key];
  for (const key of Object.keys(writeGeneration)) delete writeGeneration[key];
  pendingSet.length = 0;
  setPilotMock.mockClear();
});

describe("Brightness zero/off semantics", () => {
  it("sends state=false and restores the prior dimming on the next On", () => {
    const wiz = makeFakeWiz({ lastStatus: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: true,
      dimming: 55,
    });
    initDimming(accessory as any, device, wiz);
    initOnOff(accessory as any, device, wiz);

    const service = accessory.getService(wiz.Service.Lightbulb)!;
    service
      .getCharacteristic(wiz.Characteristic.Brightness)
      .emit("set", 0, () => {});

    expect(setPilotMock).toHaveBeenCalledTimes(1);
    const offPayload = setPilotMock.mock.calls[0][2];
    expect(offPayload.state).toBe(false);
    expect(offPayload.dimming).toBe(55);
    expect(cachedPilot[TEST_MAC].state).toBe(false);
    expect(cachedPilot[TEST_MAC].dimming).toBe(55);

    pendingSet[0](null);
    service.getCharacteristic(wiz.Characteristic.On).emit("set", true, () => {});

    expect(setPilotMock).toHaveBeenCalledTimes(2);
    const onPayload = setPilotMock.mock.calls[1][2];
    expect(onPayload.state).toBe(true);
    expect(onPayload.dimming).toBe(55);
  });

  it("lets lastStatus use the device's remembered brightness while keeping it in cache", () => {
    const wiz = makeFakeWiz({ lastStatus: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: true,
      dimming: 75,
    });
    initDimming(accessory as any, device, wiz);
    initOnOff(accessory as any, device, wiz);

    const service = accessory.getService(wiz.Service.Lightbulb)!;
    service
      .getCharacteristic(wiz.Characteristic.Brightness)
      .emit("set", 0, () => {});

    expect(setPilotMock.mock.calls[0][2]).toEqual({ state: false });
    expect(cachedPilot[TEST_MAC].state).toBe(false);
    expect(cachedPilot[TEST_MAC].dimming).toBe(75);

    pendingSet[0](null);
    service.getCharacteristic(wiz.Characteristic.On).emit("set", true, () => {});
    expect(setPilotMock.mock.calls[1][2]).toEqual({ state: true });
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    expect(cachedPilot[TEST_MAC].dimming).toBe(75);
  });

  it("restores full brightness when a legacy off cache has no usable dimming", () => {
    const wiz = makeFakeWiz({ lastStatus: false } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 0,
    });
    initOnOff(accessory as any, device, wiz);

    accessory
      .getService(wiz.Service.Lightbulb)!
      .getCharacteristic(wiz.Characteristic.On)
      .emit("set", true, () => {});

    expect(setPilotMock).toHaveBeenCalledTimes(1);
    expect(setPilotMock.mock.calls[0][2]).toMatchObject({
      state: true,
      dimming: 100,
    });
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    expect(cachedPilot[TEST_MAC].dimming).toBe(100);
  });
});
