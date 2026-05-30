const Report = require('../models/Report');

exports.createReport = (payload) => Report.create(payload);
exports.findById = (reportId) => Report.findById(reportId);
exports.save = (report) => report.save();