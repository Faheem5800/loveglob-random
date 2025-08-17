// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

/** ---------------- Matchmaking state ---------------- **/
const waiting = [];             // [{id, ts}]
const partners = new Map();     // socketId -> partnerId
const rooms = new Map();        // socketId -> roomId

function makeRoomId(a, b) {
  return `r_${a}_${b}`;
}
function pair(a, b) {
  const roomId = makeRoomId(a, b);
  partners.set(a, b);
  partners.set(b, a);
  rooms.set(a, roomId);
  const sa = io.sockets.sockets.get(a);
  const sb = io.sockets.sockets.get(b);
  if (sa) sa.join(roomId);
  if (sb) sb.join(roomId);
  io.to(roomId).emit("matched", { roomId });
}

/** ---------------- Socket handlers ---------------- **/
io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("join_queue", () => {
    if (partners.has(socket.id)) return;

    const other = waiting.shift();
    if (other && other.id !== socket.id) {
      pair(socket.id, other.id);
    } else {
      waiting.push({ id: socket.id, ts: Date.now() });
      socket.emit("queued");
    }
  });

  socket.on("leave_queue", () => {
    const i = waiting.findIndex((w) => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);
  });

  socket.on("signal", (data) => {
    const roomId = rooms.get(socket.id);
    if (!roomId) return;
    socket.to(roomId).emit("signal", data);
  });

  socket.on("next", () => {
    const pid = partners.get(socket.id);
    const roomId = rooms.get(socket.id);
    if (roomId) {
      io.to(roomId).emit("peer_left");
      [socket.id, pid].forEach((id) => {
        partners.delete(id);
        rooms.delete(id);
        const s = io.sockets.sockets.get(id);
        if (s) s.leave(roomId);
      });
    }
    socket.emit("queued");
    waiting.unshift({ id: socket.id, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
    const i = waiting.findIndex((w) => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);

    const pid = partners.get(socket.id);
    const roomId = rooms.get(socket.id);
    if (pid && roomId) {
      io.to(roomId).emit("peer_left");
      [socket.id, pid].forEach((id) => {
        partners.delete(id);
        rooms.delete(id);
        const s = io.sockets.sockets.get(id);
        if (s) s.leave(roomId);
      });
    }
  });
});

/** ---------------- Start server (ONE listen) ---------------- **/
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LoveGlob server running on ${PORT}`);
});
