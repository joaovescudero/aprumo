// Vitest module augmentation: declare keys provided via project.provide() in globalSetup.
// This makes inject('pgUri') properly typed without casting.
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    pgUri: string;
  }
}
