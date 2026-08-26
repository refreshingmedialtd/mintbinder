type HealthEnvironment = NodeJS.ProcessEnv;

export type ServiceHealthCheck = {
  checkedAt: string;
  database: "ok" | "failed";
  durationMs: number;
  ok: boolean;
};

export function publicHealthPayload(check: ServiceHealthCheck) {
  return {
    checkedAt: check.checkedAt,
    ok: check.ok,
    service: "mintbinder",
    status: check.ok ? "ok" : "degraded",
  };
}

export function detailedHealthPayload(
  check: ServiceHealthCheck,
  environment: HealthEnvironment = process.env,
) {
  return {
    ...publicHealthPayload(check),
    checks: {
      auth: environmentChecks(environment),
      database: check.database,
    },
    build: buildInfo(environment),
    durationMs: check.durationMs,
    ...(!check.ok ? { error: "Database health check failed." } : {}),
  };
}

export function environmentChecks(environment: HealthEnvironment = process.env) {
  return {
    authSecretConfigured: Boolean(environment.AUTH_SECRET),
    authTrustHost: environment.AUTH_TRUST_HOST === "true",
    authUrlConfigured: Boolean(environment.AUTH_URL || environment.NEXTAUTH_URL),
    nextPublicAppUrlConfigured: Boolean(environment.NEXT_PUBLIC_APP_URL),
  };
}

export function buildInfo(environment: HealthEnvironment = process.env) {
  return {
    branch: environment.MINTBINDER_RUNTIME_BRANCH || "unknown",
    commit: environment.MINTBINDER_RUNTIME_COMMIT || "unknown",
    deployScriptVersion: environment.MINTBINDER_RUNTIME_DEPLOY_SCRIPT_VERSION || "unknown",
    // app.js derives this from the directory actually passed to Next, after
    // matching root and release-local build metadata.
    distDir: environment.MINTBINDER_RUNTIME_DIST_DIR || "unknown",
    generatedAt: environment.MINTBINDER_RUNTIME_GENERATED_AT || undefined,
    nodeVersion: environment.MINTBINDER_RUNTIME_NODE_VERSION || undefined,
  };
}
