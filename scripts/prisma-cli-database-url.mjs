// Keep runtime pooling. Prisma CLI migrations need session-affine connections.
export function prismaCliDatabaseUrl(env = process.env) {
  const configured = env.DIRECT_URL?.trim();
  const runtime = env.DATABASE_URL?.trim();
  if (configured) {
    const direct = new URL(configured);
    if (isNeonPooler(direct)) throw new Error("DIRECT_URL must be an unpooled Neon connection.");
    if (runtime) {
      const application = new URL(runtime);
      if (direct.hostname !== unpooledHostname(application) || direct.pathname !== application.pathname ||
        (direct.port || "5432") !== (application.port || "5432") ||
        (direct.searchParams.get("schema") || "public") !== (application.searchParams.get("schema") || "public")) {
        throw new Error("DIRECT_URL must address the same database and schema as DATABASE_URL.");
      }
    }
    return direct.toString();
  }
  if (!runtime) return undefined;
  const url = new URL(runtime);
  if (!isNeonPooler(url)) return runtime;
  // Neon documents the same endpoint hostname without '-pooler' for direct
  // connections. Never guess a different host for another provider.
  url.hostname = unpooledHostname(url);
  url.searchParams.delete("pgbouncer");
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

function isNeonPooler(url) {
  return /^ep-[a-z0-9-]+-pooler\.(?:[a-z0-9-]+\.)+(?:neon\.tech|neon\.build)$/i.test(url.hostname);
}

function unpooledHostname(url) {
  return isNeonPooler(url) ? url.hostname.replace(/-pooler\./i, ".") : url.hostname;
}
