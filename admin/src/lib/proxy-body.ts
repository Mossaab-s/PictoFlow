// Bound request allocation even when Content-Length is absent or untrustworthy.
export function bodyLimit(method: string, path: string[]) {
  if (method === "POST" && path.length === 2 && path[0] === "profiles") {
    if (path[1] === "restore-preview") return 32 * 1024 * 1024;
    if (path[1] === "restore") return 32 * 1024 * 1024 + 1024;
  }
  return 8 * 1024 * 1024;
}

export async function boundedBody(request: Request, limit = 8 * 1024 * 1024) {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
