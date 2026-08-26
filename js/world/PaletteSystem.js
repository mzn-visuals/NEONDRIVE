(function () {
  const DEFAULT_PALETTE = {
    primary: ND.srgb("#ff2fd6"),
    secondary: ND.srgb("#29e6ff"),
    accent: ND.srgb("#ff9d45"),
    dark: ND.srgb("#0a0416"),
    highlight: ND.srgb("#ffe9f9"),
    atmosphere: ND.srgb("#2a0a3d")
  };

  function dominantColors(pixels, N) {
    const buckets = {};
    for (const [r, g, b] of pixels) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 18 || lum > 240) continue;
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      if (!buckets[key]) buckets[key] = { r: 0, g: 0, b: 0, n: 0 };
      buckets[key].r += r; buckets[key].g += g; buckets[key].b += b; buckets[key].n++;
    }
    const sorted = Object.values(buckets).sort((a, b) => b.n - a.n).slice(0, N * 4);
    const picked = [];
    for (const bk of sorted) {
      const r = bk.r / bk.n, g = bk.g / bk.n, b = bk.b / bk.n;
      const tooClose = picked.some(([pr, pg, pb]) => Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 60);
      if (!tooClose) picked.push([r, g, b]);
      if (picked.length >= N) break;
    }
    return picked;
  }

  function extractFromImageUrl(url, proxyRewrite) {
    const tryLoad = src => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("thumbnail load failed"));
      img.src = src;
    });
    return new Promise((resolve, reject) => {
      let img = null;
      tryLoad(url)
        .catch(() => proxyRewrite ? tryLoad(proxyRewrite(url)) : Promise.reject(new Error("no fallback")))
        .then(loaded => {
          img = loaded;
          const canvas = document.createElement("canvas");
          canvas.width = 64; canvas.height = 64;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 64, 64);
          const data = ctx.getImageData(0, 0, 64, 64).data;
          const pixels = [];
          for (let i = 0; i < data.length; i += 16) pixels.push([data[i], data[i + 1], data[i + 2]]);
          resolve(dominantColors(pixels, 4));
        })
        .catch(reject);
    });
  }

  function satOf([r, g, b]) {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
    return mx - mn;
  }

  function buildPalette(rgbList) {
    const list = (rgbList && rgbList.length >= 2) ? rgbList : [[224, 47, 214], [41, 230, 255], [255, 157, 69]];
    const bySat = [...list].sort((a, b) => satOf(b) - satOf(a));
    const vivid = bySat[0], second = bySat[1] || bySat[0], third = bySat[2] || second;

    const primary = new THREE.Color(vivid[0] / 255, vivid[1] / 255, vivid[2] / 255);
    const secondary = new THREE.Color(second[0] / 255, second[1] / 255, second[2] / 255);
    const accent = third ? new THREE.Color(third[0] / 255, third[1] / 255, third[2] / 255) : primary.clone();

    const boost = c => {
      const hsl = {}; c.getHSL(hsl);
      hsl.s = Math.min(1, hsl.s * 1.25 + 0.12);
      hsl.l = THREE.MathUtils.clamp(hsl.l, 0.45, 0.72);
      return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
    };
    const crushDark = c => {
      const hsl = {}; c.getHSL(hsl);
      return new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s + 0.3), 0.035);
    };

    return {
      primary: primary.convertSRGBToLinear(),
      secondary: secondary.convertSRGBToLinear(),
      accent: accent.clone().convertSRGBToLinear(),
      dark: crushDark(primary).convertSRGBToLinear(),
      highlight: boost(primary).lerp(new THREE.Color(1, 1, 1), 0.55).convertSRGBToLinear(),
      atmosphere: crushDark(secondary).convertSRGBToLinear(),
      cssPrimary: toCss(vivid),
      cssSecondary: toCss(second)
    };
  }

  function toCss([r, g, b]) {
    return "#" + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  }

  class PaletteSystem {
    static async extract(track, proxyRewrite) {
      const candidates = [];
      if (track.thumbnail && track.thumbnail.startsWith("http")) candidates.push(track.thumbnail);
      if (track.sourceId && /^[A-Za-z0-9_-]{11}$/.test(track.sourceId)) {
        candidates.push(`https://i.ytimg.com/vi/${track.sourceId}/hqdefault.jpg`);
      }
      for (const url of candidates) {
        try {
          const colors = await extractFromImageUrl(url, proxyRewrite);
          return buildPalette(colors);
        } catch (e) {
          console.warn("[palette] candidate failed:", e.message);
        }
      }
      console.warn("[palette] falling back to default");
      return buildPalette(null);
    }

    static lerp(a, b, t, out) {
      out = out || {};
      for (const k of ["primary", "secondary", "accent", "dark", "highlight", "atmosphere"]) {
        if (!out[k]) out[k] = new THREE.Color();
        out[k].copy(a[k]).lerp(b[k], t);
      }
      out.cssPrimary = t < 0.5 ? a.cssPrimary : b.cssPrimary;
      out.cssSecondary = t < 0.5 ? a.cssSecondary : b.cssSecondary;
      return out;
    }

    static get DEFAULT() { return DEFAULT_PALETTE; }
  }

  ND.PaletteSystem = PaletteSystem;
})();
