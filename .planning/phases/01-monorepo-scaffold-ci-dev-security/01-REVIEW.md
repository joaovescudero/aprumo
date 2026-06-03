---
phase: 01-monorepo-scaffold-ci-dev-security
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - tests/scaffold/infra.test.ts
findings:
  critical: 2
  warning: 2
  info: 2
  total: 6
status: resolved
resolution:
  resolved: [CR-01, CR-02, IN-02]
  resolved_commits: ["1be2651 (RED tests)", "a04a390 (single-pass fix)"]
  resolved_at: 2026-06-02T00:00:00Z
  note: "WR-01/WR-02/IN-01 left as-is (cosmetic/diagnostic, no behavioral impact)."
---

# Phase 01: Code Review Report (Gap-Closure — readJsonc)

**Reviewed:** 2026-06-02  
**Depth:** standard  
**Files Reviewed:** 1  
**Status:** resolved (CR-01, CR-02, IN-02 fixed in 1be2651 + a04a390)

> **Resolution (2026-06-02):** Both BLOCKERs and the TDD gap closed via TDD.
> RED commit `1be2651` added 6 `readJsonc` unit cases (string `/* */` preservation,
> dangling trailing commas after inline `//` and `/* */`); GREEN commit `a04a390`
> replaced the two-pass pipeline with a single-pass regex (string-literal alternative
> first) plus a trailing-comma cleanup. Full suite: 176 passed / 1 skipped, typecheck 0.
> WR-01, WR-02, IN-01 are non-behavioral and left unchanged.

## Summary

This gap-closure review focuses on the `readJsonc` helper added at lines 20–33 of `tests/scaffold/infra.test.ts` and its three call sites (lines 71, 77, 84). The helper strips JSONC comments before calling `JSON.parse`, replacing the previous `readJson` call that broke on `tsconfig.base.json`'s `//` comments.

The current implementation **passes** for the specific `tsconfig.base.json` on disk (comments are on standalone lines, no `/* */` spans string boundaries, no string values contain `/*`). However, two silent data-corruption defects and one parse-failure defect exist in the regex pipeline that will fire as soon as the real-world input changes even slightly. The tests also carry labeling bugs that produce misleading failure messages.

---

## Critical Issues

### CR-01: Block-comment regex runs before string-aware pass — silently corrupts string values containing `/* */`

**File:** `tests/scaffold/infra.test.ts:23`  
**Issue:** The first `replace` on line 23 applies `/\/\*[\s\S]*?\*\//g` over the raw file content unconditionally, without any awareness of JSON string boundaries. Any string value that literally contains `/*` followed later by `*/` — even inside different property values — will be silently stripped. Two scenarios are proven exploitable:

Scenario A — string value contains `/* */`:
```
Input:  { "a": "/* not a comment */" }
After:  { "a": "" }          // "a" is silently emptied
```
The entire content between `/*` and `*/` inside the quoted string is erased, and `JSON.parse` produces the wrong value without any error.

Scenario B — `/*` in one string value, `*/` in a later one:
```
Input:  { "a": "start /* middle", "b": "end */", "c": 1 }
After:  { "a": "start ", "c": 1 }   // key "b" is silently dropped
```
The regex matches across the string boundary, deleting `"b"` entirely from the parse result. `JSON.parse` succeeds with corrupt data and no indication anything was lost.

Both scenarios were verified with Node.js and produce wrong results with zero exceptions thrown.

**Why it matters:** TypeScript `tsconfig` files commonly include glob patterns in `"paths"` or `"include"` entries — e.g., `"src/*"` — which contain `/*`. Any future `tsconfig.base.json` with such a path mapping would silently produce wrong parse results, causing test assertions to pass or fail on stale data.

**Fix:** Perform comment stripping in a single, string-aware pass. Place the string literal alternative first so it wins over block and line comment patterns:

```typescript
function readJsonc(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  // Single-pass: string literals matched first so /* */ and // inside strings are never touched.
  const stripped = raw.replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match: string, stringLiteral: string | undefined): string =>
      stringLiteral !== undefined ? stringLiteral : "",
  );
  return JSON.parse(stripped);
}
```

---

### CR-02: Trailing comma left after `//` comment on the same line as a comma-terminated value causes `JSON.parse` to throw

**File:** `tests/scaffold/infra.test.ts:27–31`  
**Issue:** When a `//` comment appears on the same line as a property whose value is followed by a comma, stripping the comment leaves a dangling comma that makes the result invalid JSON:

```
Input:  { "a": 1, // comment\n}
After:  { "a": 1, \n}         // trailing comma — SyntaxError
```

`JSON.parse` throws `SyntaxError: Expected double-quoted property name` because trailing commas are not valid JSON (even though they are valid JSONC).

Verified with Node.js: `JSON.parse('{ "a": 1, \n}')` throws with that exact message.

**Why it is dormant today:** The current `tsconfig.base.json` places all its `//` comments on completely standalone lines (lines 17–21 of the file). No comma precedes any comment on the same line. The bug will fire the moment any developer adds an inline comment after a comma-terminated property — a natural, common JSONC authoring pattern.

**Fix:** After comment stripping, add a pass that removes trailing commas before `}` or `]`:

```typescript
function readJsonc(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  const noComments = raw.replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, stringLiteral) => stringLiteral ?? "",
  );
  // Remove trailing commas before ] or } (valid JSONC, invalid JSON)
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailingCommas);
}
```

---

## Warnings

### WR-01: `readJsonc` has no error wrapper — file-not-found produces an unattributed `ENOENT` instead of a diagnostic pointing to which config was missing

**File:** `tests/scaffold/infra.test.ts:20–33`  
**Issue:** `fs.readFileSync` on line 21 throws a raw `ENOENT: no such file or directory` if the config file does not exist. The caller tests check `fs.existsSync` in a separate `it` block (lines 62–66). When that `it` is skipped or the file path is wrong, the `readJsonc` call in the content-assertion tests produces an OS error instead of a Vitest assertion failure, and the message does not mention which test triggered it or what file was expected.

**Fix:**
```typescript
function readJsonc(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    throw new Error(`readJsonc: file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  // ... stripping
}
```

---

### WR-02: `readJsonc` called three times on the same file path for INF-02 assertions — no shared parse result

**File:** `tests/scaffold/infra.test.ts:71, 77, 84`  
**Issue:** Each of the three INF-02 `it` blocks calls `readJsonc(configPath)` independently. The file is read and the full regex pipeline is re-executed three times on identical input. If `readJsonc` ever throws (e.g., from the CR-01/CR-02 bugs being triggered), the same parse failure appears three times with three different test names, making triage harder. Compare the INF-01 blocks at lines 44–58 where two properties are asserted from one `readJson(pkgPath)` call within a single `it`.

**Fix:** Combine the three `compilerOptions` assertions into one `it` block that parses once:

```typescript
it("tsconfig.base.json has strict, noUncheckedIndexedAccess, and module: NodeNext", () => {
  const config = readJsonc(path.join(REPO_ROOT, "tsconfig.base.json")) as Record<string, unknown>;
  const co = config.compilerOptions as Record<string, unknown> | undefined;
  expect(co?.strict).toBe(true);
  expect(co?.noUncheckedIndexedAccess).toBe(true);
  expect(co?.module).toBe("NodeNext");
});
```

---

## Info

### IN-01: Three `describe` blocks incorrectly share the label `"INF-01:"`

**File:** `tests/scaffold/infra.test.ts:36, 125, 140`  
**Issue:** Three distinct `describe` groups all begin with `"INF-01:"`:
- Line 36: `"INF-01: pnpm workspace"`
- Line 125: `"INF-01: Node version pinning"`
- Line 140: `"INF-01: Package stubs"`

Duplicate describe labels make test output ambiguous when any of these groups fail, and they do not match the `INF-01..05` spread described in the comment at line 1.

**Fix:** Assign correct requirement IDs. Node version pinning likely maps to `INF-04` and package stubs to `INF-05` based on the requirement hierarchy described in `REQUIREMENTS.md`. Update the label strings in the `describe` calls at lines 125 and 140.

---

### IN-02: `readJsonc` has no unit tests for its own comment-stripping logic

**File:** `tests/scaffold/infra.test.ts:20–33`  
**Issue:** The JSONC comment-stripping logic is non-trivial. The two bugs found in CR-01 and CR-02 would have been caught by a focused unit test for `readJsonc` itself. The project mandates TDD and explicit edge-case coverage (CLAUDE.md: "Edge cases obrigatórios"). The helper currently has no coverage of: block comment inside a string value, block comment spanning two string values, inline `//` after comma, URL `https://...` in string values, or escaped quotes in strings.

**Fix:** Add a `describe("readJsonc helper")` block (either inline or in a companion `tests/scaffold/read-jsonc.test.ts`) covering these invariants before the call sites exercise it on real files. This is consistent with the TDD mandate and would have surfaced CR-01 and CR-02 at implementation time.

---

_Reviewed: 2026-06-02_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_
