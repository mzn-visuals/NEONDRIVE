(function () {
  const W = ND.Config.TIMING_WINDOWS;

  const HitDetector = {
    qualityFor(delta, tileType) {
      const a = Math.abs(delta);
      const scale = tileType === "PERFECT" ? ND.Config.PERFECT_TILE_WINDOW_SCALE : 1;
      if (a <= W.PERFECT * scale) return "PERFECT";
      if (a <= W.GREAT * scale) return "GREAT";
      if (a <= W.GOOD * scale) return "GOOD";
      return null;
    },

    laneMatch(carX, tile) {
      if (tile.type === "BASS") return Math.abs(carX) < ND.Config.ROAD_HALF_WIDTH - 0.4;
      const tolerance = tile.type === "KICK" ? 1.75 : 1.45;
      return Math.abs(carX - tile.laneX) <= tolerance;
    },

    evaluate(carX, songTime, tiles) {
      for (const tile of tiles) {
        if (tile.state !== "approach") continue;
        const delta = songTime - tile.hitTime;
        if (delta < -W.GOOD || delta > W.GOOD) continue;
        if (!HitDetector.laneMatch(carX, tile)) continue;
        const q = HitDetector.qualityFor(delta, tile.type);
        if (q) return { tile, quality: q, delta };
      }
      return null;
    }
  };

  ND.HitDetector = HitDetector;
})();
