const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 200 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['patient', 'doctor', 'caregiver', 'admin'], required: true, index: true },
    failedLogins: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    resetTokenHash: { type: String, select: false },
    resetTokenExpiry: { type: Date, select: false },
    resetTokenAttempts: { type: Number, default: 0, select: false },
    notificationPhone: { type: String, trim: true, maxlength: 20, default: '' },
    notificationPreferences: {
      email: { type: Boolean, default: false },
      sms: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.failedLogins;
        delete ret.lockUntil;
        delete ret.resetToken;
        delete ret.resetTokenHash;
        delete ret.resetTokenExpiry;
        delete ret.resetTokenAttempts;
        delete ret.notificationPhone;
        delete ret.notificationPreferences;
        delete ret.__v;
        return ret;
      },
    },
  },
);

module.exports = model('User', userSchema);
