export const SERVICE_VERSION = "1.0.0";

export type DeploymentMetadata = {
  commit: string;
  build_time: string;
  runtime: "source" | "dist";
};

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return "unknown";
}

export function getDeploymentMetadata(metaUrl: string = import.meta.url): DeploymentMetadata {
  return {
    commit: firstNonEmpty(
      process.env.PARSE_COMMIT_SHA,
      process.env.RAILWAY_GIT_COMMIT_SHA,
      process.env.VERCEL_GIT_COMMIT_SHA,
      process.env.HEROKU_SLUG_COMMIT,
      process.env.GIT_COMMIT,
      process.env.SOURCE_VERSION,
    ),
    build_time: firstNonEmpty(
      process.env.PARSE_BUILD_TIME,
      process.env.BUILD_TIME,
      process.env.RAILWAY_DEPLOYMENT_CREATED_AT,
    ),
    runtime: metaUrl.includes("/dist/") ? "dist" : "source",
  };
}

export function getPublicVersionPayload() {
  return {
    version: SERVICE_VERSION,
    deployment: getDeploymentMetadata(),
  };
}
