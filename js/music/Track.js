(function () {
  function normalizeTrack(raw, source) {
    return {
      id: raw.id || "",
      title: raw.title || raw.name || "Unknown",
      artist: raw.artist || "",
      album: raw.album || "",
      duration: raw.duration || 0,
      thumbnail: raw.thumbnail || raw.pic || raw.picUrl || "",
      source: source,
      sourceId: raw.id || ""
    };
  }

  ND.Track = { normalize: normalizeTrack };

  ND.formatDuration = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  };
})();
