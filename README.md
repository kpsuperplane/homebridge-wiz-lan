# homebridge-wiz-lan

A Homebridge plugin to control Wiz devices over your local network (no cloud required).

Fork of [kpsuperplane/homebridge-wiz-lan](https://github.com/kpsuperplane/homebridge-wiz-lan) with additional fixes and features.

## Supported Devices

The plugin auto-discovers devices on your LAN and matches them by module name.

### Lights (exposed as `Lightbulb`)

| Module name contains | HomeKit name | Capabilities |
|---|---|---|
| `SHRGB` | RGB Bulb | On/Off · Brightness · Color Temp · Hue/Saturation · Adaptive Lighting · Scenes |
| `SHTW` | Tunable White Bulb | On/Off · Brightness · Color Temp · Adaptive Lighting · Scenes |
| `SHDW` | Dimmer Bulb | On/Off · Brightness · Scenes |
| `MHWRGB` | LED String Lights | Same as RGB Bulb |
| `DHRGB` | Light Pole | Same as RGB Bulb |
| `MHORGB` | Light Strip | Same as RGB Bulb |

### Sockets (exposed as `Outlet`)

| Module name contains | HomeKit name | Capabilities |
|---|---|---|
| `ESP10_SOCKET_06` | Wiz Socket | On/Off |
| `ESP25_SOCKET_01` | Wiz Socket | On/Off |

> If your device isn't listed, open an issue with its module name (visible in Homebridge debug logs).

## Features

- **Local control** — pure UDP, no cloud, no account required.
- **Auto-discovery** — broadcasts on startup and (optionally) on a configurable interval to pick up devices added later.
- **Adaptive Lighting** — automatically enabled for RGB and Tunable White bulbs. Disables itself if you change color/temperature manually, re-enables when HomeKit drives it again.
- **Scenes** — opt-in via `enableScenes`. Exposes up to 33 Wiz scenes (Ocean, Sunset, Forest, Cozy, Christmas, etc.) as a `Television` service. Scene list is filtered per device type. *Note: enabling scenes disables HomeKit light grouping.*
- **Instant response** — `getPilot` requests are batched per device so concurrent reads send a single UDP packet. If a bulb doesn't respond within 1 second, the last cached state is returned so HomeKit doesn't stall.
- **Offline detection** — devices that miss several consecutive pings are surfaced in Apple Home as "No Response" (via `pingFailuresBeforeOffline`). The plugin keeps probing in the background and clears the offline state automatically when the device replies again. Requires `refreshInterval > 0` for proactive recovery.
- **Per-device custom names** — override the auto-generated display name by entry in `devices[]` (`{ host, mac, name }`).
- **Ignore list** — keep specific devices out of HomeKit via `ignoredDevices[]`.
- **Color temperature ↔ RGB hand-off** — when a chosen HSV color falls in a "near-white" range, the plugin sends a Kelvin command instead of RGB so the bulb uses its brighter white LEDs.
- **Request coalescing** — concurrent `setPilot` writes to the same device are collapsed into a single in-flight UDP packet to reduce network chatter.

## Installation

Make sure your bulbs are already paired with the Wiz app and **"Allow Local Communication"** is ON in your Wiz app settings.

1. Install Homebridge: `npm install -g homebridge`
2. Install this plugin: `npm install -g homebridge-wiz-lan`
3. Edit your Homebridge `config.json` (see below).

> This README documents the fork. Installing from npm gives you the upstream release; install from this fork's git source if you want the fork's fixes/features.

## Configuration

Minimal:

```json
{
  "platform": "WizSmarthome",
  "name": "WizSmarthome"
}
```

Full reference (every option is optional):

```jsonc
{
  "platform": "WizSmarthome",
  "name": "Wiz",

  // Port the plugin binds to for device replies.
  // Default: 38900
  "port": 38900,

  // Expose Wiz scenes (Ocean, Sunset, etc.) as a HomeKit Television service.
  // WARNING: enabling scenes disables HomeKit light-grouping for that accessory.
  // Default: false
  "enableScenes": false,

  // When toggling a bulb on, send only the on/off state so the bulb restores
  // its last hardware-side settings (rhythms / last color). Only applies to
  // pure on/off updates — any color/brightness change still goes through.
  // Default: false
  "lastStatus": false,

  // UDP broadcast address used for discovery.
  // Default: 255.255.255.255
  "broadcast": "255.255.255.255",

  // Your Homebridge server's IP. Autodetected if omitted.
  "address": "192.168.0.1",

  // Manual device list. Useful when broadcast doesn't work (VLANs, mDNS-only nets).
  // Each entry can optionally pin a `name` (HomeKit display name) and/or `mac`.
  "devices": [
    { "host": "192.168.0.2" },
    { "host": "192.168.0.3", "name": "Living Room Lamp" },
    { "host": "192.168.0.4", "mac": "AA:BB:CC:DD:EE:FF", "name": "Desk Strip" }
  ],

  // Devices to exclude from HomeKit. Match by `host` or `mac`.
  // Devices already in the Homebridge cache will be unregistered on next start.
  "ignoredDevices": [
    { "mac": "AA:BB:CC:DD:EE:FF" },
    { "host": "192.168.0.99" }
  ],

  // Periodically poll every known device to keep HomeKit state in sync
  // and detect offline devices. Seconds, 0 = off.
  // Default: 0
  "refreshInterval": 60,

  // Periodically re-broadcast discovery to pick up devices added after startup.
  // Also re-pings manually listed `devices[].host`. Seconds, 0 = off.
  // Default: 0
  "discoveryInterval": 30,

  // Consecutive missed pings before a device is shown as "No Response" in Apple Home.
  // The plugin keeps probing in the background; it auto-recovers when the device replies.
  // Recovery requires `refreshInterval > 0` (otherwise the device only recovers when
  // HomeKit actively queries it).
  // Default: 3
  "pingFailuresBeforeOffline": 3
}
```

## Notes

### Color temperature vs RGB

Wiz bulbs handle RGB and Kelvin (color temperature) as two distinct modes, and the **Kelvin mode is noticeably brighter** because it drives dedicated white LEDs. HomeKit doesn't let a single service expose both cleanly ([discussion](https://github.com/home-assistant/home-assistant/pull/30756)).

The plugin works around this by exposing color (Hue/Saturation), and when the chosen color is "near-white" enough it transparently sends a Kelvin command instead of RGB.

Supported temperature range: **2200 K – 6500 K**. The HomeKit picker covers a wider range; only the segment inside that window actually changes the bulb.

### Brightness floor

The Wiz firmware rejects brightness values below 10 %. HomeKit reports 0–100 %; the plugin maps this onto 10–100 % internally, so HomeKit's 0 % becomes 10 % on the bulb.

### `lastStatus`

When `lastStatus` is `true` and you toggle a light **on** without changing anything else, the plugin sends only `{ state: true }`. The bulb then restores whatever it was doing before (the last color/rhythm/scene). Any other change (brightness, color, temperature, scene) goes through normally and overrides this.

### Adaptive Lighting

Enabled automatically for RGB and Tunable White bulbs. If you (or another app) change the bulb's color or temperature outside of Adaptive Lighting's schedule, it deactivates itself so you stay in control. HomeKit can re-enable it from the bulb's settings.

### Scenes

Disabled by default because enabling them swaps the accessory from a plain `Lightbulb` into a `Lightbulb + Television` combo, which breaks HomeKit light-grouping. Turn on with `enableScenes: true` if you want quick scene selection from the Home app.

## How discovery works

The plugin sends a UDP broadcast to port `38899`:

```json
{"method":"registration","params":{"phoneMac":"<my_mac>","register":false,"phoneIp":"<my_ip>"}}
```

Each Wiz device replies on port `38900`:

```json
{"method":"registration","env":"pro","result":{"mac":"<device_mac>","success":true}}
```

The plugin then queries `getSystemConfig` to learn the module name and registers the accessory.

## Development

```bash
npm ci
npm run build     # compiles TS → dist/
npm run watch     # rebuild + restart homebridge on change
```

> `npm run watch` uses [nodemon](./nodemon.json) which expects a Homebridge config at `./test/hbConfig`. Create one with your local network setup before running.

Original protocol notes: [blog.dammitly.net](http://blog.dammitly.net/2019/10/cheap-hackable-wifi-light-bulbs-or-iot.html?m=1).

## Credits

Upstream contributors (see [CHANGELOG.md](./CHANGELOG.md) for the full list):

- [@dotkrnl](https://github.com/dotkrnl) — [#7](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/7) setPilot parameter cleanup
- [@victori](https://github.com/victori) — [#16](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/16) Costco Wiz light support
- [@Supereg](https://github.com/supereg) — [#25](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/25) Name Characteristic fix
- [@MoTechnicalities](https://github.com/motechnicalities) — [#56](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/56) README updates
- [@xmanu](https://github.com/xmanu) — [#57](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/57) dimming range fix
- [@BMDan](https://github.com/bmdan) — [#67](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/67) durable custom names
- [@krystofcelba](https://github.com/krystofcelba) — [#74](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/74) dynamic scenes selector
- [@bwp91](https://github.com/bwp91) — [#81](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/81) config schema form
- [@AndrewSverdrup](https://github.com/AndrewSverdrup) — [#119](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/119) `lastStatus` setting
- [@pyrliu](https://github.com/pyrliu) — [#118](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/118) ESP25_SOCKET_01 support
- [@dhananjaysathe](https://github.com/dhananjaysathe) — [#173](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/173) surface unreachable bulbs as "Not Responding"

## Contributing

This is primarily built for personal use, but PRs are welcome. Open an issue first for anything non-trivial.

## License

Apache-2.0. See [LICENSE](./LICENSE).
