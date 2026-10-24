const { Schema, model } = require('mongoose');

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 200 },
    message: { type: String, required: true, maxlength: 1000 },
    patient: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    alert: { type: Schema.Types.ObjectId, ref: 'Alert', default: null },
    dose: { type: Schema.Types.ObjectId, ref: 'DoseRecord', default: null },
    readAt: { type: Date, default: null },
    channels: {
      inApp: { type: String, default: 'delivered' },
      email: { type: String, default: 'not_configured' },
      sms: { type: String, default: 'not_configured' },
    },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });

module.exports = model('Notification', notificationSchema);
