import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchCatalogueData } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const data = await searchCatalogueData(session.user.id, {
    limit: Number(params.get("limit") ?? 40),
    q: params.get("q") ?? "",
    rarity: params.get("rarity") ?? "all",
    set: params.get("set") ?? "all",
    sort: params.get("sort") ?? "value-desc",
    type: params.get("type") ?? "card",
  });

  return NextResponse.json(data);
}
