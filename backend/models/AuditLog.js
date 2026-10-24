const { Schema, model } = require('mongoose');

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    patient: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    changes: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }],
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

module.exports = model('AuditLog', auditLogSchema);