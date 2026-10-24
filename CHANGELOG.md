# Changelog

## 3.4.3
- [FIX] Recognize ESP10_SOCKET_01 smart plugs as outlets (experimental; hardware verification pending), addressing #153
- [FIX] Update the development dependency lockfiles to resolve brace-expansion security advisories

## 3.4.2
- [FIX] Rate-limit and stagger UDP probes, back off offline devices, and suppress unchanged HomeKit updates to prevent read/notification feedback loops from flooding the LAN
- [FIX] Prevent delayed `getPilot` replies from overwriting newer writes, while reconciling state after lost `setPilot` acknowledgements
- Thank you [@ulm0](https://github.com/ulm0) for [#178](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/178)

## 3.4.1
- [FIX] Add a 2-second `setPilot` acknowledgement timeout so lost UDP acknowledgements no longer wedge later commands, while preserving newer queued cache state
- [FIX] Retransmit `getPilot` once and serve cached state immediately while refreshing HomeKit in the background, reducing "Updating…" delays on lossy Wi-Fi
- [FIX] Count coalesced probe timeouts once so one dropped reply no longer falsely marks a device offline
- Thank you [@ulm0](https://github.com/ulm0) for [#176](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/176)

## 3.4.0
- [FEAT] Near-instant getPilot response — replaces the 50 ms debounce with in-flight request deduplication, and coalesces rapid setPilot calls so slider drags emit at most two UDP packets per device
- [FEAT] `discoveryInterval` config option — periodically re-broadcasts the UDP discovery packet so devices added after Homebridge starts are picked up automatically
- [FEAT] Offline detection rewritten around consecutive ping failures (configurable via `pingFailuresBeforeOffline`); offline devices fail HomeKit reads immediately as "No Response" and recover automatically
- [FIX] `lastStatus` no longer strips brightness/color/temperature changes — it now only applies to pure on/off toggles
- [FIX] `transformDimming` clamps to ≥ 0 so a device reporting `dimming=0` no longer sends a negative brightness to HomeKit
- [FIX] Refresh and discovery intervals are now cleared on Homebridge shutdown
- **Breaking:** `reportOffline` and `offlineThreshold` config keys are removed. Any `refreshInterval > 0` now activates offline reporting unconditionally (controlled by `pingFailuresBeforeOffline`, default 3). The refresh tick no longer re-broadcasts discovery — enable `discoveryInterval > 0` to keep the pre-3.4.0 DHCP-lease recovery behavior; the plugin logs a startup warning if you have refresh on without discovery.
- Thank you [@ulm0](https://github.com/ulm0) for [#175](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/175)

## 3.3.4
- [FEAT] Optionally surface unreachable bulbs as "Not Responding" in HomeKit via new `reportOffline` config flag
- [FIX] Filter undefined fields before merging cached pilot state (prevents NaN brightness when firmware omits `dimming`)
- [FIX] Add fallback in `pilotToColor()` for empty cache entries (prevents crashes on color/temperature changes after timeout)
- Thank you [@dhananjaysathe](https://github.com/dhananjaysathe) for [#173](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/173)

## 3.3.2
- [FEAT] Experimental support for Light Strips

## 3.3.0
- [FIX] Support for certain sockets that were misclassified as light poles
- [FEAT] Support Homebridge 2.0

## 3.2.1
- [FIX] Fixes the dimming math to correctly map 0% -> 10% 
- [FIX] Handles bulb not sending a brightness value, defaults to the on/off state of the bulb
- Thank you [@MoTechnicalities](https://github.com/motechnicalities) for diagnosing and responding to these issues

## 3.2.0
- [FEAT] Support for Wiz Plugs/Outlets

## 3.1.1, 3.1.2
- [FIX] Make scenes opt-in since it breaks light-grouping functionality

## 3.1.0
- [FEAT] Add support for scenes! Optionally disable this via `enableScenes` param since it removes your ability to tap on a tile to turn a light on/off
- [FEAT] Config UI for HOOBS
- Credits for contributors. Thank you:
    #### [@dotkrnl](https://github.com/dotkrnl)
    [#7 Remove obsolete/invalid parameters from setPilot to fix](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/7)

    #### [@victori](https://github.com/victori)
    [#16 Support costco wiz lights that behave differently from philips wiz](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/16)

    #### [@Supereg](https://github.com/supereg)
    [#25 Fix: getter for Name Characteristic returned object instead of the value](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/25)

    #### [@MoTechnicalities](https://github.com/motechnicalities)
    [#56 Update README.md](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/56)

    #### [@xmanu](https://github.com/xmanu)
    [#57 transform the received dimming value to also fit the 10 to 100 range](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/57)

    #### [@BMDan](https://github.com/bmdan)
    [#67 feat: Support durable custom names in config](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/67)

    #### [@krystofcelba](https://github.com/krystofcelba)
    [#74 feat: implement dynamic scenes selector](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/74)

    #### [@bwp91](https://github.com/bwp91)
    [#81 Add a config schema form](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/81)

## 3.0.2
- [FIX] Add instant response for bulbs, will now return last-known value if bulbs take more than 1 second to respond.

## 3.0.1
- [FEAT] Add a changelog
- [FEAT] Add batching for getPilot queries which should reduce network traffic a bit
- [FIX] Fix import issues from v2
- [FIX] Prevent TW bulbs from magically becoming RGB bulbs

## 3.0.0

- [FEAT] Support for RGB, Color Temp, and (Do I call them regular?) non-color-nor-temperature-adjustable bulbs
- [FEAT] Vastly lower network traffic - No longer relies on heartbeats
- [FEAT] Full compatibility with latest version of homebridge 1.3.1
- [FEAT] Improved documentation (for both users and developers)
