import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/signin", "/signup", "/api"];

export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) return NextResponse.next();
  if (!request.cookies.get("ponto_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};