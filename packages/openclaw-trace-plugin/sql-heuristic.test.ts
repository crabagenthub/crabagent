import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeSqlDump } from "./sql-heuristic.js";

describe("sql-heuristic", () => {
  it("短字符串不视为 dump", () => {
    assert.equal(looksLikeSqlDump("SELECT 1 FROM dual WHERE 1"), false);
  });

  it("长 SQL 样文本打标", () => {
    const line =
      "SELECT a,b FROM t WHERE id=1 UNION SELECT c FROM u JOIN v ON v.id=u.id DELETE FROM x WHERE 1 ";
    const buf = line.repeat(80);
    assert.ok(buf.length >= 800);
    assert.equal(looksLikeSqlDump(buf), true);
  });
});
