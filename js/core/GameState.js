(function () {
  const S = {
    MENU: "menu",
    LOADING: "loading",
    PLAYING: "playing",
    PAUSED: "paused",
    TRANSITION: "transition",
    RESULTS: "results"
  };

  class GameState {
    constructor() {
      this.current = S.MENU;
    }
    is(...names) { return names.includes(this.current); }
    set(next) {
      if (next === this.current) return;
      const prev = this.current;
      this.current = next;
      ND.bus.emit("state", next, prev);
    }
  }

  ND.State = S;
  ND.gameState = new GameState();
})();
