(function () {
  const LRCLIB_HEADERS = { "Lrclib-Client": "NEON-DRIVE/1.0 (https://lrclib.net)" };
  const METING_API = "https://163.hyc.moe/api";

  function titleSearchVariants(title) {
    const t = String(title || "").trim();
    if (!t) return [];
    const variants = [t];
    const noYear = t.replace(/\s*[([]?\d{4}[)]?]?\s*$/i, "").trim();
    if (noYear && noYear !== t) variants.push(noYear);
    const noTags = (noYear || t)
      .replace(/\s*[([][^\])]*[)\]]\s*/g, " ")
      .replace(/\s+-\s*(radio|extended|remix|mix|version|edit|instrumental).*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (noTags && !variants.includes(noTags)) variants.push(noTags);
    return [...new Set(variants.filter(Boolean))];
  }

  function normKey(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokenOverlap(a, b) {
    const ta = new Set(normKey(a).split(" ").filter(Boolean));
    const tb = new Set(normKey(b).split(" ").filter(Boolean));
    if (!ta.size || !tb.size) return 0;
    let hit = 0;
    for (const t of ta) if (tb.has(t)) hit++;
    return hit / Math.max(ta.size, tb.size);
  }

  function scoreTrackMatch(hitArtist, hitTitle, artist, title, duration, hitDuration) {
    const a = normKey(hitArtist), b = normKey(artist), t = normKey(hitTitle);
    const titles = titleSearchVariants(title).map(normKey);

    let artistScore = 0.25;
    if (b) {
      if (a === b) artistScore = 1;
      else if (a.includes(b) || b.includes(a)) artistScore = 0.82;
      else artistScore = tokenOverlap(hitArtist, artist);
    }

    let titleScore = 0.2;
    if (titles.length) {
      titleScore = Math.max(...titles.map(tv => {
        if (!tv) return 0;
        if (t === tv) return 1;
        if (t.includes(tv) || tv.includes(t)) return 0.88;
        return tokenOverlap(hitTitle, title);
      }));
    }

    let durScore = 0.15;
    if (duration > 0 && hitDuration > 0) {
      const diff = Math.abs(hitDuration - duration);
      durScore = diff <= 2 ? 1 : diff <= 6 ? 0.75 : diff <= 15 ? 0.45 : diff <= 30 ? 0.2 : 0;
    }

    return artistScore * 0.4 + titleScore * 0.45 + durScore * 0.15;
  }

  function validateSyncedLrc(synced, minLines = 2) {
    const raw = String(synced || "").trim();
    if (!raw) return null;
    const parsed = ND.LRCParser.parse(raw);
    if (parsed.length < minLines) return null;
    return { synced: raw, parsed };
  }

  async function lrclibFetch(path, params) {
    const qs = params instanceof URLSearchParams ? params.toString() : String(params || "");
    const url = qs ? `https://lrclib.net/api/${path}?${qs}` : `https://lrclib.net/api/${path}`;
    const res = await ND.fetchWithTimeout(url, { headers: LRCLIB_HEADERS });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`lrclib ${res.status}`);
    return res.json();
  }

  async function lrclibSearchMerged(artist, title) {
    const searches = [];
    for (const t of titleSearchVariants(title)) {
      const p = new URLSearchParams({ track_name: t });
      if (artist) p.set("artist_name", artist);
      searches.push(lrclibFetch("search", p));
    }
    if (artist && title) {
      searches.push(lrclibFetch("search", new URLSearchParams({ q: `${artist} ${title}` })));
    }
    const batches = await Promise.all(searches.map(p => p.catch(() => [])));
    const merged = [];
    const seen = new Set();
    for (const batch of batches) {
      if (!Array.isArray(batch)) continue;
      for (const hit of batch) {
        const id = hit.id ?? `${hit.artistName}|${hit.trackName}|${hit.duration}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(hit);
      }
    }
    return merged;
  }

  async function fetchSyncedFromLrclib(artist, title, duration) {
    const getParams = new URLSearchParams({ artist_name: artist, track_name: title });
    if (duration > 0) getParams.set("duration", String(duration));

    const [exact, merged] = await Promise.all([
      lrclibFetch("get-cached", getParams).catch(() => null),
      lrclibSearchMerged(artist, title).catch(() => [])
    ]);

    const exactOk = exact && validateSyncedLrc(exact.syncedLyrics);
    if (exactOk) return { source: "lrclib/get-cached", parsed: exactOk.parsed };

    let best = null, bestScore = -1;
    for (const hit of merged || []) {
      if (!hit?.syncedLyrics?.trim()) continue;
      const s = scoreTrackMatch(hit.artistName, hit.trackName || hit.name, artist, title, duration, hit.duration);
      if (s > bestScore) { bestScore = s; best = hit; }
    }
    if (!best || bestScore < 0.12) throw new Error("lrclib: no synced match");
    const ok = validateSyncedLrc(best.syncedLyrics);
    if (!ok) throw new Error("lrclib: invalid LRC");
    return { source: "lrclib/search", parsed: ok.parsed };
  }

  async function fetchSyncedFromMeting(server, artist, title, duration) {
    const keyword = [artist, title].filter(Boolean).join(" ").trim();
    if (!keyword) throw new Error(`${server}: need artist or title`);
    const searchUrl = `${METING_API}?server=${encodeURIComponent(server)}&type=search&id=0&keyword=${encodeURIComponent(keyword)}`;
    const res = await ND.fetchWithTimeout(searchUrl);
    if (!res.ok) throw new Error(`meting/${server} ${res.status}`);
    const tracks = await res.json();
    if (!Array.isArray(tracks) || !tracks.length) throw new Error(`${server}: no results`);

    let best = tracks[0], bestScore = -1;
    for (const tr of tracks) {
      const s = scoreTrackMatch(tr.artist, tr.name, artist, title, duration, 0);
      if (s > bestScore) { bestScore = s; best = tr; }
    }
    let songId = null;
    try {
      const u = new URL(best.lrc, METING_API);
      songId = u.searchParams.get("id");
    } catch (_) {}
    if (!songId) throw new Error(`${server}: no song id`);

    const lrcUrl = `${METING_API}?server=${encodeURIComponent(server)}&type=lrc&id=${encodeURIComponent(songId)}&format=lrc&lrc_normalize=true`;
    const lrcRes = await ND.fetchWithTimeout(lrcUrl);
    if (!lrcRes.ok) throw new Error(`meting/${server} lrc ${lrcRes.status}`);
    const synced = await lrcRes.text();
    const ok = validateSyncedLrc(synced);
    if (!ok) throw new Error(`${server}: not synced`);
    return { source: server === "netease" ? "netease" : "qq-music", parsed: ok.parsed };
  }

  async function fetchSynced(artist, title, duration) {
    const trySource = fn => fn();
    return Promise.any([
      trySource(() => fetchSyncedFromLrclib(artist, title, duration)),
      trySource(() => fetchSyncedFromMeting("netease", artist, title, duration)),
      trySource(() => fetchSyncedFromMeting("tencent", artist, title, duration))
    ]).catch(() => {
      throw new Error("no synced lyrics available");
    });
  }

  ND.LyricsProvider = { fetchSynced };
})();
