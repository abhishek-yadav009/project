const { DoctorProfile, User } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const facilities = require('../services/facilities');
const { audit, notify } = require('../services/audit');
const { pagination, pageInfo } = require('../utils/pagination');

exports.facilities = async (req, res) => {
  const type = req.query.type || 'both';
  v.oneOf(type, 'type', ['pharmacy', 'hospital', 'both']);
  const types = type === 'both' ? ['pharmacy', 'hospital'] : [type];
  const radius = Math.min(Math.max(parseInt(req.query.radius, 10) || 3000, 500), 15000);

  let lat = req.query.lat !== undefined ? Number(req.query.lat) : null;
  let lon = req.query.lon !== undefined ? Number(req.query.lon) : null;
  let locationLabel = 'Your current location';
  if (lat === null || lon === null) {
    const q = v.str(req.query.q, 'Location', { required: true, min: 2, max: 200 });
    let geo;
    try {
      geo = await facilities.geocode(q);
    } catch (err) {
      throw new HttpError(503, `Location search unavailable (Nominatim): ${err.message}. Try again or enter coordinates.`);
    }
    if (!geo) throw new HttpError(404, `Could not find a location matching "${q}"`);
    ({ lat, lon } = geo);
    locationLabel = geo.displayName;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Invalid coordinates');

  let results;
  try {
    results = await facilities.nearby({ lat, lon, types, radius });
  } catch (err) {
    throw new HttpError(503, `Facility search unavailable (Overpass API): ${err.message}. Please try again shortly.`);
  }
  ok(res, {
    center: { lat, lon, label: locationLabel },
    radius,
    source: facilities.SOURCE,
    note: 'Data is community-maintained and may be incomplete. Pharmacy stock levels are not shown because no verified inventory source is connected. Call ahead to confirm hours and availability.',
    results,
  });
};

exports.listDoctors = async (req, res) => {
  const filter = {};
  if (req.query.status) filter.verificationStatus = v.oneOf(req.query.status, 'status', ['pending', 'verified', 'rejected']);
  const paging = pagination(req.query);
  const query = DoctorProfile.find(filter).populate('user', 'name email').sort({ createdAt: -1 });
  if (paging.enabled) query.skip(paging.skip).limit(paging.limit);
  const docs = await query.lean();
  if (!paging.enabled) return ok(res, docs);
  const total = await DoctorProfile.countDocuments(filter);
  ok(res, { items: docs, pagination: pageInfo(total, paging) });
};

exports.verifyDoctor = async (req, res) => {
  const userId = v.objectId(req.params.userId, 'doctor user id');
  const status = v.oneOf(req.body?.status, 'status', ['verified', 'rejected']);
  const dp = await DoctorProfile.findOne({ user: userId });
  if (!dp) throw new HttpError(404, 'Doctor profile not found');
  const from = dp.verificationStatus;
  dp.verificationStatus = status;
  dp.verifiedBy = req.user._id;
  dp.verifiedAt = new Date();
  await dp.save();
  await audit({ actor: req.user._id, action: 'doctor.verify', entityType: 'DoctorProfile', entityId: dp._id, changes: [{ field: 'verificationStatus', from, to: status }] });
  const user = await User.findById(userId).select('name').lean();
  await notify([userId], { type: 'doctor_verification', title: 'Verification updated', message: `Your doctor account is now ${status}.` });
  ok(res, { ...dp.toObject(), user });
};
