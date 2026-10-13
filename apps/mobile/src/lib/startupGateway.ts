import { normalizeServerUrl } from './connection';

/** A bundled gateway is authoritative after an APK update; sessions remain origin-bound. */
export function resolveStartupGateway(input: {
  builtInUrl?: string;
  savedUrl?: string;
  credentialUrl?: string;
  token?: string;
}) {
  const builtIn = normalizeServerUrl(input.builtInUrl ?? '');
  const previous = normalizeServerUrl(input.credentialUrl || input.savedUrl || '');
  const serverUrl = builtIn || previous;
  // Legacy tokens lack an origin-bound envelope: require sign-in rather than trusting mutable settings.
  const discardCredential = Boolean(input.token && builtIn && (!input.credentialUrl || previous !== builtIn));
  return {
    serverUrl,
    accessToken: discardCredential ? '' : input.token ?? '',
    changedGateway: Boolean(builtIn && previous && previous !== builtIn),
    discardCredential,
  };
}
