const { Schema, model } = require('mongoose');

const findingSchema = new Schema(
  {
    type: { type: String, enum: ['interaction', 'duplicate_ingredient', 'allergy_match', 'missing_info'], required: true },
    severity: { type: String, required: true },
    title: { type: String, required: true },
    detail: { type: String, default: '' },
    excerpt: { type: String, default: '' },
    source: { type: String, required: true },
    sourceUrl: { type: String, default: '' },
    medicines: [String],
  },
  { _id: false },
);

const drugSafetyCheckSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    prescription: { type: Schema.Types.ObjectId, ref: 'Prescription', default: null, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    proposed: {
      name: String,
      matchedName: String,
      rxcui: String,
      ingredients: [String],
      ingredientSource: String,
      lookupStatus: String,
    },
    compared: [{ _id: false, prescription: { type: Schema.Types.ObjectId, ref: 'Prescription' }, name: String, ingredients: [String] }],
    allergiesChecked: [String],
    findings: [findingSchema],
    interactionStatus: { type: String, enum: ['checked', 'partial', 'unavailable', 'not_applicable'], required: true },
    sourcesUsed: [String],
    limitations: [String],
    disclaimer: { type: String, required: true },
  },
  { timestamps: true },
);

module.exports = model('DrugSafetyCheck', drugSafetyCheckSchema);
