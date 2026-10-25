import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth check only: no cookie → send to /login.
 * Role checks and session validation happen server-side in requireUser().
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("cf_session")) return NextResponse.next();
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/me/:path*", "/report", "/notifications", "/staff/:path*", "/admin/:path*"],
};
