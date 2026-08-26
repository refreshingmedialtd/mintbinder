import { NextResponse } from "next/server";

/**
 * Prevent browsers and intermediate proxies from retaining an old app shell
 * across an immutable release activation. Hashed Next assets are excluded by
 * the matcher below and retain their normal long-lived cache policy.
 */
export function middleware() {
  const response = NextResponse.next();

  response.headers.set("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("expires", "0");
  response.headers.set("pragma", "no-cache");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|apple-icon.png|manifest.webmanifest|offline.html|robots.txt).*)",
  ],
};
