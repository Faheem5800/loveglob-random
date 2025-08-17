// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve the static front-end from /public
app.use(express.static(path.join(__dirname, 'public')));

// (basic socket to confirm server is running)
io.on('connection', (socket) => {
  console.log('user connected:', socket.id);
  socket.on('disconnect', () => console.log('user disconnected:', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`LoveGlob server running on port ${PORT}`));
