import {
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";

// Intercept the network module *before* importing pilot. Tests fire pending
// network callbacks manually to simulate UDP replies.
const pendingGet: ((e: Error | null, p: any) => void)[] = [];
const pendingSet: ((e: Error | null) => void)[] = [];
// Mirror the real layer's per-mac coalescing: the first unresolved call for a
// mac transmits the probe and later calls piggyback on it. Firing the
// transmitting call's callback closes the probe, like the real reply handler
// deleting the queue entry before running the batch. The transmitting call
// also runs `onTransmit`, which is how the accessory layer snapshots state as
// of the moment the packet goes on the wire.
const openGetProbes = new Set<string>();
const getPilotOptions: any[] = [];
const getPilotMock = mock(
  (
    _w: any,
    d: any,
    cb: (e: Error | null, p: any) => void,
    options?: { retransmit?: boolean; onTransmit?: () => void },
  ) => {
    getPilotOptions.push(options);
    const startedProbe = !openGetProbes.has(d.mac);
    if (startedProbe) {
      openGetProbes.add(d.mac);
      options?.onTransmit?.();
    }
    let fired = false;
    pendingGet.push((e, p) => {
      if (!fired) {
        fired = true;
        if (startedProbe) openGetProbes.delete(d.mac);
      }
      cb(e, p);
    });
  },
);
const setPilotMock = mock(
  (_w: any, _d: any, _p: any, cb: (e: Error | null) => void) => {
    pendingSet.push(cb);
  },
);

mock.module("../../../src/util/network", () => ({
  getPilot: getPilotMock,
  setPilot: setPilotMock,
  hasInFlightGetPilot: (mac: string) => openGetProbes.has(mac),
}));

import {
  cachedPilot,
  disabledAdaptiveLightingCallback,
  getPilot,
  pilotToColor,
  setPilot,
  updateColorTemp,
  writeGeneration,
} from "../../../src/accessories/WizLight/pilot";
import { isOffline, recordFailure, recordSuccess as _recordSuccess } from "../../../src/util/offline";
import {
  makeAccessoryWithService,
  makeDevice,
  makeFakeWiz,
  makeLightPilot,
} from "../../__helpers__/factories";
import { initOnOff } from "../../../src/accessories/WizLight/characteristics/onOff";
import { initScenes } from "../../../src/accessories/WizLight/characteristics/scenes";

const TEST_MAC = "AABBCCDDEEFF";

beforeEach(() => {
  for (const k of Object.keys(cachedPilot)) delete cachedPilot[k];
  for (const k of Object.keys(writeGeneration)) delete writeGeneration[k];
  for (const k of Object.keys(disabledAdaptiveLightingCallback))
    delete disabledAdaptiveLightingCallback[k];
  pendingGet.length = 0;
  pendingSet.length = 0;
  openGetProbes.clear();
  getPilotOptions.length = 0;
  getPilotMock.mockClear();
  setPilotMock.mockClear();
  // clear offline state for any MAC a test might use
  _recordSuccess(TEST_MAC);
  _recordSuccess(`${TEST_MAC}T1`);
  _recordSuccess(`${TEST_MAC}T2`);
  _recordSuccess(`${TEST_MAC}T3`);
  for (const s of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
    _recordSuccess(`${TEST_MAC}${s}`);
  }
});

describe("WizLight/pilot: pilotToColor", () => {
  it("derives hsv+temp from a temp-pilot", () => {
    const out = pilotToColor(makeLightPilot({ temp: 4000 }));
    expect(out.temp).toBe(4000);
    expect(out.hue).toBeGreaterThanOrEqual(0);
    expect(out.saturation).toBeGreaterThanOrEqual(0);
  });

  it("derives hsv+temp from an rgb-pilot", () => {
    const out = pilotToColor(makeLightPilot({ r: 255, g: 0, b: 0 }));
    expect(out.hue).toBe(0);
    expect(out.saturation).toBe(100);
  });

  it("treats missing rgb fields as 0", () => {
    const out = pilotToColor(makeLightPilot({ r: 50 } as any));
    expect(typeof out.hue).toBe("number");
    expect(typeof out.temp).toBe("number");
  });
});

describe("WizLight/pilot: getPilot success path", () => {
  it("populates cachedPilot and calls onSuccess", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    let received: any = null;
    getPilot(
      wiz,
      accessory as any,
      device,
      (p) => (received = p),
      () => {},
    );
    expect(pendingGet.length).toBe(1);
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, dimming: 80 }));
    expect(received).not.toBeNull();
    expect(cachedPilot[TEST_MAC]).toBeDefined();
    expect(cachedPilot[TEST_MAC].dimming).toBe(80);
  });

  it("uses on/off state to compute default dimming when neither reply nor cache has it", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    getPilot(
      wiz,
      accessory as any,
      device,
      () => {},
      () => {},
    );
    pendingGet[0](null, {
      mac: TEST_MAC,
      rssi: -50,
      src: "udp",
      state: false, // off
      // no dimming
    });
    expect(cachedPilot[TEST_MAC].dimming).toBe(10);
  });

  it("triggers disabled-adaptive-lighting callback when color/scene changed", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 10,
      g: 10,
      b: 10,
    });
    let adaptiveDisabled = false;
    disabledAdaptiveLightingCallback[TEST_MAC] = () => {
      adaptiveDisabled = true;
    };
    getPilot(
      wiz,
      accessory as any,
      device,
      () => {},
      () => {},
    );
    pendingGet[0](
      null,
      makeLightPilot({ mac: TEST_MAC, r: 200, g: 0, b: 0 }),
    );
    expect(adaptiveDisabled).toBe(true);
  });
});

describe("WizLight/pilot: error fallback & offline handling", () => {
  it("serves cached state (cache-first) and stays silent when the probe later errors under threshold", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: `${TEST_MAC}T1` });
    cachedPilot[device.mac] = makeLightPilot({ mac: device.mac, state: true });
    let received: any = null;
    const onError = mock((_: Error) => {});
    getPilot(
      wiz,
      accessory as any,
      device,
      (p) => (received = p),
      onError,
    );
    pendingGet[0](new Error("timeout"), null);
    expect(received).toBeDefined();
    expect(received.state).toBe(true);
    // The probe error must not surface after HomeKit was already answered.
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError when the network errors and no cache exists", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: `${TEST_MAC}T2` });
    let err: Error | null = null;
    getPilot(
      wiz,
      accessory as any,
      device,
      () => {},
      (e) => (err = e),
    );
    pendingGet[0](new Error("timeout"), null);
    expect(err).not.toBeNull();
  });

  it("marks device offline after pingFailuresBeforeOffline consecutive failures", () => {
    const wiz = makeFakeWiz({ pingFailuresBeforeOffline: 2 } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: `${TEST_MAC}T3` });
    let errSeen: Error | null = null;
    // First failure — not yet over threshold, falls through to cache-or-error
    getPilot(wiz, accessory as any, device, () => {}, (e) => (errSeen = e));
    pendingGet[0](new Error("timeout"), null);
    // No cache → onError fired with the original network error (not HAP)
    expect(errSeen).not.toBeNull();
    expect((errSeen as any).hapStatus).toBeUndefined();

    // Second failure — crosses threshold; should emit a HapStatusError
    errSeen = null;
    pendingGet.length = 0;
    getPilot(wiz, accessory as any, device, () => {}, (e) => (errSeen = e));
    pendingGet[0](new Error("timeout"), null);
    expect(errSeen).not.toBeNull();
    expect((errSeen as any).hapStatus).toBeDefined();
    // log.warn was called with "now offline" message
    expect(wiz.log.warn).toHaveBeenCalled();
  });
});

describe("WizLight/pilot: offline fast-path & recovery", () => {
  it("fast-path: offline device gets immediate HapStatusError before the UDP reply", () => {
    const mac = `${TEST_MAC}F1`;
    const wiz = makeFakeWiz({ pingFailuresBeforeOffline: 1 } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    // Mark offline first.
    recordFailure(mac, 1);
    expect(isOffline(mac)).toBe(true);

    let err: any = null;
    getPilot(wiz, accessory as any, device, () => {}, (e) => (err = e));
    // The onError must have fired synchronously, before any pending UDP reply.
    expect(err).not.toBeNull();
    expect(err.hapStatus).toBeDefined();
    // _getPilot was still called so recovery can be detected.
    expect(getPilotMock).toHaveBeenCalledTimes(1);
    expect(pendingGet.length).toBe(1);
  });

  it("fast-path suppression: only one onError when a still-offline device fails again", () => {
    const mac = `${TEST_MAC}F2`;
    const wiz = makeFakeWiz({ pingFailuresBeforeOffline: 1 } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    recordFailure(mac, 1);

    const onError = mock((_: Error) => {});
    getPilot(wiz, accessory as any, device, () => {}, onError);
    // Now fire the pending UDP reply with an error — recordFailure runs again
    // but threshold is already crossed (still offline), so onError must NOT
    // fire a second time.
    pendingGet[0](new Error("timeout"), null);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("recovery: offline device replying successfully triggers updatePilot and clears offline state", () => {
    const mac = `${TEST_MAC}F3`;
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    recordFailure(mac, 1);
    expect(isOffline(mac)).toBe(true);

    getPilot(wiz, accessory as any, device, () => {}, () => {});
    pendingGet[0](
      null,
      makeLightPilot({ mac, state: true, dimming: 75 }),
    );

    expect(isOffline(mac)).toBe(false);
    // "back online" info log
    expect(wiz.log.info).toHaveBeenCalled();
    // updatePilot pushed a fresh value into the On characteristic
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.On).updateValue)
      .toHaveBeenCalled();
  });

  it("setPilot fast-fails with HapStatusError when device is offline", () => {
    const mac = `${TEST_MAC}F4`;
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    cachedPilot[mac] = makeLightPilot({ mac, state: true });
    recordFailure(mac, 1);

    let err: any = null;
    setPilot(wiz, accessory as any, device, { state: false }, (e) => (err = e));
    expect(err).not.toBeNull();
    expect(err.hapStatus).toBeDefined();
    // No UDP packet attempted.
    expect(setPilotMock).not.toHaveBeenCalled();
    // Cache unchanged.
    expect(cachedPilot[mac].state).toBe(true);
  });

  it("threshold clamp: pingFailuresBeforeOffline=0 is clamped to 1 (single failure marks offline)", () => {
    const mac = `${TEST_MAC}F5`;
    const wiz = makeFakeWiz({ pingFailuresBeforeOffline: 0 } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });

    let err: any = null;
    getPilot(wiz, accessory as any, device, () => {}, (e) => (err = e));
    pendingGet[0](new Error("timeout"), null);
    // With clamp the single failure crosses threshold 1 — HapStatusError emitted.
    expect(err).not.toBeNull();
    expect(err.hapStatus).toBeDefined();
    expect(isOffline(mac)).toBe(true);
  });
});

describe("WizLight/pilot: cache-first responses", () => {
  it("answers synchronously from cache while the probe is still in flight", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, dimming: 60 });
    let received: any = null;
    getPilot(
      wiz,
      accessory as any,
      device,
      (p) => (received = p),
      () => {},
    );
    // Answered before any UDP reply was simulated...
    expect(received).not.toBeNull();
    expect(received.dimming).toBe(60);
    // ...while the probe is still in flight to refresh state.
    expect(pendingGet.length).toBe(1);
  });

  it("pushes the probe result to the characteristics after answering from cache", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    getPilot(
      wiz,
      accessory as any,
      device,
      () => {},
      () => {},
    );
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: true, dimming: 42 }));
    expect(cachedPilot[TEST_MAC].dimming).toBe(42);
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.On).updateValue)
      .toHaveBeenCalled();
    expect(svc.getCharacteristic(wiz.Characteristic.Brightness).updateValue)
      .toHaveBeenCalled();
  });

  it("counts a shared probe error once even when several callbacks coalesced on it", () => {
    const mac = `${TEST_MAC}F6`;
    const wiz = makeFakeWiz({ pingFailuresBeforeOffline: 2 } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    // Two HomeKit GETs coalesce onto one UDP probe; on timeout the network
    // layer hands the SAME Error instance to both callbacks.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    const shared = new Error("timeout");
    pendingGet[0](shared, null);
    pendingGet[1](shared, null);
    // One dropped packet = one failure, so threshold 2 is NOT crossed.
    expect(isOffline(mac)).toBe(false);

    // A second dropped probe (fresh Error) is a genuine second failure.
    pendingGet.length = 0;
    let err: any = null;
    getPilot(wiz, accessory as any, device, () => {}, (e) => (err = e));
    pendingGet[0](new Error("timeout"), null);
    expect(isOffline(mac)).toBe(true);
    expect(err.hapStatus).toBeDefined();
  });
});

// Regression guard for the UDP flood: 3.4.0 made every cache-answered read
// re-publish the probe result to HAP. Republishing a value HomeKit already
// holds still emits an event notification, controllers answer notifications by
// reading, and every read starts another probe — a feedback loop with a UDP
// packet in it. Only genuine changes may be published.
describe("WizLight/pilot: characteristic updates are change-driven", () => {
  const poll = (wiz: any, accessory: any, device: any, pilot: any) => {
    getPilot(wiz, accessory, device, () => {}, () => {});
    pendingGet[pendingGet.length - 1](null, pilot);
  };

  it("does not re-publish characteristics when the reply matches what HomeKit holds", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: true, dimming: 50 });
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    const on = svc.getCharacteristic(wiz.Characteristic.On);
    const brightness = svc.getCharacteristic(wiz.Characteristic.Brightness);

    const steady = () => makeLightPilot({ mac: TEST_MAC, state: true, dimming: 50 });
    // First poll publishes — HomeKit holds nothing yet.
    poll(wiz, accessory, device, steady());
    expect(on.updateValue).toHaveBeenCalledTimes(1);
    const brightnessPushes = (brightness.updateValue as any).mock.calls.length;

    // Four more polls, same state each time: nothing further goes to HAP.
    for (let i = 0; i < 4; i++) poll(wiz, accessory, device, steady());
    expect(on.updateValue).toHaveBeenCalledTimes(1);
    expect((brightness.updateValue as any).mock.calls.length).toBe(brightnessPushes);
  });

  it("still publishes when the state actually changes", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: true, dimming: 50 });
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    const on = svc.getCharacteristic(wiz.Characteristic.On);

    poll(wiz, accessory, device, makeLightPilot({ mac: TEST_MAC, state: true, dimming: 50 }));
    poll(wiz, accessory, device, makeLightPilot({ mac: TEST_MAC, state: false, dimming: 50 }));
    expect(on.updateValue).toHaveBeenCalledTimes(2);
    expect(on.value).toBe(0);
  });

  it("force-publishes when a device comes back, since HomeKit is holding an error", () => {
    const mac = `${TEST_MAC}_BACK`;
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac, model: "ESP01_SHRGB_03" });
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    const on = svc.getCharacteristic(wiz.Characteristic.On);

    // Establish the value HomeKit holds, then knock the device offline.
    cachedPilot[mac] = makeLightPilot({ mac, state: true, dimming: 50 });
    poll(wiz, accessory, device, makeLightPilot({ mac, state: true, dimming: 50 }));
    const before = (on.updateValue as any).mock.calls.length;
    recordFailure(mac, 1);

    // It recovers reporting exactly the value HomeKit already has. Equality
    // says "no change", but the tile is showing "No Response" — publish anyway.
    poll(wiz, accessory, device, makeLightPilot({ mac, state: true, dimming: 50 }));
    expect((on.updateValue as any).mock.calls.length).toBeGreaterThan(before);
    _recordSuccess(mac);
  });
});

describe("WizLight/pilot: probe retransmit is opt-in", () => {
  it("asks for a retransmit only when HomeKit is blocked on the reply", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC });

    // No cache: HomeKit is waiting, so the extra copy is worth its cost.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    expect(getPilotOptions[0].retransmit).toBe(true);

    // Cache warm: the GET was already answered, so a second copy buys nothing
    // visible and only doubles the load on a device that is answering slowly.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC }));
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    expect(getPilotOptions[1].retransmit).toBe(false);
  });

  it("does not retransmit at a device already known to be offline", () => {
    const mac = `${TEST_MAC}_OFF2`;
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac });
    recordFailure(mac, 1);
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    expect(getPilotOptions[0].retransmit).toBe(false);
    _recordSuccess(mac);
  });
});

describe("WizLight/pilot: setPilot scene/color exclusivity", () => {
  const baseDevice = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });

  it("returns an error to the callback when there is no cached state", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    let err: Error | null = null;
    setPilot(wiz, accessory as any, baseDevice, { state: true }, (e) => (err = e));
    expect(err).not.toBeNull();
    expect((err as any).message).toMatch(/No cached state/);
    expect(setPilotMock).not.toHaveBeenCalled();
  });

  it("setting sceneId clears r/g/b/temp on outgoing pilot", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 100,
      g: 50,
      b: 25,
      temp: 4000,
    });
    setPilot(wiz, accessory as any, baseDevice, { sceneId: 4 }, () => {});
    expect(setPilotMock).toHaveBeenCalledTimes(1);
    const sent = setPilotMock.mock.calls[0][2];
    expect(sent.sceneId).toBe(4);
    expect(sent.r).toBeUndefined();
    expect(sent.g).toBeUndefined();
    expect(sent.b).toBeUndefined();
    expect(sent.temp).toBeUndefined();
  });

  it("setting color clears sceneId/speed on outgoing pilot", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      sceneId: 4,
      speed: 50,
    } as any);
    setPilot(
      wiz,
      accessory as any,
      baseDevice,
      { r: 255, g: 0, b: 0 },
      () => {},
    );
    const sent = setPilotMock.mock.calls[0][2];
    expect(sent.r).toBe(255);
    expect(sent.sceneId).toBeUndefined();
    expect(sent.speed).toBeUndefined();
  });

  it("setting temp clears sceneId on outgoing pilot", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      sceneId: 4,
    } as any);
    setPilot(wiz, accessory as any, baseDevice, { temp: 3000 }, () => {});
    const sent = setPilotMock.mock.calls[0][2];
    expect(sent.temp).toBe(3000);
    expect(sent.sceneId).toBeUndefined();
  });

  it("with lastStatus=true and a state-only update, sends only {state}", () => {
    const wiz = makeFakeWiz({ lastStatus: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      dimming: 75,
      r: 1, g: 2, b: 3,
    });
    setPilot(wiz, accessory as any, baseDevice, { state: true }, () => {});
    const sent = setPilotMock.mock.calls[0][2];
    expect(sent).toEqual({ state: true });
  });

  it("reverts the cache when the network call returns an error", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const oldPilot = makeLightPilot({ mac: TEST_MAC, dimming: 50 });
    cachedPilot[TEST_MAC] = oldPilot;
    setPilot(
      wiz,
      accessory as any,
      baseDevice,
      { dimming: 100 },
      () => {},
    );
    // Cache should optimistically be updated
    expect(cachedPilot[TEST_MAC].dimming).toBe(100);
    // Now fire the network failure
    pendingSet[0](new Error("boom"));
    expect(cachedPilot[TEST_MAC]).toBe(oldPilot);
  });

  it("does not revert the cache when a newer write replaced it before the failure", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    setPilot(wiz, accessory as any, baseDevice, { state: true }, () => {});
    setPilot(wiz, accessory as any, baseDevice, { dimming: 80 }, () => {});
    // The second write owns the cache now; the first write's failure must not
    // restore the snapshot that predates both writes.
    pendingSet[0](new Error("ack timeout"));
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    expect(cachedPilot[TEST_MAC].dimming).toBe(80);
    // The second write succeeding leaves its own optimistic state in place.
    pendingSet[1](null);
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    expect(cachedPilot[TEST_MAC].dimming).toBe(80);
  });
});

describe("WizLight power controls: scene synchronization", () => {
  const setup = () => {
    const wiz = makeFakeWiz({ enableScenes: true } as any);
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });
    initOnOff(accessory as any, device, wiz);
    initScenes(wiz, accessory as any, device);
    return { wiz, accessory, device };
  };

  it("mirrors Lightbulb.On and Television.Active in either set direction", () => {
    const { wiz, accessory, device } = setup();
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: true });
    const lightbulb = accessory.getService(wiz.Service.Lightbulb)!;
    const television = accessory.getService(wiz.Service.Television)!;
    const on = lightbulb.getCharacteristic(wiz.Characteristic.On);
    const active = television.getCharacteristic(wiz.Characteristic.Active);

    let onError: Error | null | undefined;
    on.emit("set", false, (error: Error | null) => (onError = error));
    expect(onError).toBeUndefined();
    expect(on.value).toBeNull();
    expect(active.value).toBe(0);
    pendingSet[0](null);

    on.updateValue(false);
    let activeError: Error | null | undefined;
    active.emit("set", true, (error: Error | null) => (activeError = error));
    expect(activeError).toBeUndefined();
    expect(on.value).toBe(true);
    expect(active.value).toBe(0);
    pendingSet[1](null);
  });

  it("does not republish an unchanged counterpart on repeated sets", () => {
    const { wiz, accessory } = setup();
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: true });
    const lightbulb = accessory.getService(wiz.Service.Lightbulb)!;
    const television = accessory.getService(wiz.Service.Television)!;
    const on = lightbulb.getCharacteristic(wiz.Characteristic.On);
    const active = television.getCharacteristic(wiz.Characteristic.Active);

    on.emit("set", false, () => {});
    pendingSet[0](null);
    const activeUpdates = (active.updateValue as any).mock.calls.length;

    on.emit("set", false, () => {});
    pendingSet[1](null);
    expect((active.updateValue as any).mock.calls.length).toBe(activeUpdates);
    expect((on.updateValue as any).mock.calls.length).toBe(0);
  });

  it("does not republish an unchanged counterpart on repeated GETs", () => {
    const { wiz, accessory, device } = setup();
    const lightbulb = accessory.getService(wiz.Service.Lightbulb)!;
    const television = accessory.getService(wiz.Service.Television)!;
    const on = lightbulb.getCharacteristic(wiz.Characteristic.On);
    const active = television.getCharacteristic(wiz.Characteristic.Active);

    let first: boolean | undefined;
    on.emit("get", (error: Error | null, value: boolean) => {
      expect(error).toBeNull();
      first = value;
    });
    pendingGet[0](null, makeLightPilot({ mac: device.mac, state: true }));
    expect(first).toBe(true);
    expect((on.updateValue as any).mock.calls.length).toBe(0);
    const activeUpdates = (active.updateValue as any).mock.calls.length;

    let second: boolean | undefined;
    on.emit("get", (error: Error | null, value: boolean) => {
      expect(error).toBeNull();
      second = value;
    });
    expect(second).toBe(true);
    expect((active.updateValue as any).mock.calls.length).toBe(activeUpdates);
  });

  it("reconciles both controls after a failed write", () => {
    const { wiz, accessory, device } = setup();
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: true });
    const lightbulb = accessory.getService(wiz.Service.Lightbulb)!;
    const television = accessory.getService(wiz.Service.Television)!;
    const on = lightbulb.getCharacteristic(wiz.Characteristic.On);
    const active = television.getCharacteristic(wiz.Characteristic.Active);

    let error: Error | null | undefined;
    on.emit("set", false, (e: Error | null) => (error = e));
    expect(on.value).toBeNull();
    expect(active.value).toBe(0);

    const writeError = new Error("timeout");
    pendingSet[0](writeError);
    expect(error).toBe(writeError);
    expect(pendingGet.length).toBe(1);

    for (const pending of pendingGet.splice(0)) {
      pending(null, makeLightPilot({ mac: TEST_MAC, state: true }));
    }
    expect(on.value).toBe(1);
    expect(active.value).toBe(1);
  });

  it("probes and reconciles when a setter runs before the first GET", () => {
    const { wiz, accessory, device } = setup();
    const lightbulb = accessory.getService(wiz.Service.Lightbulb)!;
    const television = accessory.getService(wiz.Service.Television)!;
    const on = lightbulb.getCharacteristic(wiz.Characteristic.On);
    const active = television.getCharacteristic(wiz.Characteristic.Active);

    let error: Error | null | undefined;
    on.emit("set", false, (e: Error | null) => (error = e));
    expect(error?.message).toMatch(/No cached state/);
    expect(on.value).toBeNull();
    expect(active.value).toBe(0);
    expect(pendingGet.length).toBe(1);

    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: true }));
    expect(on.value).toBe(1);
    expect(active.value).toBe(1);
  });
});

describe("WizLight/pilot: stale probe replies vs. interleaved writes", () => {
  const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });

  it("discards a delayed pre-write probe reply that lands after a setPilot ack", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    // HomeKit GET is answered from cache; the probe stays in flight.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    expect(pendingGet.length).toBe(1);
    // The user flips the tile on; the write is acked before the reply lands.
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](null);
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    // Now the delayed probe reply arrives carrying pre-write state.
    pendingGet[0](
      null,
      makeLightPilot({ mac: TEST_MAC, state: false, dimming: 20 }),
    );
    // It must neither clobber the cache…
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    // …nor push the old value back to the HomeKit characteristics.
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.On).updateValue)
      .not.toHaveBeenCalled();
    expect(svc.getCharacteristic(wiz.Characteristic.Brightness).updateValue)
      .not.toHaveBeenCalled();
  });

  it("does not disable adaptive lighting off a stale reply's old color", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 10,
      g: 10,
      b: 10,
    });
    let adaptiveDisabled = false;
    disabledAdaptiveLightingCallback[TEST_MAC] = () => {
      adaptiveDisabled = true;
    };
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    setPilot(wiz, accessory as any, device, { r: 200, g: 0, b: 0 }, () => {});
    pendingSet[0](null);
    // The stale reply repeats the pre-write color, which differs from the
    // post-write cache — without the generation guard that difference reads
    // as an external change and kills adaptive lighting.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, r: 10, g: 10, b: 10 }));
    expect(adaptiveDisabled).toBe(false);
    expect(cachedPilot[TEST_MAC].r).toBe(200);
  });

  it("commits replies from probes started after the write (cache self-heals)", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](null);
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: false, dimming: 20 }));
    // A probe started after the write is not stale: its reply is device truth.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    pendingGet[1](null, makeLightPilot({ mac: TEST_MAC, state: true, dimming: 35 }));
    expect(cachedPilot[TEST_MAC].dimming).toBe(35);
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.Brightness).updateValue)
      .toHaveBeenCalled();
  });

  it("still discards the stale reply when the interleaved write failed and rolled back", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const oldPilot = makeLightPilot({ mac: TEST_MAC, state: false, dimming: 20 });
    cachedPilot[TEST_MAC] = oldPilot;
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](new Error("ack timeout"));
    expect(cachedPilot[TEST_MAC]).toBe(oldPilot);
    // A timed-out write may still have reached the bulb (lost ack), so this
    // reply — generated before the write — remains untrustworthy.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: false, dimming: 55 }));
    expect(cachedPilot[TEST_MAC]).toBe(oldPilot);
    expect(cachedPilot[TEST_MAC].dimming).toBe(20);
  });

  it("answers a still-waiting GET with post-write cache state when the reply is stale", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    // No cache at probe start → the GET stays unanswered until the reply.
    let received: any = null;
    getPilot(wiz, accessory as any, device, (p) => (received = p), () => {});
    expect(received).toBeNull();
    // Cache gets seeded and a write races in while the probe is still out.
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: false });
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](null);
    // The stale reply must still resolve the GET — with the newer state.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: false }));
    expect(received).not.toBeNull();
    expect(received.state).toBe(true);
  });

  it("a setPilot that fails before transmitting does not mark probes stale", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    let received: any = null;
    getPilot(wiz, accessory as any, device, (p) => (received = p), () => {});
    // No cached state → this write errors out synchronously, nothing is sent.
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    expect(setPilotMock).not.toHaveBeenCalled();
    // The probe reply is not stale — no write actually went out.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: true, dimming: 66 }));
    expect(received).not.toBeNull();
    expect(received.dimming).toBe(66);
    expect(cachedPilot[TEST_MAC].dimming).toBe(66);
  });

  it("discards the stale reply for callers that piggybacked onto the probe after the write", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    // Caller A transmits the probe before the write.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    // The write goes out and is acked while the probe is still open.
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](null);
    // Caller B lands inside the probe window and piggybacks (the real layer
    // sends no new packet) — it must inherit the probe's pre-write snapshot,
    // not read the post-write generation and trust the shared reply.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    // The shared pre-write reply resolves the whole batch.
    const staleReply = makeLightPilot({ mac: TEST_MAC, state: false, dimming: 20 });
    pendingGet[0](null, staleReply);
    pendingGet[1](null, staleReply);
    expect(cachedPilot[TEST_MAC].state).toBe(true);
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.On).updateValue)
      .not.toHaveBeenCalled();
    // A probe transmitted after the write still converges the cache.
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    pendingGet[2](null, makeLightPilot({ mac: TEST_MAC, state: true, dimming: 35 }));
    expect(cachedPilot[TEST_MAC].dimming).toBe(35);
  });
});

describe("WizLight/pilot: failed-write resync", () => {
  const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });

  it("probes the device after a failed write so the cache converges on truth", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      state: false,
      dimming: 20,
    });
    setPilot(wiz, accessory as any, device, { dimming: 80 }, () => {});
    expect(pendingGet.length).toBe(0);
    pendingSet[0](new Error("ack timeout"));
    // Cache rolled back...
    expect(cachedPilot[TEST_MAC].dimming).toBe(20);
    // ...and a resync probe went out. The lost-ack write actually applied:
    expect(pendingGet.length).toBe(1);
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, state: false, dimming: 80 }));
    expect(cachedPilot[TEST_MAC].dimming).toBe(80);
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.Brightness).updateValue)
      .toHaveBeenCalled();
  });

  it("does not probe after a successful write", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC, state: false });
    setPilot(wiz, accessory as any, device, { state: true }, () => {});
    pendingSet[0](null);
    expect(pendingGet.length).toBe(0);
  });
});

describe("WizLight/pilot: sceneId normalization", () => {
  const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });

  it("a reply that omits sceneId with unchanged colors does not disable adaptive lighting", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 10,
      g: 10,
      b: 10,
    });
    let adaptiveDisabled = false;
    disabledAdaptiveLightingCallback[TEST_MAC] = () => {
      adaptiveDisabled = true;
    };
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    // Firmware that reports "no scene" as a missing sceneId (not 0) must be
    // treated like sceneId 0, matching updatePilot's useCT check.
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, r: 10, g: 10, b: 10 }));
    expect(adaptiveDisabled).toBe(false);
  });

  it("still disables adaptive lighting when a sceneId-less reply shows a real color change", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 10,
      g: 10,
      b: 10,
    });
    let adaptiveDisabled = false;
    disabledAdaptiveLightingCallback[TEST_MAC] = () => {
      adaptiveDisabled = true;
    };
    getPilot(wiz, accessory as any, device, () => {}, () => {});
    pendingGet[0](null, makeLightPilot({ mac: TEST_MAC, r: 200, g: 0, b: 0 }));
    expect(adaptiveDisabled).toBe(true);
  });
});

describe("WizLight/pilot: updateColorTemp", () => {
  it("for RGB devices, updates hue/saturation/temperature characteristics on success", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });
    cachedPilot[TEST_MAC] = makeLightPilot({
      mac: TEST_MAC,
      r: 0,
      g: 255,
      b: 0,
    });
    const next = mock(() => {});
    const callback = updateColorTemp(device, accessory as any, wiz, next);
    callback(null);

    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(svc.getCharacteristic(wiz.Characteristic.Hue).updateValue)
      .toHaveBeenCalled();
    expect(
      svc.getCharacteristic(wiz.Characteristic.Saturation).updateValue,
    ).toHaveBeenCalled();
    expect(
      svc.getCharacteristic(wiz.Characteristic.ColorTemperature).updateValue,
    ).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(null);
  });

  it("skips characteristic updates for non-RGB/non-TW devices but still calls next", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP06_SHDW_01" });
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC });
    const next = mock(() => {});
    const callback = updateColorTemp(device, accessory as any, wiz, next);
    callback(null);
    const svc = accessory.getService(wiz.Service.Lightbulb)!;
    expect(
      svc.getCharacteristic(wiz.Characteristic.ColorTemperature).updateValue,
    ).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(null);
  });

  it("propagates error to next() without touching characteristics", () => {
    const wiz = makeFakeWiz();
    const accessory = makeAccessoryWithService("Lightbulb");
    const device = makeDevice({ mac: TEST_MAC, model: "ESP01_SHRGB_03" });
    cachedPilot[TEST_MAC] = makeLightPilot({ mac: TEST_MAC });
    const next = mock(() => {});
    const err = new Error("set failed");
    updateColorTemp(device, accessory as any, wiz, next)(err);
    expect(next).toHaveBeenCalledWith(err);
  });
});
