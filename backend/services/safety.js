const { Prescription, PatientProfile, DrugSafetyCheck } = require('../models');
const rxnorm = require('./rxnorm');
const openfda = require('./openfda');
const { trustedOperators } = require('../utils/mongo');

const DISCLAIMER =
  'Limited prototype. Automated checks support, but do not replace, professional clinical judgment. ' +
  'Interaction findings are text matches against FDA drug label sections (openFDA) and are not a comprehensive ' +
  'clinical interaction database. Absence of a finding does not mean a combination is safe. This tool does not ' +
  'recommend starting, stopping, or changing any medicine.';

const PATIENT_SOURCE = "Patient's recorded allergy list";

function wordMatch(haystack, needle) {
  if (!haystack || !needle) return false;
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(haystack);
}

/**
 * Runs all checks for a proposed medicine against a patient's active prescriptions and allergies.
 * proposed: { medicineName, activeIngredients? (prescriber-entered, used only if RxNorm has no data) }
 */
async function runSafetyCheck({ patientId, requestedBy, proposed, excludePrescriptionId = null, prescriptionId = null }) {
  const findings = [];
  const limitations = [];
  const sourcesUsed = new Set();

  const lookup = await rxnorm.resolveMedicine(proposed.medicineName);
  let ingredients = [];
  let ingredientSource = 'unknown';
  if (lookup.lookupStatus === 'found' && lookup.ingredients?.length) {
    ingredients = lookup.ingredients.map((i) => i.name);
    ingredientSource = 'rxnorm';
    sourcesUsed.add(rxnorm.SOURCE);
  } else if (proposed.activeIngredients?.length) {
    ingredients = proposed.activeIngredients;
    ingredientSource = 'prescriber-entered';
  }

  if (lookup.lookupStatus === 'unavailable') {
    limitations.push('RxNorm lookup unavailable; ingredient data could not be verified.');
    findings.push({ type: 'missing_info', severity: 'information', title: 'Medicine lookup unavailable', detail: 'RxNorm (NLM) could not be reached. Ingredient-based checks rely on prescriber-entered data only.', source: rxnorm.SOURCE, medicines: [proposed.medicineName] });
  } else if (lookup.lookupStatus === 'not_found') {
    findings.push({ type: 'missing_info', severity: 'information', title: 'Medicine not found in RxNorm', detail: `"${proposed.medicineName}" did not match an RxNorm concept. Verify the spelling or enter the active ingredient manually.`, source: rxnorm.SOURCE, medicines: [proposed.medicineName] });
  }
  if (!ingredients.length) {
    limitations.push('Active ingredients unknown; duplicate-ingredient, allergy-ingredient, and interaction checks are incomplete.');
    findings.push({ type: 'missing_info', severity: 'information', title: 'Active ingredient unknown', detail: 'No reliable ingredient data is available for this medicine.', source: 'System', medicines: [proposed.medicineName] });
  } else if (ingredientSource === 'prescriber-entered') {
    limitations.push('Ingredients were entered by the prescriber and not verified against RxNorm.');
  }

  const activeFilter = { patient: patientId, status: 'active' };
  if (excludePrescriptionId) activeFilter._id = trustedOperators({ $ne: excludePrescriptionId });
  const existing = await Prescription.find(activeFilter).select('medicineName activeIngredients').lean();

  for (const rx of existing) {
    if (!rx.activeIngredients?.length) {
      findings.push({ type: 'missing_info', severity: 'information', title: `Ingredients unknown for ${rx.medicineName}`, detail: 'This active medicine could not be included in ingredient-level checks.', source: 'System', medicines: [rx.medicineName] });
    }
    const dup = rx.activeIngredients?.filter((i) => ingredients.includes(i)) || [];
    if (dup.length) {
      findings.push({
        type: 'duplicate_ingredient',
        severity: 'not rated by source',
        title: `Duplicate active ingredient: ${dup.join(', ')}`,
        detail: `${proposed.medicineName} and the active prescription ${rx.medicineName} share the same active ingredient(s).`,
        source: ingredientSource === 'rxnorm' ? rxnorm.SOURCE : 'Prescriber-entered ingredient data',
        medicines: [proposed.medicineName, rx.medicineName],
      });
    }
  }

  const profile = await PatientProfile.findOne({ user: patientId }).select('allergies').lean();
  const allergies = profile?.allergies || [];
  for (const a of allergies) {
    const ingredientHit = ingredients.find((i) => i === a.substance || wordMatch(i, a.substance) || wordMatch(a.substance, i));
    const nameHit = !ingredientHit && wordMatch(proposed.medicineName, a.substance);
    if (ingredientHit || nameHit) {
      findings.push({
        type: 'allergy_match',
        severity: `patient-recorded: ${a.severity}`,
        title: `Allergy match: ${a.substance}`,
        detail: ingredientHit
          ? `Active ingredient "${ingredientHit}" matches the recorded allergy "${a.substance}"${a.reaction ? ` (reaction: ${a.reaction})` : ''}.`
          : `Medicine name contains the recorded allergy "${a.substance}".`,
        source: PATIENT_SOURCE + (ingredientHit && ingredientSource === 'rxnorm' ? ' + RxNorm ingredients' : ''),
        medicines: [proposed.medicineName],
      });
    }
  }
  if (allergies.length) sourcesUsed.add(PATIENT_SOURCE);

  let interactionStatus = 'not_applicable';
  const others = existing.filter((r) => r.activeIngredients?.length);
  if (ingredients.length && others.length) {
    let failures = 0;
    let missingLabels = 0;
    const labels = new Map();
    const allIngredients = [...new Set([...ingredients, ...others.flatMap((r) => r.activeIngredients)])];
    await Promise.all(allIngredients.map(async (ing) => {
      try {
        labels.set(ing, await openfda.getLabel(ing));
      } catch (err) {
        failures += 1;
        labels.set(ing, { status: 'error', error: err.message });
      }
    }));

    for (const [ing, label] of labels) {
      if (label.status === 'not_found') {
        missingLabels += 1;
        limitations.push(`No FDA label found for "${ing}"; its label could not be checked.`);
      } else if (label.status === 'error') {
        limitations.push(`FDA label lookup failed for "${ing}".`);
      }
    }

    const seen = new Set();
    for (const rx of others) {
      for (const a of ingredients) {
        for (const b of rx.activeIngredients) {
          if (a === b) continue;
          for (const [labelOf, term] of [[a, b], [b, a]]) {
            const label = labels.get(labelOf);
            if (label?.status !== 'found') continue;
            const hit = openfda.findMention(label, term);
            const key = `${labelOf}|${term}`;
            if (!hit || seen.has(key)) continue;
            seen.add(key);
            findings.push({
              type: 'interaction',
              severity: 'not rated by source',
              title: `Possible interaction: ${a} + ${b}`,
              detail: `The FDA label for ${labelOf} mentions ${term} in its "${hit.section}" section.`,
              excerpt: hit.excerpt,
              source: openfda.SOURCE,
              sourceUrl: label.url,
              medicines: [proposed.medicineName, rx.medicineName],
            });
          }
        }
      }
    }

    const total = labels.size;
    if (failures === total) interactionStatus = 'unavailable';
    else if (failures || missingLabels) interactionStatus = 'partial';
    else interactionStatus = 'checked';
    if (failures < total) sourcesUsed.add(openfda.SOURCE);
  } else if (ingredients.length === 0 && others.length) {
    interactionStatus = 'unavailable';
    limitations.push('Interaction check unavailable because the proposed medicine has no known ingredients.');
  }

  return DrugSafetyCheck.create({
    patient: patientId,
    prescription: prescriptionId,
    requestedBy,
    proposed: {
      name: proposed.medicineName,
      matchedName: lookup.matchedName || null,
      rxcui: lookup.rxcui || null,
      ingredients,
      ingredientSource,
      lookupStatus: lookup.lookupStatus,
    },
    compared: existing.map((r) => ({ prescription: r._id, name: r.medicineName, ingredients: r.activeIngredients })),
    allergiesChecked: allergies.map((a) => a.substance),
    findings,
    interactionStatus,
    sourcesUsed: [...sourcesUsed],
    limitations: [...new Set(limitations)],
    disclaimer: DISCLAIMER,
  });
}

module.exports = { runSafetyCheck, DISCLAIMER };
