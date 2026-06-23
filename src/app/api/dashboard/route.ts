import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDashboardData } from "@/lib/db/app-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const data = await getDashboardData(session.user.id);

  return NextResponse.json(data);
}
