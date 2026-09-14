const { isManagedAvatarPath } = require('./avatarStorage');
const formatDateTime = require('./formatDateTime');

const DEFAULT_AVATAR = '/images/default-avatar.svg';

const getReferenceId = (value) => value?._id || value;

const presentMessage = (message, currentUserId) => {
  const data = message?.toObject ? message.toObject() : message;
  const senderId = getReferenceId(data.sender)?.toString();

  return {
    id: data._id.toString(),
    content: data.content,
    formattedCreatedAt: formatDateTime(data.createdAt),
    isMine: senderId === currentUserId?.toString(),
    isRead: Boolean(data.readAt),
    senderName: data.sender?.name || 'Người dùng',
    senderAvatarUrl: isManagedAvatarPath(data.sender?.avatar)
      ? data.sender.avatar
      : DEFAULT_AVATAR,
  };
};

module.exports = presentMessage;
