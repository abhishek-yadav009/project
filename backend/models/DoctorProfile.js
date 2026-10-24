const { Schema, model } = require('mongoose');

const doctorProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    licenseNumber: { type: String, required: true, trim: true, maxlength: 50 },
    specialty: { type: String, trim: true, maxlength: 100, default: '' },
    organization: { type: String, trim: true, maxlength: 150, default: '' },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', index: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = model('DoctorProfile', doctorProfileSchema);
