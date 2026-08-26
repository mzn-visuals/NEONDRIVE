(function () {
  window.addEventListener("DOMContentLoaded", () => {
    const settings = (() => {
      try {
        return JSON.parse(localStorage.getItem(ND.Config.STORE_KEYS.settings) || "{}");
      } catch (_) { return {}; }
    })();

    const game = new ND.Game(document.getElementById("gl"), {
      quality: settings.quality || "medium",
      volume: settings.volume != null ? settings.volume : 0.8,
      lyrics: settings.lyrics !== false,
      proxyUrl: settings.proxyUrl || "",
      carIndex: settings.carIndex || 0
    });

    const ui = new ND.UI(game);
    game.ui = ui;
    ui.show("main");
    window.__game = game;
    game.previewWorld();

    ND.bus.emit("settings-quality", settings.quality || "medium");
    ND.bus.emit("settings-camera", settings.camera || "chase");
    ND.bus.emit("settings-shake", settings.shake != null ? settings.shake : 1);
    ND.bus.emit("settings-fov", settings.fovScale != null ? settings.fovScale : 1);

    (async function probeProxy() {
      ui.setProxyStatus("SCANNING FOR MUSIC SERVICE…");
      const alive = await game.providers.proxy.isAvailable();
      if (alive) {
        ui.setProxyStatus("MUSIC SERVICE CONNECTED · " + game.providers.proxy.base.replace(/^https?:\/\//, ""), "ok");
      } else {
        ui.setProxyStatus("NO MUSIC SERVICE — RUN node proxy.js OR USE LOCAL FILES", "bad");
      }
    })();

    ND.loop.start();
  });
})();
