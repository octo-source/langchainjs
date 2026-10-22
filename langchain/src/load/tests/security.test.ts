/* eslint-disable no-process-env -- only a synthetic test sentinel is used. */
import { test, expect, jest } from "@jest/globals";
import { HumanMessage } from "@langchain/core/messages";

// Isolate the wrapper policy from integrations; the real core loader runs.
jest.unstable_mockModule("../import_map.js", () => ({}));
const { load } = await import("../index.js");

test("legacy positional wrapper preserves explicit maps and requires env opt-in", async () => {
  const key = "LANGCHAIN_WRAPPER_TEST_SECRET";
  const previous = process.env[key];
  process.env[key] = "synthetic-env-secret";
  const serialized = JSON.stringify({ lc: 1, type: "secret", id: [key] });
  try {
    await expect(load(serialized)).rejects.toThrow(/Missing secret/);
    expect(await load(serialized, { [key]: "explicit-secret" })).toBe(
      "explicit-secret"
    );
    expect(await load(serialized, {}, {}, { secretsFromEnv: true })).toBe(
      "synthetic-env-secret"
    );
    await expect(
      load('{"nested":{"value":1}}', {}, {}, { maxDepth: 1 })
    ).rejects.toThrow(/Maximum recursion depth/);
    const data = { lc: 1, type: "secret", id: [key] };
    const original = new HumanMessage({
      content: "hello",
      additional_kwargs: { data },
    });
    const restored = await load<HumanMessage>(
      JSON.stringify(original),
      {},
      {},
      { secretsFromEnv: true }
    );
    expect(restored.additional_kwargs.data).toEqual(data);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});
