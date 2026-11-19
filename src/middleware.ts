import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { shouldBlockForShortlinkHost } from "@/lib/host-routing";

/**
 * popbeez.hivecomp.my.id is a short-link-only domain. The application itself
 * stays on portal-beez.vercel.app, so every other path on the short domain
 * returns 404 instead of exposing the dashboard or API.
 */
export function middleware(request: NextRequest) {
  if (shouldBlockForShortlinkHost(request.headers.get("host"), request.nextUrl.pathname)) {
    return new NextResponse("Subdomain ini hanya melayani tautan pendek.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
