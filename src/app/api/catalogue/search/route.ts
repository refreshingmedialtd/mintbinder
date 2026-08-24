import { auth } from "@/auth";
import { lookupCatalogueData, searchCatalogueData } from "@/lib/db/app-data";
import { CatalogueLookupValidationError } from "@/lib/catalogue/lookup";
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
    const data = await searchCatalogueData(session.user.id, {
      language: params.get("language") ?? "all",
      limit: Number(params.get("limit") ?? 40),
      offset: Number(params.get("offset") ?? 0),
      q: params.get("q") ?? "",
      rarity: params.get("rarity") ?? "all",
      set: params.get("set") ?? "all",
      sort: params.get("sort") ?? "value-desc",
      type: params.get("type") ?? "all",
    });

    return privateReadJson(data);
  } catch (error) {
    console.error("Unable to search catalogue data.", error);
    return databaseReadUnavailableResponse("Catalogue search is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return privateReadJson({ error: "Authentication required." }, 401);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return privateReadJson({ error: "A JSON body is required." }, 400);
    }

    const ids = body && typeof body === "object" && "ids" in body
      ? (body as { ids?: unknown }).ids
      : undefined;
    const data = await lookupCatalogueData(session.user.id, ids);

    return privateReadJson(data);
  } catch (error) {
    if (error instanceof CatalogueLookupValidationError) {
      return privateReadJson({ error: error.message }, 400);
    }

    console.error("Unable to look up catalogue data.", error);
    return databaseReadUnavailableResponse("Catalogue lookup is temporarily unavailable.");
  }
}
