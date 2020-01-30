Code based off of https://github.com/plasticrake/homebridge-tplink-smarthome#readme and https://github.com/plasticrake/tplink-smarthome-api

For my own personal use, I provide no support. Feel free to create and modify it on your own per MIT License.

Currently only built to support RGB lights

Ideas from http://blog.dammitly.net/2019/10/cheap-hackable-wifi-light-bulbs-or-iot.html?m=1


## Some Notes

The Wiz bulbs strongly distinguish between RGB color modes and Kelvin color modes, **the latter being significantly brighter**. Unfortunately, HomeKit is not very good at handling both at the same time, [yielding weird errors if you try to add both characteristics](https://github.com/home-assistant/home-assistant/pull/30756). 

Luckily, even if we only enable the color mode, we still get a nice temperature picker. Problem is, the color temperature is given in standard HSV. As such, this app will try to guess which one to best use given a color, and you will notice some significant brightness variance switching between a "temp" hue and a "color" hue.

**In particular, since the Wiz bulbs only support up to 6500K, this means that only the top-ish half of the temperature picker is actually bright**


## Discovery

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
{"method":"syncPilot","id":69,"env":"pro","params":{"mac":"<my","rssi":-48,"src":"hb","mqttCd":0,"state":true,"sceneId":11,"speed":100,"temp":2700,"dimming":100}}
```
