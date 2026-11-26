import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Handler unit tests alone cannot catch orphaned code in the Next.js route module.
// Inspect the real entry point as well so the merge regression cannot hide there.
const source = readFileSync(new URL("../src/app/api/health/route.ts", import.meta.url), "utf8");
const file = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);

test("health route is a declarative adapter with no orphaned executable statements", () => {
  for (const statement of file.statements) {
    assert.ok(ts.isImportDeclaration(statement) || ts.isVariableStatement(statement),
      `Unexpected top-level statement: ${statement.getText(file).slice(0, 100)}`);
  }
  const handles = file.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]);
  const handler = handles.find(d => d.name.getText(file) === "handle");
  assert.ok(handler?.initializer && ts.isCallExpression(handler.initializer));
  assert.equal(handler.initializer.expression.getText(file), "createHealthHandler");
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const binding = handles.find(d => d.name.getText(file) === method);
    assert.equal(binding?.initializer?.getText(file), "handle", `${method} must use the method-guarded read-only handler`);
  }
});

test("health entry point does not retain the legacy mutating schema/bootstrap path", () => {
  assert.doesNotMatch(source, /ensureContentManagerTables|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
  assert.match(source, /readHealthSnapshot\(getDb\(\{ signal \}\)\)/);
  for (const flag of ["openRouter", "facebookEntertainment", "hivecompApi"]) assert.match(source, new RegExp(`${flag}:`));
});
