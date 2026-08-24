export type AppDataFallbackMode = "sample" | "throw";

type AppDataFallbackEnvironment = {
  NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK?: string;
  NODE_ENV?: string;
};

export function developmentSampleFallbackEnabled(
  environment: AppDataFallbackEnvironment = process.env,
) {
  return environment.NODE_ENV === "development" &&
    environment.NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK?.trim().toLowerCase() === "true";
}

export function resolveAppDataFallbackMode(
  requested: AppDataFallbackMode = "sample",
  environment: AppDataFallbackEnvironment = process.env,
): AppDataFallbackMode {
  if (requested === "throw") return "throw";
  return developmentSampleFallbackEnabled(environment) ? "sample" : "throw";
}

export function assertAppDataDatabaseConfigured(
  databaseUrl: string | undefined,
  fallback: AppDataFallbackMode,
) {
  if (!databaseUrl && fallback === "throw") {
    throw new Error("DATABASE_URL is not configured.");
  }
}

export function shouldThrowAppDataReadError(fallback: AppDataFallbackMode) {
  return fallback === "throw";
}
