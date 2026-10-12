/**
 * Upload CSRF boundary. publicOrigin is trusted deployment configuration.
 * Never derive it from request.url, Host, Forwarded or X-Forwarded-*.
 * The proxy must preserve the public Host header.
 */
export declare function assertOfficeRequestOrigin(request: Pick<Request, 'headers'>, publicOrigin: string | undefined): void;
