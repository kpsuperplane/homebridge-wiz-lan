# homebridge-wiz-lan
Based off of kpsuperplane/homebridge-iotas

## Currently supports
- Lightbulbs (RGB, Color Temp, and Single Color) (tested with Wiz 100W Color & Wiz 30W Filaments)
- Wiz Plugs/Outlets (ESP10_SOCKET_06, ESP25_SOCKET_01, ESP20_DHRGB_01)

# Installation

Make sure your bulbs are already set up via the Wiz app and you have "Allow Local Communication" set to ON in your settings.

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-wiz-lan`
3. Update your configuration file. See the sample below.

# Configuration
Simple Configuration:

```javascript
{
    "platform": "WizSmarthome",
    "name": "WizSmarthome",
}
```

Full configuration options:

```javascript
{
    "platform": "WizSmarthome",
    "name": "Wiz",

    // [Optional] Port for bulbs to connect to your server
    // Default: 38900
    "port": 38900,

    // [Optional] Enable scenes support for your bulbs
    // Default: false
    "enableScenes": false,

    // [Optional] Lights turn on with the same settings they had when turned off (light configs in HomeKit are ignored).
    // Default: false
    "lastStatus": false,

    // [Optional] UDP Broadcast address for bulb discovery
    // Default: 255.255.255.255
    "broadcast": "255.255.255.255",

    // [Optional] Your server's IP address
    // Default: Autodiscovered
    "address": "192.168.0.1",

    // [Optional] Manual list of IP addresses of bulbs
    // Useful if UDP broadcast doesn't work for some reason
    // Default: None
    "devices": [
      { "host": "192.168.0.2" },
      { "host": "192.168.0.3" },
      { "host": "192.168.0.4" },
      // ...
    ],

    // [Optional] Refresh/ping every accessory to get their latest state on an interval. Specify in seconds, 0 = off
    // Default: 0
    "refreshInterval": 60,
  }
```

## Some Notes

### Color

The Wiz bulbs strongly distinguish between RGB color modes and Kelvin color modes, **the latter being significantly brighter**. Unfortunately, HomeKit is not very good at handling both at the same time, [yielding weird errors if you try to add both characteristics](https://github.com/home-assistant/home-assistant/pull/30756).

Luckily, even if we only enable the color mode, we still get a nice temperature picker. Problem is, the color temperature is given in standard HSV. As such, this app will try to guess which one to best use given a color, and you will notice some significant brightness variance switching between a "temp" hue and a "color" hue.

**In particular, since the Wiz bulbs only support up to 6500K, this means that only the top-ish half of the temperature picker is actually bright**

### Last Status (config setting)
If a "rhythm" is selected in the Wiz app and `lastStatus` is set to `true`, the lights will always turn on to the rhythm. When rhythms are disabled, lights turn on to whatever setting they had when last turned off.

# Development
Ideas from http://blog.dammitly.net/2019/10/cheap-hackable-wifi-light-bulbs-or-iot.html?m=1

## Credits
Thanks to:
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

#### [@AndrewSverdrup](https://github.com/AndrewSverdrup)
[#119 Add lastStatus setting so lights remember their setting when turned on](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/119)

#### [@pyrliu](https://github.com/pyrliu)
[#118 Added support for Wiz Smart Plug ESP25_SOCKET_01](https://github.com/kpsuperplane/homebridge-wiz-lan/pull/118)

## Contributing

Mostly built for my own personal use, I'll probably reply to any created issues but probably will not actively support anything outside of the RGB bulbs. If you'd like to make a PR through, <3

Furthermore, feel free to create and modify it on your own per MIT License.

## How bulbs are discovered

Make a UDP broadcast to port 38899 with the following content:

```
{"method":"registration","params":{"phoneMac":"<my_mac_address>","register":false,"phoneIp":"<my_ip_address>"}}
```

You will get a response on port 38900 with the following content:

```
{"method":"registration","env":"pro","result":{"mac":"<light_address>","success":true}}
```

# License
See LICENSE file
