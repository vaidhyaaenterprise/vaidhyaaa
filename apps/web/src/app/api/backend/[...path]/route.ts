import { createRequestId, REQUEST_ID_HEADER, toApiErrorBody } from '@vaidya/shared';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LOCAL_API_BASE_URL = 'http://127.0.0.1:3000';
// Finish before the browser client's 20-second timeout so it receives a
// structured response instead of reporting a generic network failure.
const UPSTREAM_TIMEOUT_MS = 18_000;
const REQUEST_HEADERS_TO_REMOVE = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
] as const;
const RESPONSE_HEADERS_TO_REMOVE = [
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
] as const;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function errorResponse(message: string, requestId: string, status = 503): Response {
  return Response.json(toApiErrorBody('INTERNAL_ERROR', message, requestId), {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'cache-control': 'no-store, private',
      'retry-after': '1',
    },
  });
}

function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsedHostname = new URL(value).hostname.toLowerCase();
    const hostname = parsedHostname.endsWith('.') ? parsedHostname.slice(0, -1) : parsedHostname;
    return (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.startsWith('127.') ||
      hostname === '0.0.0.0' ||
      hostname === '[::]' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function isSupportedHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

function getUpstreamBaseUrl(): string | null {
  const configured = process.env.API_BASE_URL?.trim();

  if (configured) {
    if (!isSupportedHttpUrl(configured) || (isVercelRuntime() && isLoopbackUrl(configured))) {
      return null;
    }
    return configured.replace(/\/+$/, '');
  }

  // A Vercel function's loopback interface is not the API running on a
  // developer's computer (or on another server). Failing before fetch keeps a
  // missing deployment setting from turning into a slow connection timeout.
  if (isVercelRuntime()) {
    return null;
  }

  // The repository runs the web and API processes on the same host by default.
  // This remains valid for `next start`, where NODE_ENV is always production.
  return LOCAL_API_BASE_URL;
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<Response> {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createRequestId();
  const upstreamBaseUrl = getUpstreamBaseUrl();

  if (!upstreamBaseUrl) {
    console.error('API proxy has no usable server-only API_BASE_URL setting.');
    return errorResponse(
      'The service is temporarily unavailable. Please contact support.',
      requestId,
    );
  }

  const { path } = await context.params;
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join('/');
  let upstreamUrl: URL;

  try {
    upstreamUrl = new URL(`${upstreamBaseUrl}/${encodedPath}${request.nextUrl.search}`);
  } catch {
    console.error('API proxy received an invalid API_BASE_URL.');
    return errorResponse(
      'The service is temporarily unavailable. Please contact support.',
      requestId,
    );
  }

  if (upstreamUrl.origin === request.nextUrl.origin) {
    console.error('API proxy rejected an upstream URL that points back to the web application.');
    return errorResponse(
      'The service is temporarily unavailable. Please contact support.',
      requestId,
    );
  }

  const headers = new Headers(request.headers);
  for (const header of REQUEST_HEADERS_TO_REMOVE) {
    headers.delete(header);
  }
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set('x-forwarded-host', request.nextUrl.host);
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));

  const canHaveBody = request.method !== 'GET' && request.method !== 'HEAD';

  try {
    const upstreamRequest: RequestInit = {
      method: request.method,
      headers,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    };
    if (canHaveBody) {
      upstreamRequest.body = await request.arrayBuffer();
    }

    const upstreamResponse = await fetch(upstreamUrl, upstreamRequest);
    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const header of RESPONSE_HEADERS_TO_REMOVE) {
      responseHeaders.delete(header);
    }
    responseHeaders.set(REQUEST_ID_HEADER, requestId);
    responseHeaders.set('cache-control', 'no-store, private');
    if (
      (upstreamResponse.status === 408 ||
        upstreamResponse.status === 425 ||
        upstreamResponse.status === 429 ||
        upstreamResponse.status >= 500) &&
      !responseHeaders.has('retry-after')
    ) {
      responseHeaders.set('retry-after', '1');
    }

    return new Response(await upstreamResponse.arrayBuffer(), {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('API proxy could not reach the upstream service.', error);
    return errorResponse(
      'The service is temporarily unavailable. Please try again shortly.',
      requestId,
    );
  }
}

export const GET = proxyRequest;
export const HEAD = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
