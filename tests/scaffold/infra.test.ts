/**
 * INF-01..05: Monorepo scaffold infrastructure assertions
 *
 * Wave 0 RED tests — these MUST fail until Wave 1 creates the actual files.
 * Tests check file existence and content of config files that don't exist yet.
 *
 * No imports from @aprumo/* packages (Wave 0 runs before packages exist).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

describe("INF-01..05: Monorepo scaffold", () => {
  describe("INF-01: pnpm workspace", () => {
    it("pnpm-workspace.yaml exists at repo root", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "pnpm-workspace.yaml")),
        "pnpm-workspace.yaml must exist at repo root",
      ).toBe(true);
    });

    it('root package.json has field "packageManager" starting with "pnpm@10"', () => {
      const pkgPath = path.join(REPO_ROOT, "package.json");
      expect(fs.existsSync(pkgPath), "package.json must exist").toBe(true);
      const pkg = readJson(pkgPath) as Record<string, unknown>;
      expect(typeof pkg.packageManager).toBe("string");
      expect((pkg.packageManager as string).startsWith("pnpm@10")).toBe(true);
    });

    it('root package.json has engines.node = ">=22"', () => {
      const pkgPath = path.join(REPO_ROOT, "package.json");
      const pkg = readJson(pkgPath) as Record<string, unknown>;
      const engines = pkg.engines as Record<string, unknown> | undefined;
      expect(engines).toBeDefined();
      expect(engines?.node).toBe(">=22");
    });
  });

  describe("INF-02: TypeScript strict config", () => {
    it("tsconfig.base.json exists at repo root", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "tsconfig.base.json")),
        "tsconfig.base.json must exist",
      ).toBe(true);
    });

    it('tsconfig.base.json contains "strict": true', () => {
      const configPath = path.join(REPO_ROOT, "tsconfig.base.json");
      const config = readJson(configPath) as Record<string, unknown>;
      const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;
      expect(compilerOptions?.strict).toBe(true);
    });

    it('tsconfig.base.json contains "noUncheckedIndexedAccess": true', () => {
      const configPath = path.join(REPO_ROOT, "tsconfig.base.json");
      const config = readJson(configPath) as Record<string, unknown>;
      const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;
      expect(compilerOptions?.noUncheckedIndexedAccess).toBe(true);
    });

    it('tsconfig.base.json contains "module": "NodeNext"', () => {
      const configPath = path.join(REPO_ROOT, "tsconfig.base.json");
      const config = readJson(configPath) as Record<string, unknown>;
      const compilerOptions = config.compilerOptions as Record<string, unknown> | undefined;
      expect(compilerOptions?.module).toBe("NodeNext");
    });
  });

  describe("INF-03: Biome lint config", () => {
    it("biome.json exists at repo root", () => {
      expect(fs.existsSync(path.join(REPO_ROOT, "biome.json")), "biome.json must exist").toBe(true);
    });

    it('biome.json contains "noExplicitAny": "error" (nested in linter.rules)', () => {
      const configPath = path.join(REPO_ROOT, "biome.json");
      const config = readJson(configPath) as Record<string, unknown>;
      const linter = config.linter as Record<string, unknown> | undefined;
      const rules = linter?.rules as Record<string, unknown> | undefined;
      const suspicious = rules?.suspicious as Record<string, unknown> | undefined;
      expect(suspicious?.noExplicitAny).toBe("error");
    });
  });

  describe("INF-01: Node version pinning", () => {
    it(".nvmrc exists at repo root", () => {
      expect(fs.existsSync(path.join(REPO_ROOT, ".nvmrc")), ".nvmrc must exist at repo root").toBe(
        true,
      );
    });

    it('.npmrc exists and contains "engine-strict=true"', () => {
      const npmrcPath = path.join(REPO_ROOT, ".npmrc");
      expect(fs.existsSync(npmrcPath), ".npmrc must exist").toBe(true);
      const content = fs.readFileSync(npmrcPath, "utf8");
      expect(content).toContain("engine-strict=true");
    });
  });

  describe("INF-01: Package stubs", () => {
    it("packages/core/src/index.ts exists", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "packages/core/src/index.ts")),
        "packages/core/src/index.ts must exist",
      ).toBe(true);
    });

    it("packages/connector-base/src/index.ts exists", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "packages/connector-base/src/index.ts")),
        "packages/connector-base/src/index.ts must exist",
      ).toBe(true);
    });

    it("packages/connector-starkbank/src/index.ts exists", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "packages/connector-starkbank/src/index.ts")),
        "packages/connector-starkbank/src/index.ts must exist",
      ).toBe(true);
    });

    it("packages/webhooks/src/index.ts exists", () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, "packages/webhooks/src/index.ts")),
        "packages/webhooks/src/index.ts must exist",
      ).toBe(true);
    });
  });
});
