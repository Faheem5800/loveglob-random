// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// --- in-memory matchmaking state ---
/** waiting: [{ id, ts }]  */
const waiting = [];
/** rooms: socketId -> roomId */
const rooms = new Map();
/** partners: socketId -> partnerId */
const partners = new Map();

function pickMatch(meId) {
  // first non-self waiting user (simple: FIFO)
  const idx = waiting.findIndex(w => w.id !== meId);
  if (idx === -1) return null;
  const mate = waiting.splice(idx, 1)[0]; // remove from queue
  return mate.id;
}

function pair(a, b) {
  const room = `room_${a}_${b}_${Date.now()}`;

  // remember links
  rooms.set(a, room);
  rooms.set(b, room);
  partners.set(a, b);
  partners.set(b, a);

  // IMPORTANT: put both sockets into the same room
  const sa = io.sockets.sockets.get(a);
  const sb = io.sockets.sockets.get(b);
  if (sa) sa.join(room);
  if (sb) sb.join(room);

  // tell each side who starts
  io.to(a).emit('matched', { roomId: room, initiator: true });
  io.to(b).emit('matched', { roomId: room, initiator: false });
}

io.on('connection', (socket) => {
  // user wants to find someone
  socket.on('join_queue', () => {
    // if we can match immediately, do it
    const mateId = pickMatch(socket.id);
    if (mateId) {
      pair(socket.id, mateId);
    } else {
      // add to waiting list if not already there
      if (!waiting.some(w => w.id === socket.id)) {
        waiting.push({ id: socket.id, ts: Date.now() });
        socket.emit('queued');
      }
    }
  });

  socket.on('leave_queue', () => {
    const i = waiting.findIndex(w => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);
  });

  // relay WebRTC signaling within the room
  socket.on('signal', (data) => {
    const roomId = rooms.get(socket.id);
    if (!roomId) return;
    socket.to(roomId).emit('signal', data);
  });

  // user requests next partner
  socket.on('next', () => {
    const partnerId = partners.get(socket.id);
    const roomId = rooms.get(socket.id);

    // unlink
    partners.delete(socket.id);
    rooms.delete(socket.id);

    // make both leave the room
    socket.leave(roomId);
    if (partnerId) {
      partners.delete(partnerId);
      rooms.delete(partnerId);
      const sp = io.sockets.sockets.get(partnerId);
      if (sp) sp.leave(roomId);
      io.to(partnerId).emit('peer_left');
    }

    // requeue current user
    const mateId = pickMatch(socket.id);
    if (mateId) {
      pair(socket.id, mateId);
    } else {
      waiting.push({ id: socket.id, ts: Date.now() });
      socket.emit('queued');
    }
  });

  // clean up on disconnect
  socket.on('disconnect', () => {
    // remove from waiting if there
    const i = waiting.findIndex(w => w.id === socket.id);
    if (i >= 0) waiting.splice(i, 1);

    // notify partner if connected
    const partnerId = partners.get(socket.id);
    const roomId = rooms.get(socket.id);
    partners.delete(socket.id);
    rooms.delete(socket.id);

    if (partnerId) {
      partners.delete(partnerId);
      rooms.delete(partnerId);
      const sp = io.sockets.sockets.get(partnerId);
      if (sp) sp.leave(roomId);
      io.to(partnerId).emit('peer_left');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`LoveGlob server running on port ${PORT}`)
);server.listen(PORT, () => {
  console.log(`LoveGlob server running on ${PORT}`);
});
