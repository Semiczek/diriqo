/** Read the actual stream, not a caller-controlled Content-Length, before parsing multipart. */
export declare function readBoundedOfficeMultipart(request: Request, maxBytes?: number): Promise<FormData>;
