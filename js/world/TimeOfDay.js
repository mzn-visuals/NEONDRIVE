(function () {
  const PRESETS = {
    sunrise: {
      skyTop: "#1b1040", skyMid: "#5d2a8f", horizon: "#ff9d6b",
      sunColor: "#ffd9a0", sunElevation: 0.10, sunSize: 0.30, stripes: 0.35,
      fogColor: "#3a2050", fogDensity: 0.0042,
      hemiSky: "#7a5db0", hemiGround: "#241238", hemiIntensity: 0.75,
      dirColor: "#ffc98a", dirIntensity: 0.85, dirElevation: 0.12,
      stars: 0.12
    },
    morning: {
      skyTop: "#2a3f8f", skyMid: "#6fa8e8", horizon: "#cfe8ff",
      sunColor: "#fffbe8", sunElevation: 0.42, sunSize: 0.16, stripes: 0,
      fogColor: "#8fb4d8", fogDensity: 0.0032,
      hemiSky: "#bcd8ff", hemiGround: "#33415e", hemiIntensity: 0.95,
      dirColor: "#fff4dd", dirIntensity: 1.05, dirElevation: 0.45,
      stars: 0
    },
    golden: {
      skyTop: "#33175e", skyMid: "#c04a8a", horizon: "#ffb45e",
      sunColor: "#ffe3ae", sunElevation: 0.20, sunSize: 0.26, stripes: 0.25,
      fogColor: "#8a4a68", fogDensity: 0.0038,
      hemiSky: "#c98ac0", hemiGround: "#38203f", hemiIntensity: 0.85,
      dirColor: "#ffce96", dirIntensity: 1.0, dirElevation: 0.22,
      stars: 0.06
    },
    sunset: {
      skyTop: "#241046", skyMid: "#a13d9b", horizon: "#ff7448",
      sunColor: "#ffcf8f", sunElevation: 0.115, sunSize: 0.34, stripes: 0.55,
      fogColor: "#571e52", fogDensity: 0.0044,
      hemiSky: "#9a54b8", hemiGround: "#200d33", hemiIntensity: 0.72,
      dirColor: "#ffb37a", dirIntensity: 0.9, dirElevation: 0.13,
      stars: 0.14
    },
    bluehour: {
      skyTop: "#0a1030", skyMid: "#28356e", horizon: "#5a6ec4",
      sunColor: "#dfe8ff", sunElevation: 0.07, sunSize: 0.2, stripes: 0,
      fogColor: "#1c2450", fogDensity: 0.0048,
      hemiSky: "#4a5aa8", hemiGround: "#10142c", hemiIntensity: 0.62,
      dirColor: "#cdd8ff", dirIntensity: 0.6, dirElevation: 0.09,
      stars: 0.4
    },
    night: {
      skyTop: "#05081c", skyMid: "#131b42", horizon: "#2c3670",
      moonColor: "#e8efff", sunElevation: 0.30, sunSize: 0.17, stripes: 0,
      moonMode: true,
      fogColor: "#0c1230", fogDensity: 0.0046,
      hemiSky: "#2c3a78", hemiGround: "#080a18", hemiIntensity: 0.5,
      dirColor: "#b8c8ff", dirIntensity: 0.55, dirElevation: 0.32,
      stars: 1.0
    },
    midnight: {
      skyTop: "#020310", skyMid: "#070d26", horizon: "#141c48",
      moonColor: "#cfdcff", sunElevation: 0.5, sunSize: 0.13, stripes: 0,
      moonMode: true,
      fogColor: "#060a1e", fogDensity: 0.005,
      hemiSky: "#1c2650", hemiGround: "#04060f", hemiIntensity: 0.4,
      dirColor: "#9fb2ff", dirIntensity: 0.45, dirElevation: 0.52,
      stars: 1.0
    }
  };

  const TimeOfDay = {
    get(id) { return PRESETS[id] || PRESETS.sunset; },
    ids() { return Object.keys(PRESETS); }
  };

  ND.TimeOfDay = TimeOfDay;
})();
