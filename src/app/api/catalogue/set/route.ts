import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCatalogueSetData } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const setName = new URL(request.url).searchParams.get("set") ?? "";
  const data = await getCatalogueSetData(setName);

  return NextResponse.json(data);
}
