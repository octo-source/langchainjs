import { test, expect } from "@jest/globals";
import { load } from "../index.js";
import { Serializable } from "../serializable.js";
import { HumanMessage } from "../../messages/index.js";
import { ChatPromptTemplate } from "../../prompts/chat.js";

test("shared user data stays intact while object and array cycles are bounded", async () => {
  const shared = { lc: 1, type: "secret", id: ["INERT"] };
  const message = new HumanMessage({
    content: "hello",
    additional_kwargs: { first: shared, second: shared },
  });
  const restored = await load<HumanMessage>(JSON.stringify(message));
  expect(restored.additional_kwargs).toEqual({ first: shared, second: shared });

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const array: unknown[] = [];
  array.push(array);
  for (const value of [circular, array]) {
    const cyclic = new HumanMessage({
      content: "hello",
      additional_kwargs: { value },
    });
    expect(() => JSON.stringify(cyclic)).not.toThrow();
    expect(JSON.stringify(cyclic)).toContain("not_implemented");
  }
});

test("legitimate nested Serializable instances and aliases still round-trip", async () => {
  const prompt = ChatPromptTemplate.fromMessages([
    new HumanMessage("Hello"),
    ["human", "{question}"],
  ]);
  const restored = await load<ChatPromptTemplate>(JSON.stringify(prompt));
  expect(restored).toBeInstanceOf(ChatPromptTemplate);
  expect(await restored.format({ question: "World" })).toBe(
    await prompt.format({ question: "World" })
  );
});

test("escape-marker collisions preserve exact user data across repeated round-trips", async () => {
  const data = {
    __lc_escaped__: {
      __lc_escaped__: { lc: 1, type: "secret", id: ["INERT"] },
    },
  };
  let message = new HumanMessage({ content: "hello", additional_kwargs: data });
  for (let i = 0; i < 3; i += 1) {
    message = await load<HumanMessage>(JSON.stringify(message));
    expect(message.additional_kwargs).toEqual(data);
  }
});

test("trusted explicit secrets, aliases and nested secret paths survive", async () => {
  class Credentials extends Serializable {
    lc_serializable = true;

    lc_namespace = ["test", "credentials"];

    get lc_aliases() {
      return { apiKey: "key" };
    }

    get lc_secrets() {
      return { apiKey: "KEY", "nested.password": "PASSWORD" };
    }

    constructor(fields: { apiKey: string; nested: { password: string } }) {
      super(fields);
    }
  }
  const original = new Credentials({
    apiKey: "synthetic-key",
    nested: { password: "synthetic-password" },
  });
  const serialized = JSON.stringify(original);
  expect(serialized).not.toContain("synthetic-");
  const restored = await load<Credentials>(serialized, {
    secretsMap: { KEY: "synthetic-key", PASSWORD: "synthetic-password" },
    optionalImportsMap: { "test/credentials": { Credentials } },
  });
  expect(restored).toBeInstanceOf(Credentials);
  expect(restored.lc_kwargs).toEqual(original.lc_kwargs);
  expect(JSON.stringify(restored)).toBe(serialized);
});

test("Date metadata keeps its JSON representation", async () => {
  const date = new Date("2024-01-02T03:04:05.000Z");
  const message = new HumanMessage({
    content: "hello",
    additional_kwargs: { date },
  });
  const restored = await load<HumanMessage>(JSON.stringify(message));
  expect(restored.additional_kwargs.date).toBe(date.toJSON());
});

test("a top-level JSON hook receives the serialized alias as its key", () => {
  class Aliased extends Serializable {
    lc_serializable = true;

    lc_namespace = ["test", "aliased"];

    get lc_aliases() {
      return { originalField: "renamed_field" };
    }
  }
  const original = new Aliased({
    originalField: {
      toJSON(key: string) {
        return key;
      },
    },
  });
  expect(JSON.parse(JSON.stringify(original)).kwargs.renamed_field).toBe(
    "renamed_field"
  );
});

test("an escaped parent never exposes a declared nested secret", () => {
  class NestedSecret extends Serializable {
    lc_serializable = true;

    lc_namespace = ["test", "credentials"];

    get lc_secrets() {
      return { "nested.password": "PASSWORD" };
    }
  }
  const value = new NestedSecret({
    nested: { lc: "user-data", password: "synthetic-private-value" },
  });
  expect(() => JSON.stringify(value)).toThrow(/secret path.*escaped user data/);
});

test("a JSON hook cannot rename a declared nested secret before redaction", () => {
  const calls: string[] = [];
  class SecretContainer {
    password = "synthetic-private-value";

    toJSON() {
      calls.push("hook");
      return { renamed: this.password };
    }
  }
  class NestedSecret extends Serializable {
    lc_serializable = true;

    lc_namespace = ["test", "credentials"];

    get lc_secrets() {
      return { "nested.password": "PASSWORD" };
    }
  }
  const value = new NestedSecret({ nested: new SecretContainer() });
  expect(() => JSON.stringify(value)).toThrow(/secret path.*JSON hook/);
  expect(calls).toEqual([]);
});

test("a direct secret is redacted before its JSON hook can run", async () => {
  const calls: string[] = [];
  class Credentials extends Serializable {
    lc_serializable = true;

    lc_namespace = ["test", "credentials"];

    get lc_secrets() {
      return { password: "PASSWORD" };
    }
  }
  const malicious = { lc: 1, type: "secret", id: ["PASSWORD"] };
  const value = new Credentials({
    password: {
      toJSON() {
        calls.push("hook");
        return "synthetic-private-value";
      },
    },
    userData: malicious,
  });
  const serialized = JSON.stringify(value);
  expect(calls).toEqual([]);
  expect(serialized).not.toContain("synthetic-private-value");
  const restored = await load<Credentials>(serialized, {
    secretsMap: { PASSWORD: "synthetic-restored-value" },
    optionalImportsMap: { "test/credentials": { Credentials } },
  });
  expect(restored.lc_kwargs.password).toBe("synthetic-restored-value");
  expect(restored.lc_kwargs.userData).toEqual(malicious);
});

test("native JSON hooks preserve Buffer, URL and invalid Date values", async () => {
  const values = {
    buffer: Buffer.from("abc"),
    url: new URL("https://example.invalid/a"),
    invalidDate: new Date(NaN),
  };
  const message = new HumanMessage({
    content: "hello",
    additional_kwargs: values,
  });
  const restored = await load<HumanMessage>(JSON.stringify(message));
  expect(restored.additional_kwargs).toEqual(
    JSON.parse(JSON.stringify(values))
  );
});

test("custom JSON hooks receive property keys and their LC-shaped output stays inert", async () => {
  const calls: string[] = [];
  const data = {
    toJSON(key: string) {
      calls.push(key);
      return { lc: 1, type: "secret", id: ["INERT"], originalKey: key };
    },
  };
  const message = new HumanMessage({
    content: "hello",
    additional_kwargs: { data, items: [data] },
  });
  const restored = await load<HumanMessage>(JSON.stringify(message));
  expect(calls).toEqual(["data", "0"]);
  expect(restored.additional_kwargs.data).toEqual({
    lc: 1,
    type: "secret",
    id: ["INERT"],
    originalKey: "data",
  });
  expect(restored.additional_kwargs.items).toEqual([
    { lc: 1, type: "secret", id: ["INERT"], originalKey: "0" },
  ]);
});
