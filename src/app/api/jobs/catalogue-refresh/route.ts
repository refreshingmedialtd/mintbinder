import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { syncPokemonTcgCards } from "@/lib/pricing/pokemon-tcg-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const body = (await request.json().catch(() => ({}))) as {
      page?: number;
      pageSize?: number;
      q?: string;
    };
    const result = await syncPokemonTcgCards({
      page: body.page,
      pageSize: body.pageSize,
      q: body.q,
      writePrices: false,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh catalogue.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}
