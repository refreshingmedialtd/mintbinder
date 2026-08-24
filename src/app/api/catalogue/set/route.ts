import { auth } from "@/auth";
import { getCatalogueSetData } from "@/lib/db/app-data";
import {
  databaseReadUnavailableResponse,
  privateReadJson,
} from "@/lib/http/private-read-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return privateReadJson({ error: "Authentication required." }, 401);
    }

    const params = new URL(request.url).searchParams;
    const setName = params.get("set") ?? "";
    const setId = params.get("setId");
    const data = await getCatalogueSetData(setName, setId);

    return privateReadJson(data);
  } catch (error) {
    console.error("Unable to read catalogue set data.", error);
    return databaseReadUnavailableResponse("Catalogue set data is temporarily unavailable.");
  }
}
