import { describe, expect, it } from "vitest";
import { computeSchemaName } from "./createTestDb.js";

describe("computeSchemaName", () => {
  it("returns a name matching /^test_[a-f0-9]{12}$/", () => {
    const name = computeSchemaName("packages/core/tests/helpers/someTest.test.ts");
    expect(name).toMatch(/^test_[a-f0-9]{12}$/);
  });

  it("produces different schema names for different paths", () => {
    const nameA = computeSchemaName("fileA.test.ts");
    const nameB = computeSchemaName("fileB.test.ts");
    expect(nameA).not.toBe(nameB);
  });

  it("is deterministic for the same path", () => {
    const path = "packages/core/tests/schema/revoke.integration.test.ts";
    const first = computeSchemaName(path);
    const second = computeSchemaName(path);
    expect(first).toBe(second);
  });
});
