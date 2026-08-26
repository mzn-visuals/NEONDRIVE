(function () {
  function parseLRC(raw) {
    const lines = String(raw).replace(/\r/g, "").split("\n");
    const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{2,3}))?\]/g;
    const result = [];
    for (const line of lines) {
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      if (!text) continue;
      let m;
      tagRe.lastIndex = 0;
      while ((m = tagRe.exec(line)) !== null) {
        const mins = parseInt(m[1], 10);
        const secs = parseInt(m[2], 10);
        const frac = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) / 1000 : 0;
        result.push({ time: mins * 60 + secs + frac, text });
      }
    }
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  ND.LRCParser = { parse: parseLRC };
})();
