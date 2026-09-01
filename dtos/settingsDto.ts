const Joi = require('joi');

const EMAIL_DOMAIN = /^@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z]{2,})+$/;

const EDITABLE_SETTING_FIELDS = Object.freeze([
  'defaultUserQuota',
  'studentQuota',
  'studentDefaultTrustLevel',
  'level2Quota',
  'maxBookingsPerUser',
  'maxActiveRequestsPerMonth',
  'maxActiveDonationsPerUser',
  'maxActiveDonationsLevel2Plus',
  'maxWaitlistPerItem',
  'bookingExpiryHours',
  'requestExpiryDays',
  'donorQuotaReward',
  'trustScorePerDonation',
  'trustScorePerRequest',
  'ratingThresholdExcellent',
  'ratingThresholdGood',
  'ratingThresholdNeutral',
  'ratingThresholdBad',
  'categories',
  'locations',
  'reportReasons',
  'autoReportBanThreshold',
  'appealWindowHours',
  'otpExpiryMinutes',
  'maxOtpAttempts',
  'resetPasswordExpiryMinutes',
  'maxAvatarSizeMb',
  'avatarWidth',
  'avatarHeight',
  'maxPageSize',
  'profilePageSize',
  'adminPageSize',
  'adminReportsPageSize',
  'minTrustLevelForRequests',
  'minTrustLevelForDonating',
  'maxPendingOffersPerDonor',
  'universityEmailDomains',
  'quotaResetDayOfMonth',
  'requireHubForBooking',
  'maintenanceMode',
  'platformName',
  'contactEmail',
]);

const updateSettings = Joi.object({
  defaultUserQuota:               Joi.number().integer().min(1).max(20),
  studentQuota:                   Joi.number().integer().min(1).max(20),
  studentDefaultTrustLevel:       Joi.number().integer().min(1).max(2),
  level2Quota:                    Joi.number().integer().min(1).max(20),
  maxBookingsPerUser:             Joi.number().integer().min(1).max(10),
  maxActiveRequestsPerMonth:      Joi.number().integer().min(1).max(5),
  maxActiveDonationsPerUser:      Joi.number().integer().min(1).max(20),
  maxActiveDonationsLevel2Plus:   Joi.number().integer().min(1).max(20),
  maxWaitlistPerItem:              Joi.number().integer().min(1).max(50),
  bookingExpiryHours:             Joi.number().integer().min(1).max(336),
  requestExpiryDays:              Joi.number().integer().min(1).max(180),
  donorQuotaReward:               Joi.number().integer().min(0).max(5),
  trustScorePerDonation:          Joi.number().integer().min(0).max(20),
  trustScorePerRequest:           Joi.number().integer().min(0).max(10),
  ratingThresholdExcellent:       Joi.number().integer().min(1).max(10),
  ratingThresholdGood:            Joi.number().integer().min(1).max(10),
  ratingThresholdNeutral:         Joi.number().integer().min(1).max(10),
  ratingThresholdBad:             Joi.number().integer().min(1).max(10),
  categories: Joi.array()
    .items(Joi.string().trim().min(2).max(50))
    .min(1)
    .max(30),
  locations: Joi.array()
    .items(Joi.string().trim().min(2).max(60))
    .min(1)
    .max(30),
  reportReasons: Joi.array()
    .items(Joi.string().trim().min(2).max(100))
    .min(1)
    .max(50),
  autoReportBanThreshold:         Joi.number().integer().min(1).max(20),
  appealWindowHours:               Joi.number().integer().min(1).max(336),
  otpExpiryMinutes:               Joi.number().integer().min(1).max(60),
  maxOtpAttempts:                 Joi.number().integer().min(3).max(10),
  resetPasswordExpiryMinutes:     Joi.number().integer().min(5).max(60),
  maxAvatarSizeMb:                Joi.number().integer().min(1).max(20),
  avatarWidth:                    Joi.number().integer().min(100).max(1000),
  avatarHeight:                   Joi.number().integer().min(100).max(1000),
  maxPageSize:                    Joi.number().integer().min(5).max(100),
  profilePageSize:                Joi.number().integer().min(5).max(50),
  adminPageSize:                  Joi.number().integer().min(5).max(100),
  adminReportsPageSize:           Joi.number().integer().min(5).max(50),
  minTrustLevelForRequests:       Joi.number().integer().min(1).max(2),
  minTrustLevelForDonating:       Joi.number().integer().min(1).max(2),
  maxPendingOffersPerDonor:       Joi.number().integer().min(1).max(20),
  universityEmailDomains: Joi.array()
    .items(
      Joi.string()
        .trim()
        .lowercase()
        .pattern(EMAIL_DOMAIN)
        .message('كل نطاق يجب أن يبدأ بـ @ مثل @ju.edu.jo')
    )
    .max(50),
  quotaResetDayOfMonth:           Joi.number().integer().min(1).max(28),
  requireHubForBooking:           Joi.boolean(),
  maintenanceMode:                Joi.boolean(),
  platformName:                   Joi.string().trim().min(2).max(100),
  contactEmail:                   Joi.string().trim().lowercase().max(254)
    .email({ tlds: { allow: false } }),
})
  .min(1)
  .unknown(false);

const assertSettingsInvariants = (settings) => {
  const thresholds = [
    Number(settings.ratingThresholdExcellent),
    Number(settings.ratingThresholdGood),
    Number(settings.ratingThresholdNeutral),
    Number(settings.ratingThresholdBad),
  ];

  if (!(thresholds[0] > thresholds[1]
    && thresholds[1] > thresholds[2]
    && thresholds[2] > thresholds[3])) {
    const error = new Error(
      'يجب أن تكون حدود التقييم مرتبة تنازلياً: ممتاز > جيد > محايد > سيئ'
    ) as Error & { statusCode?: number; code?: string };
    error.statusCode = 422;
    error.code = 'INVALID_RATING_THRESHOLDS';
    throw error;
  }

  if (Number(settings.maxActiveDonationsLevel2Plus) < Number(settings.maxActiveDonationsPerUser)) {
    const error = new Error(
      'حد تبرعات Level 2 لا يمكن أن يقل عن حد Level 1'
    ) as Error & { statusCode?: number; code?: string };
    error.statusCode = 422;
    error.code = 'INVALID_DONATION_LIMITS';
    throw error;
  }
};

module.exports = {
  EDITABLE_SETTING_FIELDS,
  assertSettingsInvariants,
  updateSettings,
};
