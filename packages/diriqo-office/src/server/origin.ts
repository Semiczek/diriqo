/**
 * Upload CSRF boundary. publicOrigin is trusted deployment configuration.
 * Never derive it from request.url, Host, Forwarded or X-Forwarded-*.
 * The proxy must preserve the public Host header.
 */
export function assertOfficeRequestOrigin(
  request: Pick<Request, 'headers'>,
  publicOrigin: string | undefined,
): void {
  let configured: URL;
  try {
    if (!publicOrigin?.trim()) throw new Error();
    configured = new URL(publicOrigin.trim());
    if (
      configured.username || configured.password ||
      configured.pathname !== '/' || configured.search || configured.hash ||
      !['http:', 'https:'].includes(configured.protocol) ||
      (configured.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))
    ) throw new Error();
  } catch {
    throw new Error('OFFICE_ORIGIN_CONFIGURATION');
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const fetchSite = request.headers.get('sec-fetch-site');

  // Origin is serialized canonically by browsers. Reject null, multiple origins,
  // paths, credentials, aliases, nondefault ports and subdomains not configured.
  // Host is compared independently, so an attacker cannot choose both via a
  // forged Host/Origin pair. Real authorization remains required after this check.
  if (
    origin !== configured.origin ||
    host?.toLowerCase() !== configured.host.toLowerCase() ||
    (fetchSite !== null && fetchSite !== 'same-origin')
  ) {
    throw new Error('OFFICE_FORBIDDEN');
  }
}
