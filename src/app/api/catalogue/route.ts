import { auth } from "@/auth";
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

    return privateReadJson(
      {
        error: "The unbounded catalogue endpoint has been retired. Use catalogue search or set reads.",
      },
      410,
    );
  } catch (error) {
    console.error("Unable to authorize the retired catalogue endpoint.", error);
    return databaseReadUnavailableResponse("Catalogue data is temporarily unavailable.");
  }
}
