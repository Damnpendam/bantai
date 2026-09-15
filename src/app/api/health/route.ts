import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { encrypt } from "@/lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What a host checks before sending traffic to a new deploy: the database
 * answers, and stored API keys can be sealed (APP_SECRET is usable). No auth,
 * and nothing about any tenant in the response.
 */
export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    encrypt("health");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[health] failing:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
