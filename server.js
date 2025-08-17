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

// serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

let waiting = [];              // [{id: socketId}]
const partners = new Map();    // socketId -> partnerId
const rooms = new Map();       // socketId -> roomId

function pair(a, b) {
  const room = `room_${a}_${b}_${Date.now()}`;
  rooms.set(a, room);
  rooms.set(b, room);
  partners.set(a, b);
  partners.set(b, a);

  io.to(a).emit('matched', { roomId: room, initiator: true });
  io.to(b).emit('matched', { roomId: room, initiator: false });
}

function tryMatch() {
  while (waiting.length >= 2) {
    const a = waiting.shift().id;
    const b = waiting.shift().id;
    pair(a, b);
  }
}

io.on('connection', (socket) => {
  // join the queue
  socket.on('join_queue', () => {
    if (!waiting.find(w => w.id === socket.id) && !partners.has(socket.id)) {
      waiting.push({ id: socket.id });
      socket.emit('queued');
      tryMatch();
    }
  });

  // forward WebRTC signaling
  socket.on('signal', (data) => {
    const room = rooms.get(socket.id);
    if (!room) return;
    // send to the other peer in the room
    socket.to(room).emit('signal', data);
  });

  // next: leave current room and re-enter queue
  socket.on('next', () => {
    const partnerId = partners.get(socket.id);
    const room = rooms.get(socket.id);

    if (partnerId) {
      partners.delete(socket.id);
      partners.delete(partnerId);
      rooms.delete(socket.id);
      rooms.delete(partnerId);

      io.to(partnerId).emit('peer_left');
    }

    socket.leave(room);
    waiting.push({ id: socket.id });
    socket.emit('queued');
    tryMatch();
  });

  socket.on('disconnect', () => {
    // remove from waiting if present
    waiting = waiting.filter(w => w.id !== socket.id);

    const partnerId = partners.get(socket.id);
    const room = rooms.get(socket.id);

    if (partnerId) {
      partners.delete(socket.id);
      partners.delete(partnerId);
      rooms.delete(socket.id);
      rooms.delete(partnerId);
      io.to(partnerId).emit('peer_left');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`LoveGlob server running on ${PORT}`);
});
