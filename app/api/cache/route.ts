import { NextRequest, NextResponse } from "next/server";
import {
  CACHE_LIMITS,
  clearCachedResponses,
  deleteCachedResponse,
  listCachedResponses,
} from "../../utils/responseCache";

export const runtime = "nodejs";

// Exposes cached prompts and responses, so it only exists in development.
const isDev = process.env.NODE_ENV === "development";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET() {
  if (!isDev) return notFound();
  return NextResponse.json({
    entries: listCachedResponses(),
    limits: CACHE_LIMITS,
  });
}

// DELETE /api/cache clears everything; DELETE /api/cache?key=<hash> removes
// a single entry.
export async function DELETE(request: NextRequest) {
  if (!isDev) return notFound();
  const key = request.nextUrl.searchParams.get("key");
  if (key) {
    return NextResponse.json({ deleted: deleteCachedResponse(key) ? 1 : 0 });
  }
  return NextResponse.json({ deleted: clearCachedResponses() });
}
