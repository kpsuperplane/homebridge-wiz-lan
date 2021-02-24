import HomebridgeWizLan from "../wiz";

export function miredToKelvin(mired: number) {
  return Math.round(1000000 / mired);
}
export function kelvinToMired(kelvin: number) {
  return Math.round(1000000 / kelvin);
}

const KELVIN_RANGE = { min: 2200, max: 6500 };

export type RGB = { r: number; g: number; b: number };

// from https://github.com/neilbartlett/color-temperature
export function colorTemperature2rgb(kelvin: number) {
  const temperature = kelvin / 100.0;
  let red, green, blue;

  if (temperature < 66.0) {
    red = 255;
  } else {
    // a + b x + c Log[x] /.
    // {a -> 351.97690566805693`,
    // b -> 0.114206453784165`,
    // c -> -40.25366309332127
    //x -> (kelvin/100) - 55}
    red = temperature - 55.0;
    red =
      351.97690566805693 +
      0.114206453784165 * red -
      40.25366309332127 * Math.log(red);
    if (red < 0) red = 0;
    if (red > 255) red = 255;
  }

  /* Calculate green */

  if (temperature < 66.0) {
    // a + b x + c Log[x] /.
    // {a -> -155.25485562709179`,
    // b -> -0.44596950469579133`,
    // c -> 104.49216199393888`,
    // x -> (kelvin/100) - 2}
    green = temperature - 2;
    green =
      -155.25485562709179 -
      0.44596950469579133 * green +
      104.49216199393888 * Math.log(green);
    if (green < 0) green = 0;
    if (green > 255) green = 255;
  } else {
    // a + b x + c Log[x] /.
    // {a -> 325.4494125711974`,
    // b -> 0.07943456536662342`,
    // c -> -28.0852963507957`,
    // x -> (kelvin/100) - 50}
    green = temperature - 50.0;
    green =
      325.4494125711974 +
      0.07943456536662342 * green -
      28.0852963507957 * Math.log(green);
    if (green < 0) green = 0;
    if (green > 255) green = 255;
  }

  /* Calculate blue */

  if (temperature >= 66.0) {
    blue = 255;
  } else {
    if (temperature <= 20.0) {
      blue = 0;
    } else {
      // a + b x + c Log[x] /.
      // {a -> -254.76935184120902`,
      // b -> 0.8274096064007395`,
      // c -> 115.67994401066147`,
      // x -> kelvin/100 - 10}
      blue = temperature - 10;
      blue =
        -254.76935184120902 +
        0.8274096064007395 * blue +
        115.67994401066147 * Math.log(blue);
      if (blue < 0) blue = 0;
      if (blue > 255) blue = 255;
    }
  }

  return { r: Math.round(red), b: Math.round(blue), g: Math.round(green) };
}

// from https://github.com/neilbartlett/color-temperature
export function rgb2colorTemperature(rgb: RGB) {
  let temperature = 0,
    testRGB;
  const epsilon = 0.4;
  let minTemperature = 1000;
  let maxTemperature = 40000;
  while (maxTemperature - minTemperature > epsilon) {
    temperature = (maxTemperature + minTemperature) / 2;
    testRGB = colorTemperature2rgb(temperature);
    if (testRGB.b / testRGB.r >= rgb.b / rgb.r) {
      maxTemperature = temperature;
    } else {
      minTemperature = temperature;
    }
  }
  return Math.max(KELVIN_RANGE.min, Math.min(KELVIN_RANGE.max, Math.round(temperature)));
}

// from https://gist.github.com/mjackson/5311256
export function rgbToHsv({ r, g, b }: RGB) {
  (r /= 255), (g /= 255), (b /= 255);

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h: number = 0,
    s: number = max;

  var d = max - min;
  s = max == 0 ? 0 : d / max;

  if (max == min) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }
  return { hue: Math.round(h * 360), saturation: Math.round(s * 100) };
}

export function hsvToColor(h: number, s: number, wiz: HomebridgeWizLan) {
  // First, convert to RGB
  const v = 1;
  let r = 0,
    g = 0,
    b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      (r = v), (g = t), (b = p);
      break;
    case 1:
      (r = q), (g = v), (b = p);
      break;
    case 2:
      (r = p), (g = v), (b = t);
      break;
    case 3:
      (r = p), (g = q), (b = v);
      break;
    case 4:
      (r = t), (g = p), (b = v);
      break;
    case 5:
      (r = v), (g = p), (b = q);
      break;
  }
  const rgb = {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
  
  // See if it might actually be a color temperature
  const h360 = h * 360;
  const s100 = s * 100;
  if (
    (h360 >= 0 && h360 <= 30 && s100 >= 0 && s100 <= 76) ||
    (h360 >= 220 && h360 <= 360 && s100 >= 0 && s100 <= 25)
  ) {
    const possibleKelvin = rgb2colorTemperature(rgb);
    wiz.log.debug(
      `Considering possible Kelvin conversion of ${possibleKelvin}`
    );
    // check if bulb supports it
    if (
      possibleKelvin >= KELVIN_RANGE.min &&
      possibleKelvin <= KELVIN_RANGE.max
    ) {
      return { temp: possibleKelvin };
    }
  }

  return rgb;
}


export function clampRgb(rgb: RGB) {
  return {
    r: Math.max(0, Math.min(255, rgb.r)),
    g: Math.max(0, Math.min(255, rgb.g)),
    b: Math.max(0, Math.min(255, rgb.b))
  };
}