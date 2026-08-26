(function () {
  class LocalProvider extends ND.MusicProvider {
    constructor() {
      super("local");
      this._objectUrl = null;
    }

    makeTrack(file) {
      if (this._objectUrl) URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = URL.createObjectURL(file);
      const title = file.name.replace(/\.[^.]+$/, "");
      let artist = "Local file";
      const dash = title.split(/\s+-\s+/);
      if (dash.length >= 2) {
        return ND.Track.normalize({
          id: `local:${file.name}`,
          title: dash.slice(1).join(" - "),
          artist: dash[0],
          duration: 0,
          pic: ""
        }, "local");
      }
      return ND.Track.normalize({ id: `local:${file.name}`, title, artist, duration: 0, pic: "" }, "local");
    }

    async resolveAudioUrl(track) {
      if (!this._objectUrl) throw new Error("No local file loaded");
      return this._objectUrl;
    }
  }

  ND.LocalProvider = LocalProvider;
})();
