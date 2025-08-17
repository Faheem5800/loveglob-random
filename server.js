// Simple Express + Socket.IO matchmaker + WebRTC signaling
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// serve static
app.use(express.static(path.join(__dirname, "public")));

const waiting = []; // [{id, gender, interests:[], ts}]
const rooms = new Map(); // socketId -> roomId
const partners = new Map(); // socketId -> partnerId
const reports = []; // in-memory; persist later

function overlap(a, b) {
  return a.some(t => b.includes(t));
}

function pickMatch(me) {
  // 1) preferred by interests overlap
  const withOverlap = waiting.filter(p => p.id !== me.id && overlap(p.interests, me.interests));
  if (withOverlap.length) return withOverlap[0];
  // 2) anyone
  return waiting.find(p => p.id !== me.id) || null;
}

function pair(a, b) {
  const roomId = `r_${a.id}_${b.id}`;
  [a, b].forEach(s => {
    const sock = io.sockets.sockets.get(s.id);
    if (sock) sock.join(roomId);
  });
  partners.set(a.id, b.id);
  partners.set(b.id, a.id);
  rooms.set(a.id, roomId);
  rooms.set(b.id, roomId);
  io.to(roomId).emit("matched", { roomId });
}

io.on("connection", (socket) => {
  socket.on("join_queue", (payload = {}) => {
    const gender = (payload.gender || "unspecified").toString();
    const interests = (payload.interests || []).map(t => t.toLowerCase().trim()).filter(Boolean);
    const me = { id: socket.id, gender, interests, ts: Date.now() };

    // try to match immediately
    const mate = pickMatch(me);
    if (mate) {
      // remove mate from waiting
      const idx = waiting.findIndex(w => w.id === mate.id);
      if (idx >= 0) waiting.splice(idx, 1);
      pair(me, mate);
    } else {
      waiting.push(me);
      socket.emit("queued");
    }
  });

  socket.on("leave_queue", () => {
    const i = waiting.findIndex(w => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);
  });

  // WebRTC signaling relay
  socket.on("signal", (data) => {
    const roomId = rooms.get(socket.id);
    if (!roomId) return;
    socket.to(roomId).emit("signal", data);
  });

  socket.on("next", () => {
    const pid = partners.get(socket.id);
    const roomId = rooms.get(socket.id);
    if (pid && roomId) {
      io.to(roomId).emit("peer_left");
      const other = io.sockets.sockets.get(pid);
      [socket.id, pid].forEach(id => {
        partners.delete(id);
        rooms.delete(id);
      });
      if (other) other.leave(roomId);
      socket.leave(roomId);
    }
    socket.emit("queued");
    const me = { id: socket.id, gender: "unspecified", interests: [], ts: Date.now() };
    const mate = pickMatch(me);
    if (mate) {
      const idx = waiting.findIndex(w => w.id === mate.id);
      if (idx >= 0) waiting.splice(idx, 1);
      pair(me, mate);
    } else {
      waiting.push(me);
    }
  });

  socket.on("report", ({ reason = "" }) => {
    const pid = partners.get(socket.id) || null;
    reports.push({ reporter: socket.id, offender: pid, reason, at: new Date().toISOString() });
    socket.emit("reported", { ok: true });
  });

  socket.on("disconnect", () => {
    const i = waiting.findIndex(w => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);

    const pid = partners.get(socket.id);
    const roomId = rooms.get(socket.id);
    if (pid && roomId) {
      io.to(roomId).emit("peer_left");
      const other = io.sockets.sockets.get(pid);
      [socket.id, pid].forEach(id => {
        partners.delete(id);
        rooms.delete(id);
      });
      if (other) other.leave(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LoveGlob server running on :${PORT}`));
