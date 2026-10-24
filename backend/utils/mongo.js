const mongoose = require('mongoose');

const trustedOperators = (operators) => mongoose.trusted(operators);
const inValues = (values) => trustedOperators({ $in: values });

module.exports = { trustedOperators, inValues };
