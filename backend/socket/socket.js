const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const messageService = require('../services/message.service');

let io;

const closeSocket = () =>
  new Promise((resolve) => {
    if (!io) {
      resolve();
      return;
    }

    io.close(() => resolve());
  });

const initSocket = (server, sessionMiddleware) => {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  if (sessionMiddleware) {
    io.engine.use(sessionMiddleware);
  }

  io.on('connection', (socket) => {
    socket.userId = socket.request.session?.userId || '';

    const joinUserRoom = () => {
      if (socket.userId) {
        socket.join(`user:${String(socket.userId)}`);
      }
    };

    joinUserRoom();
    socket.on('joinUser', joinUserRoom);

    socket.on('leaveUser', () => {
      if (socket.userId) {
        socket.leave(`user:${String(socket.userId)}`);
      }
    });

    socket.on('joinConversation', async (conversationId) => {
      if (!socket.userId || !mongoose.isValidObjectId(conversationId)) {
        return;
      }

      const conversation = await Conversation.exists({
        _id: conversationId,
        $or: [{ buyer: socket.userId }, { seller: socket.userId }],
      });

      if (conversation) {
        socket.join(String(conversationId));
      }
    });

    socket.on('leaveConversation', (conversationId) => {
      if (conversationId) {
        socket.leave(String(conversationId));
      }
    });

    socket.on('mark_read', async ({ conversationId, userId } = {}) => {
      if (!socket.userId || !mongoose.isValidObjectId(conversationId)) {
        return;
      }

      const targetUserId = String(userId || socket.userId);
      if (targetUserId !== String(socket.userId)) {
        return;
      }

      await messageService.markConversationAsRead(conversationId, targetUserId);
      const unreadCountForThisUser = await messageService.getConversationUnreadCount(
        conversationId,
        targetUserId,
      );
      const totalUnread = await messageService.countUnreadMessages(targetUserId);

      socket.to(`user:${targetUserId}`).emit('conversation_update', {
        conversationId: String(conversationId),
        preview: '',
        lastMessageAt: new Date().toISOString(),
        unreadCountForThisUser,
        totalUnread,
      });
      socket.emit('conversation_update', {
        conversationId: String(conversationId),
        preview: '',
        lastMessageAt: new Date().toISOString(),
        unreadCountForThisUser: 0,
        totalUnread,
      });
    });

  });

  return io;
};

module.exports = {
  closeSocket,
  initSocket,
  getSocketServer: () => io,
};
