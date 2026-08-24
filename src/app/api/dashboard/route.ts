import { auth } from "@/auth";
import { getDashboardData } from "@/lib/db/app-data";
import {
  databaseReadUnavailableResponse,
  privateReadJson,
} from "@/lib/http/private-read-response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return privateReadJson({ error: "Authentication required." }, 401);
    }

    const data = await getDashboardData(session.user.id);

    return privateReadJson(data);
  } catch (error) {
    console.error("Unable to read dashboard data.", error);
    return databaseReadUnavailableResponse("Dashboard data is temporarily unavailable.");
  }
}
