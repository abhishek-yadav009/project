const { Schema, model } = require('mongoose');

const ROUTES = ['oral', 'sublingual', 'topical', 'inhalation', 'intravenous', 'intramuscular', 'subcutaneous', 'rectal', 'ophthalmic', 'otic', 'nasal', 'transdermal', 'other'];

const prescriptionSchema = new Schema(
  {
    patient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    prescriber: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    medication: { type: Schema.Types.ObjectId, ref: 'Medication', default: null },
    medicineName: { type: String, required: true, trim: true, maxlength: 200 },
    rxcui: { type: String, default: null },
    activeIngredients: [{ type: String, lowercase: true, trim: true }],
    ingredientSource: { type: String, enum: ['rxnorm', 'prescriber-entered', 'unknown'], default: 'unknown' },
    strength: { type: String, required: true, trim: true, maxlength: 100 },
    dosageInstructions: { type: String, required: true, trim: true, maxlength: 500 },
    route: { type: String, enum: ROUTES, required: true },
    frequency: { type: String, required: true, trim: true, maxlength: 100 },
    scheduleTimes: { type: [String], required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    additionalInstructions: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: ['active', 'discontinued', 'completed'], default: 'active', index: true },
    scheduleEffectiveFrom: { type: Date, default: Date.now },
    discontinuedAt: { type: Date, default: null },
    discontinuedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    discontinueReason: { type: String, default: '' },
    lastSafetyCheck: { type: Schema.Types.ObjectId, ref: 'DrugSafetyCheck', default: null },
  },
  { timestamps: true },
);

prescriptionSchema.index({ patient: 1, status: 1 });

const Prescription = model('Prescription', prescriptionSchema);
Prescription.ROUTES = ROUTES;
module.exports = Prescription;
