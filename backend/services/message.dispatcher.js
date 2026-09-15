const buildMessagePayload = ({ conversation, message, sender }) => ({
  conversationId: String(conversation._id),
  message: {
    id: String(message?._id || ''),
    content: message?.content || '',
    attachments: Array.isArray(message?.attachments)
      ? message.attachments
      : [],
    senderId: String(sender?._id || message?.sender || ''),
    recipientId: String(message?.recipient || ''),
    senderName: sender?.name || 'Bạn',
    createdAt: message?.createdAt || new Date().toISOString(),
    isMine: true,
  },
});

const getMessagePreview = (message) => {
  if (message.content && message.content.trim()) {
    return message.content.trim().slice(0, 120);
  }

  if (message.attachments?.length > 0) {
    return message.attachments[0].type === 'video'
      ? 'Đã gửi video'
      : 'Đã gửi ảnh';
  }

  return 'Đã gửi tin nhắn';
};

const emitMessage = (socketServer, payload) => {
  if (!socketServer || !payload?.conversationId || !payload.message) {
    return;
  }

  const { conversationId, message } = payload;
  socketServer.to(conversationId).emit('chatMessageReceived', payload);
  socketServer.to(conversationId).emit('conversationUpdated', {
    conversationId,
    preview: getMessagePreview(message),
    lastMessageAt: message.createdAt,
    senderId: message.senderId,
    recipientId: message.recipientId,
    unreadDelta: 0,
  });

  if (message.recipientId) {
    socketServer.to(`user:${message.recipientId}`).emit('messageNotification', {
      ...payload,
      preview: getMessagePreview(message),
      lastMessageAt: message.createdAt,
      unreadDelta: 1,
    });
  }

  if (message.senderId) {
    socketServer.to(`user:${message.senderId}`).emit('messageNotification', {
      ...payload,
      preview: getMessagePreview(message),
      lastMessageAt: message.createdAt,
      unreadDelta: 0,
    });
  }
};

module.exports = {
  buildMessagePayload,
  emitMessage,
};
