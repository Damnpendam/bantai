import { test } from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, salvageTruncatedJson } from "./json-salvage.ts";

const whole = JSON.stringify({
  cases: [
    { title: "one", steps: ["a", "b"] },
    { title: "two", steps: ["c"] },
    { title: "three", steps: ["d"] },
  ],
});

function titles(value: unknown): string[] {
  return ((value as { cases: { title: string }[] }).cases ?? []).map((c) => c.title);
}

test("keeps complete elements when the response is cut mid-object", () => {
  const cut = whole.slice(0, whole.indexOf('"three"') + 20);
  const repaired = salvageTruncatedJson(cut);
  assert.ok(repaired);
  assert.deepEqual(titles(JSON.parse(repaired)), ["one", "two"]);
});

test("keeps complete elements when the response is cut mid-string", () => {
  const cut = whole.slice(0, whole.indexOf('"thr') + 3);
  const repaired = salvageTruncatedJson(cut);
  assert.ok(repaired);
  assert.deepEqual(titles(JSON.parse(repaired)), ["one", "two"]);
});

test("does not mistake braces inside string values for structure", () => {
  const input = '{"cases":[{"title":"use {curly} braces","steps":["a"]},{"title":"tr';
  const repaired = salvageTruncatedJson(input);
  assert.ok(repaired);
  assert.deepEqual(titles(JSON.parse(repaired)), ["use {curly} braces"]);
});

test("does not mistake escaped quotes for the end of a string", () => {
  const input = '{"cases":[{"title":"say \\"hi\\"","steps":["a"]},{"title":"tr';
  const repaired = salvageTruncatedJson(input);
  assert.ok(repaired);
  assert.deepEqual(titles(JSON.parse(repaired)), ['say "hi"']);
});

test("refuses when no element ever completed", () => {
  assert.equal(salvageTruncatedJson('{"cases":[{"title":"on'), null);
});

test("parses clean json without claiming a salvage", () => {
  const parsed = parseModelJson(whole);
  assert.ok(parsed);
  assert.equal(parsed.salvaged, false);
  assert.deepEqual(titles(parsed.value), ["one", "two", "three"]);
});

test("unwraps markdown fences, with and without a language tag", () => {
  for (const wrapped of ["```json\n" + whole + "\n```", "```\n" + whole + "\n```"]) {
    const parsed = parseModelJson(wrapped);
    assert.ok(parsed, wrapped.slice(0, 12));
    assert.equal(parsed.salvaged, false);
    assert.deepEqual(titles(parsed.value), ["one", "two", "three"]);
  }
});

test("strips prose on either side of the json", () => {
  const parsed = parseModelJson(`Sure! Here you go:\n${whole}\n\nLet me know.`);
  assert.ok(parsed);
  assert.deepEqual(titles(parsed.value), ["one", "two", "three"]);
});

test("recovers output that is both fenced and truncated", () => {
  const cut = whole.slice(0, whole.indexOf('{"title":"two"') + 9);
  const parsed = parseModelJson("```json\n" + cut);
  assert.ok(parsed);
  assert.equal(parsed.salvaged, true);
  assert.deepEqual(titles(parsed.value), ["one"]);
});

test("returns null rather than guessing at non-json", () => {
  assert.equal(parseModelJson("I cannot help with that request."), null);
  assert.equal(parseModelJson(""), null);
});
