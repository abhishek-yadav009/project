const { Schema, model } = require('mongoose');

const allergySchema = new Schema(
  {
    substance: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    reaction: { type: String, trim: true, maxlength: 200, default: '' },
    severity: { type: String, enum: ['mild', 'moderate', 'severe', 'unknown'], default: 'unknown' },
  },
  { timestamps: true },
);

const historySchema = new Schema(
  {
    condition: { type: String, required: true, trim: true, maxlength: 200 },
    diagnosedOn: { type: String, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true },
);

const patientProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    dateOfBirth: { type: String, default: null },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    timezone: { type: String, default: 'UTC' },
    allergies: [allergySchema],
    medicalHistory: [historySchema],
  },
  { timestamps: true },
);

module.exports = model('PatientProfile', patientProfileSchema);
