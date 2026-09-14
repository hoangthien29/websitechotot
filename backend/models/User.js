const mongoose = require('mongoose');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Tên người dùng là bắt buộc.'],
      trim: true,
      minlength: [2, 'Tên người dùng phải có ít nhất 2 ký tự.'],
      maxlength: [100, 'Tên người dùng không được vượt quá 100 ký tự.'],
    },
    email: {
      type: String,
      required: [true, 'Email là bắt buộc.'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email không được vượt quá 254 ký tự.'],
      match: [emailPattern, 'Email không đúng định dạng.'],
    },
    password: {
      type: String,
      required: [true, 'Mật khẩu là bắt buộc.'],
      minlength: [8, 'Mật khẩu phải có ít nhất 8 ký tự.'],
      maxlength: [72, 'Mật khẩu không được vượt quá 72 ký tự.'],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: [20, 'Số điện thoại không được vượt quá 20 ký tự.'],
    },
    avatar: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: [200, 'Địa chỉ không được vượt quá 200 ký tự.'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'blocked', 'pending'],
      default: 'active',
    },
    accountModeration: {
      blockedReason: {
        type: String,
        trim: true,
        maxlength: 500,
        default: '',
      },
      blockedAt: {
        type: Date,
        default: null,
      },
      blockedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      approvedAt: {
        type: Date,
        default: null,
      },
      approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
