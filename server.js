require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URI,
  credentials: true
}));
app.use(express.json());

// MySQL setup
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
});
db.connect(err => {
  if (err) throw err;
  console.log('Connected to MySQL database!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let waitingUser = null;
const userRoomMap = new Map();  // socket.id => room

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  try {
    const decoded = jwt.verify(token, secret);
    socket.displayname = decoded.displayname;
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    return next(new Error('Authentication failed'));
  }
});

function emitRoomInfo(room) {
  const clients = io.sockets.adapter.rooms.get(room);
  const userCount = clients ? clients.size : 0;
  io.to(room).emit('roomInfo', { users: userCount });
}

function joinRoom(socket) {
  if (socket.room) {
    socket.leave(socket.room);
    socket.room = null;
  }

  if (waitingUser && waitingUser.id !== socket.id) {
    const room = `room-${waitingUser.id}-${socket.id}`;
    socket.join(room);
    waitingUser.join(room);

    socket.room = room;
    waitingUser.room = room;

    userRoomMap.set(socket.id, room);
    userRoomMap.set(waitingUser.id, room);

    io.to(room).emit('systemMessage', `${socket.displayname} เข้าร่วมแชทแล้ว`);
    emitRoomInfo(room);

    waitingUser = null;
  } else {
    waitingUser = socket;
    socket.emit('systemMessage', `${socket.displayname} เข้าร่วมแชทแล้ว`);
  }
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', () => {
    joinRoom(socket);
  });

 socket.on('message', (data) => {
  const room = socket.room;
  if (room) {
    io.to(room).emit('message', {
      sender: socket.displayname,
      text: data.text,
      senderId: socket.id,
    });
  } else {
    socket.emit('message', {
      sender: socket.displayname,
      text: data.text,
      senderId: socket.id,
    });
  }
});



  socket.on('leaveRoom', () => {
    const room = socket.room;
    if (room) {
      socket.leave(room);
      emitRoomInfo(room);
      io.to(room).emit('systemMessage', `${socket.displayname} ออกจากห้องแล้ว`);

      const otherSocketId = [...userRoomMap.entries()]
        .find(([id, r]) => r === room && id !== socket.id)?.[0];
      if (otherSocketId) {
        const otherSocket = io.sockets.sockets.get(otherSocketId);
        if (otherSocket) {
          otherSocket.room = null;
          userRoomMap.delete(otherSocketId);
        }
      }

      userRoomMap.delete(socket.id);
      socket.room = null;
      emitRoomInfo(room);
    }

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    const room = socket.room;
    if (room) {
      socket.to(room).emit('systemMessage', `${socket.displayname} ออกจากห้องแล้ว`);

      const otherSocketId = [...userRoomMap.entries()]
        .find(([id, r]) => r === room && id !== socket.id)?.[0];
      if (otherSocketId) {
        const otherSocket = io.sockets.sockets.get(otherSocketId);
        if (otherSocket) {
          otherSocket.room = null;
          userRoomMap.delete(otherSocketId);
        }
      }

      userRoomMap.delete(socket.id);
      emitRoomInfo(room);
    }

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }
  });
});

server.listen(process.env.POST || 8080, () => {
  console.log('Server is running on http://localhost:8080');
});
