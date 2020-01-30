function getOrAddCharacteristic(service, characteristic) {
  return (
    service.getCharacteristic(characteristic) ||
    service.addCharacteristic(characteristic)
  );
}

function kelvinToMired(kelvin) {
  return 1e6 / kelvin;
}

function lookup(compareFn, value) {
  if (compareFn == null) {
    // eslint-disable-next-line no-param-reassign
    compareFn = (thisKeyValue, val) => {
      return thisKeyValue === val;
    };
  }
  const keys = Object.keys(this);
  for (let i = 0; i < keys.length; i += 1) {
    if (compareFn(this[keys[i]], value)) {
      return keys[i];
    }
  }
  return null;
}

function miredToKelvin(mired) {
  return 1e6 / mired;
}

module.exports = {
  getOrAddCharacteristic,
  kelvinToMired,
  lookup,
  miredToKelvin,
};
