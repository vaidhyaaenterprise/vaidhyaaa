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
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

function getUpstreamBaseUrl(): string | null {
  const configured =
    process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return process.env.NODE_ENV === 'production' ? null : LOCAL_API_BASE_URL;
}

async function proxyRequest(request: NextRequest, context: RouteContext): Promise<Response> {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || createRequestId();
  const upstreamBaseUrl = getUpstreamBaseUrl();

  if (!upstreamBaseUrl) {
    console.error('API proxy is unavailable because API_BASE_URL is not configured.');
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
