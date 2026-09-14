const messageService = require('../services/message.service');

const loadUnreadMessageCount = async (req, res, next) => {
  res.locals.unreadMessageCount = 0;

  if (!req.user) {
    return next();
  }

  try {
    res.locals.unreadMessageCount =
      await messageService.countUnreadMessages(req.user._id);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  loadUnreadMessageCount,
};
