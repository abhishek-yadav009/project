const { Schema, model } = require('mongoose');

// Cache of RxNorm lookups (NLM). One document per normalized search name.
const medicationSchema = new Schema(
  {
    nameKey: { type: String, required: true, unique: true },
    queryName: { type: String, required: true },
    matchedName: { type: String, default: null },
    rxcui: { type: String, default: null, index: true },
    tty: { type: String, default: null },
    ingredients: [{ name: String, rxcui: String, _id: false }],
    lookupStatus: { type: String, enum: ['found', 'not_found'], required: true },
    source: { type: String, default: 'RxNorm (U.S. National Library of Medicine)' },
    fetchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = model('Medication', medicationSchema);
