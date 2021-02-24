# homebridge-wiz-lan
Based off of kpsuperplane/homebridge-iotas

## Currently supports
- Lights (tested with Wiz 100W Color & Wiz 30W Filaments)

# Installation
1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-wiz-lan`
3. Update your configuration file. See the sample below.

# Configuration
Configuration sample:

 ```javascript
"platforms": [
  {
    "platform" : "homebridge-wiz-lan",
    "name" : "Wiz"
  }
]
```

# License
See LICENSE file
