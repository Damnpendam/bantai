import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AuthError,
  primaryWorkspace,
  projectForUser,
  validateSession,
  type User,
  type Workspace,
} from "@/lib/auth";
import {
  getDocument,
  getRun,
  type DocumentRow,
  type ProjectRow,
  type RunRecord,
} from "@/lib/store";
import { COOKIE_SECURE, SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * The authorisation layer every route handler goes through. Proxy only makes
 * an optimistic "is there a cookie" check for page redirects; the real checks
 * are here, next to the data, on every request.
 */

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface Ctx {
  user: User;
  workspace: Workspace;
}

export async function currentContext(): Promise<Ctx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = validateSession(token);
  if (!user) return null;
  const workspace = primaryWorkspace(user.id);
  if (!workspace) return null;
  return { user, workspace };
}

export async function requireUser(): Promise<Ctx> {
  const ctx = await currentContext();
  if (!ctx) throw new HttpError(401, "Sign in to continue.");
  return ctx;
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireUser();
  if (ctx.user.role !== "superadmin") {
    throw new HttpError(403, "Only a super admin can do that.");
  }
  return ctx;
}

// Someone else's project and a project that doesn't exist get the same answer,
// so an id can't be probed for existence.
const NOT_FOUND = "Not found.";

export function requireProject(ctx: Ctx, projectId: string): ProjectRow {
  const project = projectForUser(ctx.user.id, projectId);
  if (!project) throw new HttpError(404, NOT_FOUND);
  return project;
}

export function requireRun(ctx: Ctx, runId: string): { run: RunRecord; project: ProjectRow } {
  const run = getRun(runId);
  if (!run) throw new HttpError(404, NOT_FOUND);
  const project = projectForUser(ctx.user.id, run.projectId);
  if (!project) throw new HttpError(404, NOT_FOUND);
  return { run, project };
}

export function requireDocument(
  ctx: Ctx,
  documentId: string,
): { document: DocumentRow; project: ProjectRow } {
  const document = getDocument(documentId);
  if (!document) throw new HttpError(404, NOT_FOUND);
  const project = projectForUser(ctx.user.id, document.project_id);
  if (!project) throw new HttpError(404, NOT_FOUND);
  return { document, project };
}

/**
 * CSRF defence for cookie-authenticated mutations, on top of SameSite=Lax. A
 * browser marks cross-site requests with Sec-Fetch-Site and always sends Origin
 * on a cross-origin POST; either one mismatching refuses the request. A request
 * with neither header comes from something that isn't a browser, which can't
 * be carrying a victim's cookie.
 */
export function assertSameOrigin(request: Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "Cross-site request refused.");
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(host.toLowerCase());
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    allowed.add(process.env.RAILWAY_PUBLIC_DOMAIN.toLowerCase());
  }
  if (process.env.APP_URL) {
    try {
      allowed.add(new URL(process.env.APP_URL).host.toLowerCase());
    } catch {
      // A malformed APP_URL just doesn't widen the allow-list.
    }
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new HttpError(403, "Cross-site request refused.");
  }
  if (!allowed.has(originHost)) throw new HttpError(403, "Cross-site request refused.");
}

/**
 * Wraps a route handler: origin check on every mutation, and every thrown
 * HttpError/AuthError turned into a JSON response. Unexpected errors are logged
 * and answered generically, so internals never leak to the client.
 */
export function api<A extends [Request, ...unknown[]]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      assertSameOrigin(args[0]);
      return await handler(...args);
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      if (error instanceof AuthError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.code === "not_found" ? 404 : 400 },
        );
      }
      console.error(error);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Base URL for links in emails. APP_URL wins; on Railway the service's public
 * domain is the next best thing (it's the only choice at boot, when there is no
 * request to read a host from); otherwise the request's own origin.
 */
export function appOrigin(request?: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  if (request) {
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host) return `${proto}://${host}`;
    return new URL(request.url).origin;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/** Parse a JSON body, answering malformed input with a 400 rather than a 500. */
export async function jsonBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "The request body must be JSON.");
  }
}
