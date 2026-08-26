(function () {
  class NetClient {
    constructor(url) {
      this.url = url;
      this.sock = null;
      this.id = null;
      this.code = null;
      this.isHost = false;
      this.offset = 0;
      this.rtt = 0;
      this.players = [];
      this.connected = false;
      this.handlers = new Map();
      this._syncTimer = 0;
    }

    on(evt, fn) {
      if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
      this.handlers.get(evt).add(fn);
    }
    emit(evt, ...args) {
      const s = this.handlers.get(evt);
      if (s) for (const fn of [...s]) fn(...args);
    }

    connect() {
      return new Promise((resolve, reject) => {
        try {
          this.sock = new WebSocket(this.url);
        } catch (e) { reject(e); return; }
        const timeout = setTimeout(() => reject(new Error("connection timeout")), 6000);
        this.sock.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
        };
        this.sock.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("cannot reach co-op server"));
        };
        this.sock.onclose = () => {
          this.connected = false;
          this.emit("disconnected");
        };
        this.sock.onmessage = ev => this._onMessage(JSON.parse(ev.data));
      });
    }

    send(obj) {
      if (this.sock && this.sock.readyState === 1) this.sock.send(JSON.stringify(obj));
    }

    create(name, carIndex) {
      this.send({ t: "create", name, carIndex });
    }

    join(code, name, carIndex) {
      this.send({ t: "join", code: code.toUpperCase(), name, carIndex });
    }

    _onMessage(msg) {
      switch (msg.t) {
        case "created":
          this.id = msg.you;
          this.code = msg.code;
          this.isHost = true;
          this._startTimeSync();
          this.emit("created", msg);
          break;
        case "joined":
          this.id = msg.you;
          this.code = msg.code;
          this.isHost = false;
          this._startTimeSync();
          this.emit("joined", msg);
          break;
        case "you-host":
          this.isHost = true;
          this.emit("you-host");
          break;
        case "lobby":
          this.players = msg.players || [];
          this.emit("lobby", this.players, msg.host);
          break;
        case "session":
          this.emit("session", msg);
          break;
        case "start":
          this.emit("start", msg);
          break;
        case "state":
          this.emit("state", msg);
          break;
        case "event":
          this.emit("event", msg);
          break;
        case "team-combo":
          this.emit("team-combo", msg.count);
          break;
        case "pong": {
          const rtt = Date.now() - msg.t0;
          this.rtt = rtt;
          this.offset = msg.now - msg.t0 - rtt / 2;
          break;
        }
        case "error":
          this.emit("error", msg.msg);
          break;
        case "disconnected":
          break;
      }
    }

    _startTimeSync() {
      if (this._syncTimer) clearInterval(this._syncTimer);
      this._syncTimer = setInterval(() => {
        this.send({ t: "ping", t0: Date.now() });
      }, 2000);
      this.send({ t: "ping", t0: Date.now() });
    }

    serverNow() {
      return Date.now() + this.offset;
    }

    broadcastSession(session) {
      if (this.isHost) this.send({ t: "session", ...session });
    }

    broadcastStart(songStartAt, track) {
      if (this.isHost) this.send({ t: "start", songStartAt, track });
    }

    sendState(car) {
      this.send({
        t: "state",
        s: Math.round(car.s * 100) / 100,
        lat: Math.round(car.lat * 100) / 100,
        yaw: Math.round(car.yawRel * 1000) / 1000,
        spd: Math.round(car.speedKmh),
        nitro: car.nitroActive ? 1 : 0,
        drift: car.drifting ? 1 : 0
      });
    }

    sendEvent(kind, val) {
      this.send({ t: "event", kind, val });
    }

    disconnect() {
      if (this._syncTimer) clearInterval(this._syncTimer);
      if (this.sock) this.sock.close();
      this.sock = null;
      this.connected = false;
    }
  }

  ND.NetClient = NetClient;
})();
