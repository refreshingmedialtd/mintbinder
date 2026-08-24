import { auth } from "@/auth";
import { getAppData } from "@/lib/db/app-data";
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

    const data = await getAppData(session.user.id, { catalogueScope: "referenced" });

    return privateReadJson(data);
  } catch (error) {
    console.error("Unable to read app data.", error);
    return databaseReadUnavailableResponse("Mint Binder data is temporarily unavailable.");
  }
}
