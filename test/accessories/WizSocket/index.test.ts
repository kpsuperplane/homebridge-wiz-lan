import { describe, expect, it } from "bun:test";
// Import via the accessories barrel first so WizLight has fully loaded by the
// time we reach WizSocket — otherwise the barrel's `import WizSocket from
// "./WizSocket"` line still has an unbound local while WizSocket/index.ts
// imports from `..` during evaluation.
import Accessories from "../../../src/accessories";
const WizSocket = Accessories[1] as any;
import {
  makeDevice,
  makeFakeWiz,
} from "../../__helpers__/factories";
import {
  FakePlatformAccessory,
  FakeServiceCtors,
} from "../../__mocks__/homebridge";

describe("WizSocket.is — socket predicates", () => {
  it.each(["ESP10_SOCKET_01", "ESP10_SOCKET_06", "ESP25_SOCKET_01"])(
    "returns true for socket model %s",
    (model) => {
      expect(WizSocket.is(makeDevice({ model }))).toBe(true);
    },
  );

  it.each([
    "ESP01_SHRGB_03",
    "ESP10_SHTW_01",
    "ESP20_DHRGB_01", // light pole, not a socket
  ])("returns false for non-socket model %s", (model) => {
    expect(WizSocket.is(makeDevice({ model }))).toBe(false);
  });
});

describe("WizSocket.getName", () => {
  it('always returns "Wiz Socket"', () => {
    expect(WizSocket.getName(makeDevice())).toBe("Wiz Socket");
    expect(WizSocket.getName(makeDevice({ model: "anything" }))).toBe(
      "Wiz Socket",
    );
  });
});

describe("WizSocket.init", () => {
  it("registers the Outlet service and On characteristic, nothing else", () => {
    const wiz = makeFakeWiz();
    const accessory = new FakePlatformAccessory(
      "Socket Test",
      "uuid-socket-1",
    );
    accessory.addService(FakeServiceCtors.Outlet, "Socket Test");
    const device = makeDevice({ model: "ESP10_SOCKET_06" });
    new (WizSocket as any)(accessory, device, wiz).init();
    const svc = accessory.getService(FakeServiceCtors.Outlet)!;
    expect(svc.characteristics.has("On")).toBe(true);
    expect(svc.characteristics.has("Brightness")).toBe(false);
    expect(svc.characteristics.has("Hue")).toBe(false);
  });

  it("creates the Outlet service if it doesn't already exist", () => {
    const wiz = makeFakeWiz();
    const accessory = new FakePlatformAccessory("Bare", "uuid-bare");
    // No Outlet service pre-added
    const device = makeDevice({ model: "ESP25_SOCKET_01" });
    new (WizSocket as any)(accessory, device, wiz).init();
    expect(accessory.getService(FakeServiceCtors.Outlet)).toBeDefined();
  });
});
