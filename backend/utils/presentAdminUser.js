const { isManagedAvatarPath } = require('./avatarStorage');
const formatDateTime = require('./formatDateTime');

const DEFAULT_AVATAR = '/images/default-avatar.svg';
const statusLabels = {
  active: 'Đang hoạt động',
  pending: 'Chờ duyệt',
  blocked: 'Đã khóa',
};
const roleLabels = {
  user: 'Người dùng',
  admin: 'Quản trị viên',
};

const formatOptionalDate = (value) =>
  value ? formatDateTime(value) : '';

const presentAdminUser = (user) => {
  const data = user?.toObject ? user.toObject() : user;
  const accountModeration = data.accountModeration || {
    blockedReason: '',
    blockedAt: null,
    blockedBy: null,
    approvedAt: null,
    approvedBy: null,
  };

  return {
    ...data,
    accountModeration,
    avatarUrl: isManagedAvatarPath(data.avatar)
      ? data.avatar
      : DEFAULT_AVATAR,
    statusLabel: statusLabels[data.status] || data.status,
    roleLabel: roleLabels[data.role] || data.role,
    formattedCreatedAt: formatDateTime(data.createdAt),
    formattedUpdatedAt: formatDateTime(data.updatedAt),
    formattedBlockedAt: formatOptionalDate(
      accountModeration.blockedAt,
    ),
    formattedApprovedAt: formatOptionalDate(
      accountModeration.approvedAt,
    ),
  };
};

module.exports = presentAdminUser;
