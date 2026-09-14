const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: [true, 'Bài đăng là bắt buộc.'],
      immutable: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người mua là bắt buộc.'],
      immutable: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Người bán là bắt buộc.'],
      immutable: true,
    },
    lastMessagePreview: {
      type: String,
      trim: true,
      maxlength: [200, 'Nội dung xem trước không được vượt quá 200 ký tự.'],
      default: '',
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastSender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

conversationSchema.index(
  {
    listing: 1,
    buyer: 1,
    seller: 1,
  },
  {
    unique: true,
  },
);
conversationSchema.index({
  buyer: 1,
  lastMessageAt: -1,
  createdAt: -1,
});
conversationSchema.index({
  seller: 1,
  lastMessageAt: -1,
  createdAt: -1,
});

module.exports =
  mongoose.models.Conversation ||
  mongoose.model('Conversation', conversationSchema);
