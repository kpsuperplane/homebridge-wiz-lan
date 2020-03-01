# Usage

**Currently only built to support RGB lights.**

Simply install this homebridge package with
```
npm install -g homebridge-wiz-lan
```
and add
```
{
    "platform": "WizSmarthome",
    "name": "WizSmarthome"
}
```
to your `config.json`. 

The bulbs on your local network should be autodetected and added to your homebridge

## Some Notes

### Color

The Wiz bulbs strongly distinguish between RGB color modes and Kelvin color modes, **the latter being significantly brighter**. Unfortunately, HomeKit is not very good at handling both at the same time, [yielding weird errors if you try to add both characteristics](https://github.com/home-assistant/home-assistant/pull/30756). 

Luckily, even if we only enable the color mode, we still get a nice temperature picker. Problem is, the color temperature is given in standard HSV. As such, this app will try to guess which one to best use given a color, and you will notice some significant brightness variance switching between a "temp" hue and a "color" hue.

**In particular, since the Wiz bulbs only support up to 6500K, this means that only the top-ish half of the temperature picker is actually bright**
### Network Traffic
The way Wiz bulbs work is by broadcoasting their current status every 5s or so. This works for the app, because you probably don't always have the app open.

However, this plugin effictively simulates an always-open app. Therefore, if you have a lot of these bulbs, this plugin might actually take up a non-trivial amount of bandwidth in your LAN.

# Development

Code based off of https://github.com/plasticrake/homebridge-tplink-smarthome#readme and https://github.com/plasticrake/tplink-smarthome-api


Ideas from http://blog.dammitly.net/2019/10/cheap-hackable-wifi-light-bulbs-or-iot.html?m=1

## Contributing

Mostly built for my own personal use, I'll probably reply to any created issues but probably will not actively support anything outside of the RGB bulbs. If you'd like to make a PR through, <3
 
Furthermore, feel free to create and modify it on your own per MIT License.

## How bulbs are discovered

Make a UDP broadcast to port 38899 with the following content:

```
{"method":"registration","params":{"phoneMac":"<my_mac_address>","register":true,"phoneIp":"<my_ip_address>"}}
```

You will get a response on port 38900 with the following content:

```
{"method":"registration","env":"pro","result":{"mac":"<light_address>","success":true}}
```

More importantly, you will begin to receive heartbeats with the following content:

```
// Kelvin Value
{"method":"syncPilot","id":69,"env":"pro","params":{"mac":"<mac_address>","rssi":<some_number>,"src":"<something>","mqttCd":0,"state":true,"sceneId":<some_number>,"speed":100,"temp":2700,"dimming":100}}

// RGB Value
{"method":"syncPilot","id":69,"env":"pro","params":{"mac":"<mac_address>","rssi":<some_number>,"src":"<something>","mqttCd":0,"state":true,"sceneId":<some_number>,"speed":100,"r":255,"g":255,"b":255,"dimming":100}}
```
