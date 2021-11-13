# Changelog

## 3.1.1
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