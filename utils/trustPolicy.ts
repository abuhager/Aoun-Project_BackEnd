export type TrustEvidence = {
  emailVerified: boolean;
  studentVerified: boolean;
  phoneVerified: boolean;
  adminApproved: boolean;
  registrationPolicyLevel2?: boolean;
};

export const newUserDefaultTrustLevel2Enabled = (
  env: NodeJS.ProcessEnv = process.env
): boolean => String(
  env.NEW_USER_DEFAULT_TRUST_LEVEL_2 ?? 'false'
).trim().toLowerCase() === 'true';

export const phoneVerificationPromotesTrust = (
  env: NodeJS.ProcessEnv = process.env
): boolean => String(
  env.PHONE_VERIFICATION_PROMOTES_TRUST ?? 'false'
).trim().toLowerCase() === 'true';

/**
 * Tier 2 requires student evidence, an explicit admin approval, or the
 * deployment's registration policy. Phone ownership is evidence, but is not
 * sufficient unless deployment opts in.
 */
export const deriveTrustLevel = (
  evidence: TrustEvidence,
  options: { phonePromotesTrust?: boolean } = {}
): 1 | 2 => (
  evidence.studentVerified
  || evidence.adminApproved
  || Boolean(evidence.registrationPolicyLevel2)
  || (Boolean(options.phonePromotesTrust) && evidence.phoneVerified)
    ? 2
    : 1
);

export default {
  deriveTrustLevel,
  newUserDefaultTrustLevel2Enabled,
  phoneVerificationPromotesTrust,
};
