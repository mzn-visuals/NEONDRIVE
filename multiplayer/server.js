#!/usr/bin/env node
/**
 * multiplayer/server.js — NEON//DRIVE co-op session server (no dependencies).
 *
 * Usage: node multiplayer/server.js   (default port 9433, PORT env to override)
 */
const http = require("http");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "9433", 10);
const MAX_PLAYERS = 4;

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 4; i++) c += chars[crypto.randomInt(chars.length)];
  return rooms.has(c) ? makeCode() : c;
}

function wsSend(sock, obj) {
  if (!sock || sock.destroyed) return;
  const payload = Buffer.from(JSON.stringify(obj));
  const maskBit = 0;
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = maskBit | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = maskBit | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  header[0] = 0x81;
  sock.write(Buffer.concat([header, payload]));
}

function broadcast(room, obj, except) {
  for (const p of room.players) {
    if (p.sock !== except && p.sock && !p.sock.destroyed) wsSend(p.sock, obj);
  }
}

function roomInfo(room) {
  return {
    t: "lobby",
    code: room.code,
    host: room.host ? room.host.id : null,
    players: room.players.map(p => ({ id: p.id, name: p.name, carIndex: p.carIndex, ready: p.ready }))
  };
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end("nd-mp-ok");
    return;
  }
  res.writeHead(426);
  res.end("websocket only");
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key || !req.url.startsWith("/mp")) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);

  const client = {
    sock: socket,
    id: crypto.randomBytes(4).toString("hex"),
    name: "DRIVER",
    carIndex: 0,
    room: null,
    ready: false,
    buffer: Buffer.alloc(0)
  };

  socket.on("data", chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (true) {
      const frame = decodeFrame(client.buffer);
      if (!frame) break;
      client.buffer = client.buffer.slice(frame.total);
      if (frame.op === 8) { cleanup(); socket.destroy(); return; }
      if (frame.op === 9) { socket.write(encodePong(frame.payload)); continue; }
      if (frame.op !== 1) continue;
      let msg;
      try { msg = JSON.parse(frame.payload.toString("utf8")); } catch (_) { continue; }
      handleMessage(client, msg);
    }
  });

  socket.on("error", () => cleanup());
  socket.on("close", () => cleanup());

  function cleanup() {
    if (client.room) {
      const room = client.room;
      room.players = room.players.filter(p => p !== client);
      if (room.host === client && room.players.length) {
        room.host = room.players[0];
        wsSend(room.host.sock, { t: "you-host" });
      }
      broadcast(room, roomInfo(room));
      if (!room.players.length) rooms.delete(room.code);
      client.room = null;
    }
  }

  function handleMessage(client, msg) {
    const now = Date.now();
    switch (msg.t) {
      case "ping": wsSend(client.sock, { t: "pong", t0: msg.t0, now }); break;
      case "create": {
        const code = makeCode();
        const room = { code, players: [client], host: client, session: null, startAt: 0 };
        rooms.set(code, room);
        client.room = room;
        client.name = (msg.name || "DRIVER").slice(0, 12);
        client.carIndex = msg.carIndex | 0;
        wsSend(client.sock, { t: "created", code, you: client.id, now });
        break;
      }
      case "join": {
        const room = rooms.get(String(msg.code || "").toUpperCase());
        if (!room) { wsSend(client.sock, { t: "error", msg: "ROOM NOT FOUND" }); break; }
        if (room.players.length >= MAX_PLAYERS) { wsSend(client.sock, { t: "error", msg: "ROOM FULL" }); break; }
        client.room = room;
        client.name = (msg.name || "DRIVER").slice(0, 12);
        client.carIndex = msg.carIndex | 0;
        room.players.push(client);
        wsSend(client.sock, { t: "joined", code: room.code, you: client.id, now });
        broadcast(room, roomInfo(room));
        if (room.session) wsSend(client.sock, { t: "session", ...room.session });
        break;
      }
      case "lobby-update": {
        if (!client.room || client !== client.room.host) break;
        broadcast(client.room, { t: "lobby", code: client.room.code, host: client.id, players: client.room.players.map(p => ({ id: p.id, name: p.name, carIndex: p.carIndex })) });
        break;
      }
      case "session": {
        if (!client.room || client !== client.room.host) break;
        client.room.session = msg;
        broadcast(client.room, { t: "session", ...msg }, client.sock);
        break;
      }
      case "start": {
        if (!client.room || client !== client.room.host) break;
        client.room.startAt = msg.songStartAt;
        broadcast(client.room, { t: "start", songStartAt: msg.songStartAt, track: msg.track }, client.sock);
        break;
      }
      case "state": {
        if (!client.room) break;
        broadcast(client.room, {
          t: "state", id: client.id, s: msg.s, lat: msg.lat,
          yaw: msg.yaw, spd: msg.spd, nitro: msg.nitro ? 1 : 0, drift: msg.drift ? 1 : 0
        }, client.sock);
        break;
      }
      case "event": {
        if (!client.room) break;
        broadcast(client.room, { t: "event", id: client.id, kind: msg.kind, val: msg.val }, client.sock);
        if (msg.kind === "hit") {
          const room = client.room;
          room.recentHits = (room.recentHits || []).filter(h => now - h.at < 2000);
          room.recentHits.push({ at: now, q: msg.val });
          if (room.recentHits.length >= 3) {
            broadcast(room, { t: "team-combo", count: room.recentHits.length });
            room.recentHits = [];
          }
        }
        break;
      }
    }
  }
});

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const op = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2); off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2)); off = 10;
  }
  let maskKey = null;
  if (masked) {
    if (buf.length < off + 4) return null;
    maskKey = buf.slice(off, off + 4);
    off += 4;
  }
  if (buf.length < off + len) return null;
  const payload = Buffer.from(buf.slice(off, off + len));
  if (maskKey) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }
  return { op, payload, total: off + len };
}

function encodePong(payload) {
  const header = Buffer.alloc(2 + (payload.length > 125 ? 2 : 0));
  header[0] = 0x8a;
  if (payload.length > 125) {
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = payload.length;
  }
  return Buffer.concat([header, payload]);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NEON//DRIVE co-op server listening on ws://0.0.0.0:${PORT}/mp`);
});
