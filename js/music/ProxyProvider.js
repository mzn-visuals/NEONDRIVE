(function () {
  const INNER_TUBE_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-KLET5YdCE";
  const CLIENT = {
    clientName: "WEB_REMIX",
    clientVersion: "1.20240101.00.00",
    hl: "en",
    gl: "US"
  };
  const INNER_TUBE_HEADERS = {
    "Content-Type": "application/json",
    "X-YouTube-Client-Name": "67",
    "X-YouTube-Client-Version": "1.20240101.00.00",
    "Origin": "https://music.youtube.com",
    "Referer": "https://music.youtube.com/"
  };

  class ProxyProvider extends ND.MusicProvider {
    constructor(endpoints) {
      super("youtube-music");
      this.endpoints = endpoints.slice();
      this.base = null;
      this._pinging = null;
    }

    async isAvailable() {
      if (this.base) return true;
      if (!this._pinging) {
        this._pinging = this._probe().finally(() => { this._pinging = null; });
      }
      return this._pinging;
    }

    async _probe() {
      for (const base of this.endpoints) {
        if (await this._ping(base, 2600)) { this.base = base.replace(/\/$/, ""); return true; }
        await new Promise(r => setTimeout(r, 250));
        if (await this._ping(base, 2600)) { this.base = base.replace(/\/$/, ""); return true; }
      }
      return false;
    }

    async _ping(base, timeoutMs) {
      try {
        await ND.fetchWithTimeout(`${base}/ping`, {}, timeoutMs);
        return true;
      } catch (_) { return false; }
    }

    localProxyUrl(ytUrl) {
      const u = new URL(ytUrl);
      const p = new URL(this.base);
      p.pathname = u.pathname;
      u.searchParams.forEach((v, k) => p.searchParams.set(k, v));
      p.searchParams.set("__host", u.host);
      return p.toString();
    }

    async _innertube(endpoint, body) {
      const url = this.localProxyUrl(
        `https://music.youtube.com/youtubei/v1/${endpoint}?key=${INNER_TUBE_KEY}`
      );
      const res = await ND.fetchWithTimeout(url, {
        method: "POST",
        headers: INNER_TUBE_HEADERS,
        body: JSON.stringify({ context: { client: CLIENT }, ...body })
      }, 12000);
      if (!res.ok) throw new Error(`innertube ${endpoint} ${res.status}`);
      return res.json();
    }

    _parseSearchResponse(data) {
      const tracks = [];
      const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];
      for (const tab of tabs) {
        const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
        for (const section of sections) {
          const shelf = section?.musicShelfRenderer;
          if (!shelf) continue;
          for (const item of (shelf.contents ?? [])) {
            const r = item?.musicResponsiveListItemRenderer;
            if (!r) continue;
            const videoId =
              r.overlay?.musicItemThumbnailOverlayRenderer
                ?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
                ?.watchEndpoint?.videoId
              || r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer
                ?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
            if (!videoId) continue;
            const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "Unknown";
            const artist = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || "";
            const durText = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text || "";
            const parts = durText.split(":").map(Number);
            const dur = parts.length === 2 ? parts[0] * 60 + parts[1]
                      : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
            const pic = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";
            tracks.push(ND.Track.normalize({ id: videoId, title, artist, duration: dur, pic }, "youtube-music"));
          }
        }
      }
      return tracks;
    }

    async search(query) {
      if (!(await this.isAvailable())) throw new Error("Music service unreachable — is proxy.js running?");
      const data = await this._innertube("search", {
        query,
        params: "EgWKAQIIAWoKEAMQBBAKEAUQCQ%3D%3D"
      });
      const tracks = this._parseSearchResponse(data);
      if (!tracks.length) throw new Error("No results parsed from YouTube Music");
      return tracks.slice(0, 20);
    }

    extractVideoId(text) {
      try {
        const u = new URL(text.trim());
        const host = u.hostname.replace(/^www\./, "");
        if (host === "youtu.be") {
          const id = u.pathname.slice(1);
          return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        if (host === "youtube.com" || host === "music.youtube.com" || host === "m.youtube.com") {
          const v = u.searchParams.get("v");
          if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
          const shorts = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
          if (shorts) return shorts[1];
        }
      } catch (_) {}
      return null;
    }

    async lookupLink(text) {
      if (!(await this.isAvailable())) throw new Error("Music service unreachable");
      const videoId = this.extractVideoId(text);
      if (!videoId) return null;
      const data = await this._innertube("next", { videoId });
      const items =
        data?.contents?.singleColumnMusicWatchNextResultsRenderer
          ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
          ?.tabRenderer?.content?.musicQueueRenderer?.content
          ?.playlistPanelRenderer?.contents ?? [];
      const seed = items.map(i => i?.playlistPanelVideoRenderer).find(r => r?.videoId === videoId);
      if (!seed) throw new Error("Could not resolve that link");
      const title = seed.title?.runs?.[0]?.text || "Unknown";
      const artist = seed.longBylineText?.runs?.[0]?.text || seed.shortBylineText?.runs?.[0]?.text || "";
      const pic = seed.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";
      const lenText = seed.lengthText?.runs?.[0]?.text || "";
      const parts = lenText.split(":").map(Number);
      const dur = parts.length === 2 ? parts[0] * 60 + parts[1]
                : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
      return ND.Track.normalize({ id: videoId, title, artist, duration: dur, pic }, "youtube-music");
    }

    async resolveAudioUrl(track) {
      if (!(await this.isAvailable())) throw new Error("Music service unreachable — is proxy.js running?");
      const res = await ND.fetchWithTimeout(`${this.base}/stream/${track.id}`, {}, 22000);
      if (!res.ok) throw new Error(`stream ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.url) throw new Error("no stream URL in response");
      return this.localProxyUrl(data.url);
    }

    prewarm(track) {
      if (!track?.id) return;
      this.isAvailable().then(alive => {
        if (!alive || !this.base) return;
        fetch(`${this.base}/prewarm/${track.id}`).catch(() => {});
      });
    }

    async fetchRadioQueue(seedTrack) {
      if (!(await this.isAvailable())) return [];
      const data = await this._innertube("next", {
        videoId: seedTrack.id,
        playlistId: "RDAMVM" + seedTrack.id
      });
      const items =
        data?.contents?.singleColumnMusicWatchNextResultsRenderer
          ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]
          ?.tabRenderer?.content?.musicQueueRenderer?.content
          ?.playlistPanelRenderer?.contents ?? [];
      const tracks = [];
      for (const item of items) {
        const r = item?.playlistPanelVideoRenderer;
        if (!r?.videoId || r.videoId === seedTrack.id) continue;
        const title = r.title?.runs?.[0]?.text || "Unknown";
        const artist = r.longBylineText?.runs?.[0]?.text || r.shortBylineText?.runs?.[0]?.text || "";
        const pic = r.thumbnail?.thumbnails?.slice(-1)[0]?.url || "";
        const lenText = r.lengthText?.runs?.[0]?.text || "";
        const parts = lenText.split(":").map(Number);
        const dur = parts.length === 2 ? parts[0] * 60 + parts[1]
                  : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
        tracks.push(ND.Track.normalize({ id: r.videoId, title, artist, duration: dur, pic }, "youtube-music"));
      }
      return tracks;
    }
  }

  ND.ProxyProvider = ProxyProvider;
})();
