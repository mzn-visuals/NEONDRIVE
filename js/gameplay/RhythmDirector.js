(function () {
  const RhythmDirector = {
    buildPlan(analysis, difficultyKey, seed) {
      const diff = ND.Config.DIFFICULTY[difficultyKey] || ND.Config.DIFFICULTY.normal;
      const rng = seed != null ? ND.mulberry32(seed) : Math.random;
      const events = analysis.events.slice().sort((a, b) => a.t - b.t);
      const plan = [];
      let lastT = -10;
      let lastLane = 0;
      let prevLane = 0;
      let alternations = 0;
      let perfectCounter = 0;

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.t < 2.6) continue;
        if (ev.t - lastT < diff.minGap) continue;

        const gap = ev.t - lastT;
        const energy = energyAt(analysis.energyCurve, ev.t);
        let type = null;

        switch (ev.type) {
          case "kick":
            if (ev.strength > 0.82 && gap > 1.15 && perfectCounter++ % 4 === 0) {
              type = "PERFECT";
            } else if (ev.strength > 0.9 && gap > 0.95) {
              type = "BASS";
            } else {
              type = "KICK";
            }
            break;
          case "snare":
            type = "SNARE";
            break;
          case "hat":
            if (rng() < diff.hatChance * (0.55 + energy * 0.7)) {
              type = "PERC";
            }
            break;
        }

        if (!type) { lastT = Math.max(lastT, ev.t - diff.minGap * 0.5); continue; }

        let lane = lastLane;
        const canMove = gap >= diff.laneChangeMinGap && alternations < 3;
        if (canMove && (rng() < 0.62 || type === "SNARE")) {
          const options = [-1, 0, 1].filter(l => l !== lastLane || Math.abs(l - lastLane) <= 1);
          lane = options[Math.floor(rng() * options.length)];
          lane = THREE.MathUtils.clamp(lane, -1, 1);
        } else if (type === "PERFECT" || type === "BASS") {
          lane = 0;
        }

        if (lane !== lastLane) {
          alternations = (lane === prevLane) ? alternations + 1 : 1;
          prevLane = lastLane;
        } else {
          alternations = Math.max(0, alternations - 1);
        }

        plan.push({ t: ev.t, tile: type, lane, strength: ev.strength });
        lastLane = lane;
        lastT = ev.t;
      }

      return plan;
    }
  };

  function energyAt(curve, t) {
    const i = Math.max(0, Math.min(curve.length - 1, Math.floor(t)));
    return curve[i] || 0;
  }

  ND.RhythmDirector = RhythmDirector;
})();
