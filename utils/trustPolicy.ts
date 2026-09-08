export type TrustEvidence = {
  emailVerified: boolean;
  studentVerified: boolean;
  phoneVerified: boolean;
  adminApproved: boolean;
};

export const phoneVerificationPromotesTrust = (
  env: NodeJS.ProcessEnv = process.env
): boolean => String(
  env.PHONE_VERIFICATION_PROMOTES_TRUST ?? 'false'
).trim().toLowerCase() === 'true';

/**
 * Tier 2 requires student evidence or an explicit admin approval. Phone
 * ownership is evidence, but is not sufficient unless deployment opts in.
 */
export const deriveTrustLevel = (
  evidence: TrustEvidence,
  options: { phonePromotesTrust?: boolean } = {}
): 1 | 2 => (
  evidence.studentVerified
  || evidence.adminApproved
  || (Boolean(options.phonePromotesTrust) && evidence.phoneVerified)
    ? 2
    : 1
);

export default { deriveTrustLevel, phoneVerificationPromotesTrust };
