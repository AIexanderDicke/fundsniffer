import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasIsinShape, isValidIsin, normalizeIsin } from "../src/isin.ts";

describe("hasIsinShape", () => {
  it("accepts structurally valid identifiers regardless of case", () => {
    assert.equal(hasIsinShape("IE00B4L5Y983"), true);
    assert.equal(hasIsinShape("ie00b4l5y983"), true);
  });

  it("rejects wrong lengths and characters", () => {
    assert.equal(hasIsinShape("IE00B4L5Y98"), false);
    assert.equal(hasIsinShape("IE00B4L5Y983X"), false);
    assert.equal(hasIsinShape("1E00B4L5Y983"), false);
    assert.equal(hasIsinShape("IE00B4L5Y98A"), false);
  });
});

describe("isValidIsin", () => {
  it("accepts real ISINs", () => {
    for (const isin of [
      "IE00B4L5Y983",
      "US0378331005",
      "DE000BAY0017",
      "GB00BJDQQQ59",
      "FR001400YYJ0",
      "LU1437020735",
      "US67066G1040",
    ]) {
      assert.equal(isValidIsin(isin), true, isin);
    }
  });

  it("rejects a wrong check digit", () => {
    assert.equal(isValidIsin("IE00B4L5Y984"), false);
  });

  it("rejects non-ISIN strings", () => {
    assert.equal(isValidIsin(""), false);
    assert.equal(isValidIsin("hello"), false);
  });
});

describe("normalizeIsin", () => {
  it("trims and upper-cases", () => {
    assert.equal(normalizeIsin("  ie00b4l5y983 "), "IE00B4L5Y983");
  });
});
