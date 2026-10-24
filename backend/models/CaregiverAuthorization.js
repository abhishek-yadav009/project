const { Schema, model } = require('mongoose');

// One model covers both caregivers and doctors: every access path to a patient's
// records goes through a patient-approved grant stored here.
const careAuthorizationSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    grantee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    granteeRole: { type: String, enum: ['doctor', 'caregiver'], required: true },
    status: { type: String, enum: ['pending', 'active', 'revoked', 'declined'], default: 'pending', index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    permissions: {
      viewMedications: { type: Boolean, default: true },
      viewDoses: { type: Boolean, default: true },
      receiveAlerts: { type: Boolean, default: true },
      viewMedicalInfo: { type: Boolean, default: false },
    },
    approvedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

careAuthorizationSchema.index({ grantee: 1, patient: 1, status: 1 });

module.exports = model('CareAuthorization', careAuthorizationSchema);
