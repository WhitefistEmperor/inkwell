// WebSocket layer (Socket.io). HTTP is request/response: the server cannot
// speak first. A WebSocket stays open, so the server can push an event the
// moment something happens, instead of the browser polling every few seconds.
//
// Rooms decide who receives what:
//   user:<id>       one per signed-in user  -> their notifications
//   article:<slug>  everyone reading a page -> live comments
import { Server } from 'socket.io';
import { config } from './config.js';
import { verifyToken } from './middleware.js';

let io = null; // stays null in tests that never start a real server

export function attachRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: config.clientOrigin } });

  // Runs once per connection, before any event. The same JWT used for HTTP
  // identifies the socket; a missing or bad token just means "anonymous".
  io.use((socket, next) => {
    socket.userId = verifyToken(socket.handshake.auth?.token);
    next();
  });

  io.on('connection', (socket) => {
    // The server picks this room from the verified token. A client has no way
    // to join another user's room, so notifications stay private.
    if (socket.userId) socket.join(`user:${socket.userId}`);

    // Article rooms are public: anyone may read comments anyway.
    socket.on('article:join', (slug) => typeof slug === 'string' && socket.join(`article:${slug}`));
    socket.on('article:leave', (slug) => typeof slug === 'string' && socket.leave(`article:${slug}`));
  });

  return io;
}

export const emitToUser = (userId, event, payload) => io?.to(`user:${userId}`).emit(event, payload);
export const emitToArticle = (slug, event, payload) => io?.to(`article:${slug}`).emit(event, payload);
