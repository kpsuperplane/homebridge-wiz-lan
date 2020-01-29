const castArray = require('lodash.castarray');

function normalizeMac(mac = '') {
  return mac.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function compareMac(mac = '', macPattern) {
  const macPatterns = castArray(macPattern).map(p => {
    return new RegExp(
      `^${p
        .replace(/[^A-Za-z0-9?*]/g, '')
        .replace(/[?]/g, '.')
        .replace(/[*]/g, '.*')
        .toUpperCase()}$`
    );
  });
  const normalizedMac = normalizeMac(mac);
  return macPatterns.findIndex(p => p.test(normalizedMac)) !== -1;
}
module.exports = {
  compareMac,
};
