import { NextRequest } from "next/server";
import { boundedBody, bodyLimit } from "@/lib/proxy-body";

const permitted = new Set([
  "health",
  "readiness",
  "profiles",
  "providers",
  "auth",
]);

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    !permitted.has(path[0]) ||
    path.some((p) => !/^[a-zA-Z0-9_-]+$/.test(p))
  ) {
    return Response.json({ detail: "Invalid API route" }, { status: 400 });
  }
  const base =
    process.env.PICTOFLOW_API_BASE_URL || "http://127.0.0.1:8000/api/v1";
  try {
    const url = new URL(`${base.replace(/\/$/, "")}/${path.join("/")}`);
    url.search = request.nextUrl.search;
    const response = await fetch(url, {
      method: request.method,
      cache: "no-store",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(request.headers.get("cookie")
          ? { Cookie: request.headers.get("cookie")! }
          : {}),
        ...(request.headers.get("origin")
          ? { Origin: request.headers.get("origin")! }
          : {}),
        ...(request.headers.get("x-csrf-token")
          ? { "X-CSRF-Token": request.headers.get("x-csrf-token")! }
          : {}),
      },
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await boundedBody(request, bodyLimit(request.method, path)),
      signal: AbortSignal.timeout(120_000),
    });
    const headers = new Headers({
      "Content-Type":
        response.headers.get("content-type") === "image/jpeg"
          ? "image/jpeg"
          : "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const trace = response.headers.get("x-trace-id");
    for (const cookie of response.headers.getSetCookie())
      headers.append("Set-Cookie", cookie);
    const retry = response.headers.get("retry-after");
    if (retry) headers.set("Retry-After", retry);
    if (trace) headers.set("x-trace-id", trace);
    if (
      path.length === 3 &&
      path[0] === "profiles" &&
      path[2] === "backup" &&
      /^[0-9a-f-]{36}$/i.test(path[1])
    )
      headers.set(
        "Content-Disposition",
        `attachment; filename="pictoflow-profile-${path[1]}.json"`,
      );
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (error instanceof RangeError)
      return Response.json(
        { detail: "Request too large" },
        {
          status: 413,
          // A partially consumed HTTP/1 body must not poison the next request on this socket.
          headers: { Connection: "close" },
        },
      );
    return Response.json({ detail: "Backend unavailable" }, { status: 503 });
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as PUT,
  proxy as DELETE,
};
