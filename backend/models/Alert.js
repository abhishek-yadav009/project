const { Schema, model } = require('mongoose');

const alertSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    prescription: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true },
    type: { type: String, enum: ['repeated_missed_doses'], required: true },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    missedCount: { type: Number, required: true },
    threshold: { type: Number, required: true },
    windowDays: { type: Number, required: true },
    doses: [{ type: Schema.Types.ObjectId, ref: 'DoseRecord' }],
    viewedBy: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User' }, at: Date }],
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: '' },
  },
  { timestamps: true },
);

alertSchema.index(
  { patient: 1, prescription: 1, type: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_alert_per_event' },
);

module.exports = model('Alert', alertSchema);
