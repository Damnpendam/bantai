/**
 * Shared by the proxy (which only checks the cookie is present) and the route
 * guards (which validate it). Kept dependency-free so the proxy never pulls in
 * the database.
 *
 * Secure by default in production; COOKIE_SECURE=false allows a production
 * build to be tried over plain http. When secure, the __Host- prefix makes the
 * browser refuse the cookie unless it is Secure, host-only and path=/.
 */
export const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : process.env.NODE_ENV === "production";

export const SESSION_COOKIE = COOKIE_SECURE ? "__Host-bantai_session" : "bantai_session";
