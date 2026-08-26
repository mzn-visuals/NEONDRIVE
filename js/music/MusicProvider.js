(function () {
  class MusicProvider {
    constructor(id) { this.id = id; }
    async isAvailable() { return false; }
    async search() { throw new Error("not supported"); }
    async resolveAudioUrl(track) { throw new Error("not supported"); }
    prewarm() {}
    async fetchRadioQueue() { return []; }
    async lookupLink() { return null; }
    canFetchForAnalysis() { return true; }
  }

  ND.fetchWithTimeout = function (url, options = {}, ms = 8000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  ND.MusicProvider = MusicProvider;
})();
