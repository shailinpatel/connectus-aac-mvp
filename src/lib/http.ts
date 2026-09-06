import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize the internal request URL to localhost; the Host header
  // retains the browser-facing authority (including the local port).
  let valid = false;
  try {
    const parsed = new URL(origin || "");
    valid =
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.host === request.headers.get("host");
  } catch {
    /* Invalid or missing origin. */
  }
  if (!valid)
    throw new HttpError(
      403,
      "This action must come from Connectus on this device.",
    );
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Send JSON data.");
  if (Number(request.headers.get("content-length")) > 16000)
    throw new HttpError(413, "That request is too large.");
  const raw = await request.text();
  if (raw.length > 16000)
    throw new HttpError(413, "That request is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Could not read this request.");
  }
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json(
      { error: error.issues[0]?.message || "Check your input." },
      { status: 400 },
    );
  console.error(error);
  return Response.json(
    { error: "Couldn't save your changes. Please try again." },
    { status: 500 },
  );
}
