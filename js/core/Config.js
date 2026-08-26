(function () {
  const Config = {
    LANES_X: [-3.4, 0, 3.4],
    ROAD_HALF_WIDTH: 6.2,
    CAR_Z: 0,
    HIT_PLANE_Z: 0,

    SPEED: {
      startKmh: 70,
      minKmh: 50,
      missPenalty: 8
    },

    TIMING_WINDOWS: { PERFECT: 0.058, GREAT: 0.108, GOOD: 0.168 },
    PERFECT_TILE_WINDOW_SCALE: 0.68,

    LOOKAHEAD_MAX_S: 2.35,
    MAX_SPAWN_DIST: 190,

    COMBO_TIERS: [
      { hits: 100, mult: 3.0 },
      { hits: 50, mult: 2.0 },
      { hits: 25, mult: 1.5 },
      { hits: 10, mult: 1.2 },
      { hits: 0, mult: 1.0 }
    ],

    TILE_TYPES: {
      KICK:     { value: 150, speedGain: 5,   colorMix: "primary",  scale: 1.25 },
      BASS:     { value: 220, speedGain: 6.5, colorMix: "secondary",scale: 1.0  },
      SNARE:    { value: 120, speedGain: 3.5, colorMix: "highlight",scale: 1.0  },
      STANDARD: { value: 100, speedGain: 3,   colorMix: "accent",   scale: 1.0  },
      PERC:     { value: 55,  speedGain: 1.2, colorMix: "secondary",scale: 0.62 },
      PERFECT:  { value: 320, speedGain: 7.5, colorMix: "highlight",scale: 0.95 }
    },

    CARS: [
      {
        id: "neon-gt", name: "NEON GT",
        maxSpeed: 280, accel: 0.85, handling: 0.9,
        braking: 0.8, grip: 0.85, drift: 0.6, weight: 0.55, downforce: 0.7,
        nitroCapacity: 100, nitroRecharge: 1.0, steeringResponse: 0.85,
        desc: "The all-rounder. A wide-body Japanese coupe with quad tails and a wing that means business.",
        body: 0x241040, trim: 0xff2fd6,
        profile: {
          len: 4.62, width: 2.02, ride: 0.3, bodyH: 0.5,
          noseLen: 1.05, noseH: 0.52, noseDrop: 0.14,
          hoodLen: 1.25, hoodH: 0.74,
          cabinStart: -0.35, cabinLen: 1.75, cabinH: 0.56, windshield: 0.52, rearGlass: 0.5, rearGlassLen: 0.95,
          deckLen: 1.0, deckH: 0.8, tailH: 0.6,
          wing: "gt", fenders: true, intakes: false, wheelR: 0.45
        }
      },
      {
        id: "eclipse", name: "ECLIPSE",
        maxSpeed: 320, accel: 0.7, handling: 0.72,
        braking: 0.7, grip: 0.75, drift: 0.75, weight: 0.7, downforce: 0.6,
        nitroCapacity: 120, nitroRecharge: 0.9, steeringResponse: 0.7,
        desc: "An American fastback muscle GT. Long hood, thumping rear haunches, built for the highway.",
        body: 0x101c34, trim: 0x29e6ff,
        profile: {
          len: 4.98, width: 2.06, ride: 0.34, bodyH: 0.56,
          noseLen: 1.3, noseH: 0.58, noseDrop: 0.1,
          hoodLen: 1.7, hoodH: 0.78,
          cabinStart: 0.45, cabinLen: 1.6, cabinH: 0.52, windshield: 0.56, rearGlass: 0.38, rearGlassLen: 1.3,
          deckLen: 0.5, deckH: 0.86, tailH: 0.68,
          wing: "duck", fenders: false, intakes: false, wheelR: 0.46
        }
      },
      {
        id: "vector-x", name: "VECTOR X",
        maxSpeed: 360, accel: 0.55, handling: 0.58,
        braking: 0.62, grip: 0.6, drift: 0.95, weight: 0.45, downforce: 0.5,
        nitroCapacity: 140, nitroRecharge: 1.15, steeringResponse: 0.6,
        desc: "A mid-engine Italian wedge. Scissor-door attitude, delta wing, and a top speed that bites back.",
        body: 0x301018, trim: 0xff5d3d,
        profile: {
          len: 4.72, width: 2.12, ride: 0.24, bodyH: 0.42,
          noseLen: 1.35, noseH: 0.4, noseDrop: 0.1,
          hoodLen: 1.0, hoodH: 0.6,
          cabinStart: -0.72, cabinLen: 1.55, cabinH: 0.48, windshield: 0.62, rearGlass: 0.55, rearGlassLen: 0.85,
          deckLen: 1.25, deckH: 0.68, tailH: 0.56,
          wing: "delta", fenders: true, intakes: true, wheelR: 0.45
        }
      },
      {
        id: "pulse-rs", name: "PULSE RS",
        maxSpeed: 300, accel: 0.95, handling: 0.98,
        braking: 0.95, grip: 0.98, drift: 0.45, weight: 0.4, downforce: 0.9,
        nitroCapacity: 90, nitroRecharge: 1.2, steeringResponse: 0.98,
        desc: "A front-drive hot hatch turned track weapon. Compact, agile, with a visor wing over the hatch.",
        body: 0x0e2620, trim: 0x7dffb0,
        profile: {
          len: 4.18, width: 1.94, ride: 0.36, bodyH: 0.6,
          noseLen: 0.85, noseH: 0.62, noseDrop: 0.12,
          hoodLen: 0.95, hoodH: 0.82,
          cabinStart: -0.15, cabinLen: 1.85, cabinH: 0.58, windshield: 0.5, rearGlass: 0.68, rearGlassLen: 0.8,
          deckLen: 0.55, deckH: 0.92, tailH: 0.78,
          wing: "visor", fenders: false, intakes: false, wheelR: 0.42
        }
      }
    ],

    PHYSICS: {
      gravity: 22,
      lateralGripBase: 26,
      driftGripFactor: 0.32,
      slipGainDrift: 1.35,
      weightTransferK: 0.045,
      suspensionK: 90,
      suspensionDamp: 11,
      bumpAmp: 0.05,
      wetGripLoss: 0.45,
      offRoadDrag: 14,
      collisionSpeedLoss: 26,
      coneSpeedLoss: 7,
      trafficSpeedLoss: 20,
      nitroAccelBonus: 34,
      nitroMaxBonus: 42,
      nitroDrainPerSec: 34
    },

    DRIFT: {
      entrySlip: 0.14,
      minSpeedKmh: 65,
      scorePerSec: 260,
      nitroPerSec: 16,
      endGrace: 0.5
    },

    STUNTS: {
      scorePerSecAir: 220,
      scorePerRotation: 420,
      cleanLandingBonus: 500,
      cleanRollTol: 0.35,
      sloppySpeedLoss: 12
    },

    CAMERAS: [
      { id: "chase",   name: "CHASE" },
      { id: "close",   name: "CLOSE CHASE" },
      { id: "far",     name: "FAR CHASE" },
      { id: "hood",    name: "HOOD" },
      { id: "cockpit", name: "COCKPIT" },
      { id: "front",   name: "FRONT" },
      { id: "rear",    name: "REAR" }
    ],

    ROAD: {
      sampleStep: 3,
      maxCurvature: 1 / 240,
      curvatureChange: 1 / 2600,
      elevAmp: 4.5,
      elevWavelengthMin: 320,
      bankFactor: 42,
      maxBank: 0.14
    },

    LEVELS: [
      { id: "desert",    name: "NEON DESERT",        wc1: "#ff7a3d", wc2: "#ff2fd6", desc: "Endless highway through a holographic desert.", props: "desert",  gridOpacity: 0.35 },
      { id: "city",      name: "NEON CITY",          wc1: "#29e6ff", wc2: "#8a3dff", desc: "Skyscraper canyons under holographic skies.",   props: "city",    gridOpacity: 0.22 },
      { id: "coastal",   name: "COASTAL HIGHWAY",    wc1: "#2f7bff", wc2: "#29ffd0", desc: "Cliffs and chrome ocean on the left hand side.", props: "coastal", gridOpacity: 0.15 },
      { id: "mountain",  name: "MOUNTAIN PASS",      wc1: "#b44dff", wc2: "#4dfff3", desc: "Colossal peaks crowding a narrow valley road.",  props: "mountain",gridOpacity: 0.28 },
      { id: "lunar",     name: "LUNAR HIGHWAY",      wc1: "#9fb8ff", wc2: "#6a5dff", desc: "Dark regolith beneath an enormous blue moon.",   props: "lunar",   gridOpacity: 0.05 },
      { id: "boulevard", name: "CYBERPUNK BOULEVARD",wc1: "#ff2f6a", wc2: "#ffe14d", desc: "Dense neon canyon of signs and arch gates.",     props: "boulevard",gridOpacity: 0.2 }
    ],

    TIMEOFDAY: [ "sunrise", "morning", "golden", "sunset", "bluehour", "night", "midnight" ],
    DEFAULT_TIME: "sunset",

    WEATHER: [ "clear", "fog", "rain", "heavy-rain", "storm", "dust", "neon-mist" ],
    DEFAULT_WEATHER: "clear",

    MODES: { SINGLE: "single", INFINITE: "infinite", RADIO: "radio" },

    DIFFICULTY: {
      easy:   { minGap: 0.42, hatChance: 0.12, chainChance: 0.08, laneChangeMinGap: 0.5,  densityScale: 0.75 },
      normal: { minGap: 0.30, hatChance: 0.30, chainChance: 0.16, laneChangeMinGap: 0.36, densityScale: 1.0  },
      hard:   { minGap: 0.215,hatChance: 0.5,  chainChance: 0.26, laneChangeMinGap: 0.27, densityScale: 1.25 }
    },

    WORMHOLE: {
      ARM_AT: 22,
      WARN_AT: 8,
      TUNNEL_AT: 5,
      CONVERGE_AT: 3,
      ENTER_AT: 1,
      SWAP_AT: -0.5,
      SETTLE_AT: 2
    },

    PROXY_ENDPOINTS_DEFAULT: ["https://proxy.crt-audio.cc.cd", "http://localhost:8080"],

    QUALITY: {
      low:    { pixelRatio: 1,   particles: 0.35, drawDistance: 900,  chunkCount: 10 },
      medium: { pixelRatio: 1.5, particles: 0.7,  drawDistance: 1100, chunkCount: 13 },
      high:   { pixelRatio: 2,   particles: 1.0,  drawDistance: 1400, chunkCount: 15 }
    },

    TILE_HITBOX: { base: 1.0, easy: 1.35, normal: 1.0, hard: 0.85 },

    MP: {
      url: "ws://localhost:9433/mp",
      maxPlayers: 4
    },

    STORE_KEYS: {
      settings: "nd_settings_v1"
    }
  };

  ND.Config = Config;
})();
