# NEON//DRIVE

**A playable music video.** A cinematic 3D browser racing game where the playing
song *is* the level: beats become tiles on an endless synthwave highway that
curves, climbs and banks, album artwork becomes the world's color palette,
synced lyrics float as massive 3D typography in the sky, and when the song ends
you drive into a wormhole that folds you into the next song's universe.

Three.js + Web Audio API. No build step, no dependencies.

---

## Quick Start

**1. Music service** — already configured. The game uses the hosted proxy at
`https://proxy.crt-audio.cc.cd` automatically (status shows on the main menu).
To self-host instead: `node proxy.js` from the parent folder, then set
`http://localhost:8080` in Settings.

> No proxy? **Local Drive still works** — drop any MP3/WAV/OGG into the game
> from the MUSIC screen. Everything else is identical.

**2. Optional co-op server** (2–4 players):

```bash
node multiplayer/server.js    # ws://localhost:9433
```

**3. Serve the game** (any static server):

```bash
python3 -m http.server 8123   # → http://localhost:8123
```

---

## Driving

- The road is **really** curved now: procedural hills, crests, dips, banked
  sweepers and S-curves generated from the world seed. The car follows
  elevation, banks through corners, and suspension + weight transfer are
  visible.
- **Drift** (`SPACE` / gamepad B): steering + throttle + loose rear. Hold it
  through corners to build drift score and charge nitro.
- **Nitro** (`SHIFT` / gamepad A): exhaust flames, FOV surge, speed streaks,
  extra top speed. Charged by perfects, drifts, stunts, near misses and team
  combos.
- **Ramps** appear on straights — jump, barrel-roll in the air (`SPACE`), and
  land clean for stunt score. Beat drops spawn full-width stunt ramps.
- **Obstacles** (cones, barriers, wrecks) and **traffic**: near misses pay
  nitro; hits cost speed and shake the camera.
- **Cars**: sculpted bodies, glass, interior (dashboard, steering wheel that
  turns, seats), brake discs + calipers, spinning rims, functional
  headlights/brake lights/reversing light, exhaust flames, PBR paint with
  neon environment reflections.

### Cameras

`C` cycles: CHASE · CLOSE · FAR · HOOD · COCKPIT · FRONT · REAR. A cinematic
camera takes over during jumps, nitro and wormholes. FOV scales with speed;
shake and FOV are adjustable in Settings.

### Co-op

HOST on the CO-OP screen, share the 4-letter code, pick a song and start —
everyone drives the same seed, same tiles, same weather, synced to a shared
song clock. Ghost cars, team combos, shared wormholes. Ghost collision by
default.

### HUD

Digital or analog speedometer, gear + RPM, nitro meter, live drift score,
judgement popups, song progress with wormhole marker.

---

## Audio

Engine (RPM-driven synth), wind, tire screech, nitro, impacts — all
synthesized, all mixed **under** the song. The music always wins.

---

## Under The Hood

```
js/
├── core/       Game state machine + loop, config
├── music/      ProxyProvider (YouTube Music InnerTube adapter), LocalProvider,
│               queue + radio + prewarming, ranged stream downloader
├── audio/      AudioEngine (Web Audio graph) · offline FFT analyzer
│               (band spectral-flux onsets → kick/snare/hat, BPM, energy)
├── gameplay/   PlayerCar (slip/grip arcade physics, suspension, drift, nitro,
│               airborne) · CarModel (procedural PBR vehicle) · RhythmDirector
│               (seeded, MP-deterministic) · TileManager · HitDetector ·
│               DriftSystem · StuntSystem · ObstacleManager · TrafficSystem ·
│               AudioFx
├── world/      RoadCurve (seeded curvature/elevation/banking centerline) ·
│               ribbon TrackGenerator (road + terrain + props + ramps +
│               obstacles) · PaletteSystem (album art → palette) · Sky shader ·
│               weather · time of day
├── lyrics/     LRCLIB/Netease/QQ synced lyrics → 3D sky typography with
│               camera-safe placement
├── transition/ Wormhole aligned to the road
├── rendering/  Renderer (ACES + sRGB) · 7-mode CameraSystem
└── multiplayer/ NetClient + MultiplayerManager (rooms, clock sync, ghosts,
                team combo) · server.js (dependency-free Node WS server)
```

Tiles are pre-computed from the decoded audio and positioned in **road space**,
arriving exactly on their beat regardless of speed. Multiplayer clients
regenerate identical tile plans from a shared rhythm seed — no tile data over
the wire.

---

## Troubleshooting

- **"NO MUSIC SERVICE"** — hosted proxy unreachable; local files always work.
- **Songs load slowly on the hosted proxy** — first resolution takes a while;
  hover search results to prewarm. Self-hosting `proxy.js` is faster.
- **Co-op unreachable** — start `node multiplayer/server.js` first. Players
  need the game served over `http://` (not `file://`).
- **No lyrics** — none found for that track; nothing fake is shown.
