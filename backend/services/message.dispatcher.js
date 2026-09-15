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
    senderAvatarUrl: sender?.avatar || '/images/default-avatar.svg',
    senderProfileUrl: sender?._id ? `/users/${String(sender._id)}` : '#',
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

const buildConversationUpdate = ({
  conversationId,
  preview,
  lastMessageAt,
  unreadCountForThisUser,
  totalUnread,
  senderId,
  recipientId,
  markLatest,
}) => ({
  conversationId,
  preview,
  lastMessageAt,
  unreadCountForThisUser: Number(unreadCountForThisUser || 0),
  totalUnread: Number(totalUnread || 0),
  senderId,
  recipientId,
  markLatest,
});

const emitMessage = (
  socketServer,
  payload,
  options = {},
) => {
  if (!socketServer || !payload?.conversationId || !payload.message) {
    return;
  }

  const {
    conversationId,
    message,
  } = payload;

  const preview = getMessagePreview(message);
  const lastMessageAt = message.createdAt;
  const senderId = String(message.senderId || options.senderId || '');
  const recipientId = String(message.recipientId || options.recipientId || '');
  const senderUnreadCount = Number(options.senderUnreadCount || 0);
  const recipientUnreadCount = Number(options.recipientUnreadCount || 0);
  const senderTotalUnread = Number(options.senderTotalUnread || 0);
  const recipientTotalUnread = Number(options.recipientTotalUnread || 0);

  const conversationPayload = {
    conversationId,
    preview,
    lastMessageAt,
    senderId,
    recipientId,
    unreadDelta: 0,
  };

  socketServer.to(conversationId).emit('new_message', {
    ...payload.message,
    conversationId,
  });
  socketServer.to(conversationId).emit('chatMessageReceived', payload);
  socketServer.to(conversationId).emit('conversationUpdated', conversationPayload);
  socketServer.to(conversationId).emit('conversation_update', buildConversationUpdate({
    conversationId,
    preview,
    lastMessageAt,
    unreadCountForThisUser: 0,
    totalUnread: senderTotalUnread,
    senderId,
    recipientId,
    markLatest: true,
  }));

  if (recipientId) {
    const recipientUpdate = buildConversationUpdate({
      conversationId,
      preview,
      lastMessageAt,
      unreadCountForThisUser: recipientUnreadCount,
      totalUnread: recipientTotalUnread,
      senderId,
      recipientId,
      markLatest: true,
    });
    socketServer.to(`user:${recipientId}`).emit('messageNotification', {
      ...payload,
      preview,
      lastMessageAt,
      unreadDelta: 1,
      unreadCountForThisUser: recipientUnreadCount,
      totalUnread: recipientTotalUnread,
    });
    socketServer.to(`user:${recipientId}`).emit('conversation_update', recipientUpdate);
  }

  if (senderId) {
    const senderUpdate = buildConversationUpdate({
      conversationId,
      preview,
      lastMessageAt,
      unreadCountForThisUser: senderUnreadCount,
      totalUnread: senderTotalUnread,
      senderId,
      recipientId,
      markLatest: false,
    });
    socketServer.to(`user:${senderId}`).emit('messageNotification', {
      ...payload,
      preview,
      lastMessageAt,
      unreadDelta: 0,
      unreadCountForThisUser: senderUnreadCount,
      totalUnread: senderTotalUnread,
    });
    socketServer.to(`user:${senderId}`).emit('conversation_update', senderUpdate);
  }
};

module.exports = {
  buildMessagePayload,
  emitMessage,
};
