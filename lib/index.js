const WizSmarthomePlatform = require('./platform');

module.exports = homebridge => {
  const dynamic = true;
  homebridge.registerPlatform(
    'homebridge-wiz-smarthome',
    'WizSmarthome',
    WizSmarthomePlatform,
    dynamic
  );
};
