import { NextRequest } from "next/server";

const permitted = new Set(["health", "readiness", "profiles", "providers"]);

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
      headers: { "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.text(),
      signal: AbortSignal.timeout(120_000),
    });
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    const trace = response.headers.get("x-trace-id");
    if (trace) headers.set("x-trace-id", trace);
    return new Response(
      response.status === 204 ? null : await response.text(),
      { status: response.status, headers },
    );
  } catch {
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
