const { Schema, model } = require('mongoose');

const STATUSES = ['upcoming', 'taken', 'missed', 'skipped', 'cancelled'];

const doseRecordSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    prescription: { type: Schema.Types.ObjectId, ref: 'Prescription', required: true },
    scheduledAt: { type: Date, required: true },
    localDate: { type: String, required: true },
    localTime: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: 'upcoming' },
    statusRecordedAt: { type: Date, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    autoMarked: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 300, default: '' },
    overdueNotified: { type: Boolean, default: false },
    history: [
      {
        _id: false,
        from: String,
        to: String,
        at: Date,
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        note: String,
      },
    ],
  },
  { timestamps: true },
);

doseRecordSchema.index({ prescription: 1, scheduledAt: 1 }, { unique: true });
doseRecordSchema.index({ patient: 1, scheduledAt: 1 });
doseRecordSchema.index({ status: 1, scheduledAt: 1 });

const DoseRecord = model('DoseRecord', doseRecordSchema);
DoseRecord.STATUSES = STATUSES;
module.exports = DoseRecord;
