const formatDateTime = require('./formatDateTime');
const presentListing = require('./presentListing');

const presentAdminListing = (listing) => {
  const data = presentListing(listing);

  return {
    ...data,
    formattedUpdatedAt: formatDateTime(data.updatedAt),
    formattedModeratedAt: data.moderation?.moderatedAt
      ? formatDateTime(data.moderation.moderatedAt)
      : '',
    moderationLabel: data.isHiddenByAdmin
      ? 'Ẩn bởi quản trị viên'
      : data.status === 'hidden'
        ? 'Ẩn bởi người bán'
        : 'Không bị ẩn',
  };
};

module.exports = presentAdminListing;
