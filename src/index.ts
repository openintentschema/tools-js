// ois-tools: the validator of the Open Intent Schema as a library.

export { isSigstoreBundle, loadTrustedRoots } from './keyless.ts';
export { ProfileError, REGULATED, resolveProfile } from './profiles.ts';
export type { Level, Report, Result } from './report.ts';
export {
  isEnvelope,
  keyId,
  loadPublicKey,
  loadTrustedKeys,
  SigningError,
  type TrustedKey,
} from './signing.ts';
export { type Options, validate } from './validator.ts';
