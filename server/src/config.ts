import { z } from "zod";

const booleanFromEnv = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0", "yes", "no", ""])
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return fallback;
      return value === "true" || value === "1" || value === "yes";
    });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  DEMO_MODE: booleanFromEnv(false),
  TRUST_PROXY: booleanFromEnv(true),
  /** Prefix for every Redis key and the Socket.IO adapter channel. */
  REDIS_PREFIX: z.string().min(1).default("huddle"),
});

/** Validated runtime configuration. */
export type Config = z.infer<typeof envSchema>;

/**
 * Parses and validates environment variables.
 *
 * @param env - The environment to read, `process.env` by default.
 * @returns The validated configuration.
 * @throws Exits the process with a readable message when the environment is invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const defaults: NodeJS.ProcessEnv =
    env.NODE_ENV === "production"
      ? {}
      : {
          PORT: "5113",
          DATABASE_URL: "postgresql://postgres:fleetdev@127.0.0.1:55432/huddle",
          REDIS_URL: "redis://127.0.0.1:56379/4",
          SESSION_SECRET: "dev-only-session-secret-change-me",
        };
  const result = envSchema.safeParse({ ...defaults, ...env });
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(`Invalid environment configuration:\n${problems}`);
    process.exit(1);
  }
  return result.data;
}
