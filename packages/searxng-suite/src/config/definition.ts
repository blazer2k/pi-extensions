import { Type, type Static } from "typebox";
import { Create, Repair } from "typebox/value";

// Literal unions prevent Repair from coercing strings or numbers to booleans.
const flag = (defaultValue: boolean) =>
  Type.Union([Type.Literal(true), Type.Literal(false)], {
    default: defaultValue,
  });

const ConfigSchema = Type.Object(
  {
    // Union wrappers prevent numeric coercion and fractional result counts.
    maxResults: Type.Union([Type.Integer({ minimum: 1 })], { default: 10 }),
    agentCanLimitResults: flag(false),
    timeoutMs: Type.Union([Type.Number({ minimum: 1000, maximum: 120000 })], {
      default: 15000,
    }),
    safesearch: Type.Union(
      [Type.Literal(0), Type.Literal(1), Type.Literal(2)],
      { default: 0 },
    ),
    agentCanPickCategory: flag(false),
    allowPrivateUrls: flag(false),
    verbose: flag(false),
  },
  { additionalProperties: false },
);

export type Config = Static<typeof ConfigSchema>;

export function getDefaultConfig(): Config {
  return Create(ConfigSchema);
}

export function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return getDefaultConfig();
  }
  return Repair(ConfigSchema, structuredClone(raw));
}
