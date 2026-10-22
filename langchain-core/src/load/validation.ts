/** Escaping backported from e5063f9c with circular/shared-reference fixes a46a2498. */
export const LC_ESCAPED_KEY = "__lc_escaped__";

export function isEscapedObject(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length === 1 && LC_ESCAPED_KEY in obj;
}

/** Preserve LC instances, and mark LC-shaped plain user data as inert. */
export function escapeIfNeeded(
  value: unknown,
  pathSet: WeakSet<object> = new WeakSet(),
  key = "",
  secretMarkers: WeakSet<object> = new WeakSet()
): unknown {
  // Only markers created by this serialization operation carry secret authority.
  // Identical user-supplied objects must still be escaped below.
  if (value !== null && typeof value === "object" && secretMarkers.has(value)) {
    return value;
  }
  if (value !== null && typeof value === "object" && pathSet.has(value)) {
    return {
      lc: 1,
      type: "not_implemented",
      id:
        "lc_id" in value && Array.isArray(value.lc_id)
          ? value.lc_id
          : [value.constructor?.name ?? "Object"],
    };
  }
  if (value !== null && typeof value === "object") {
    // Serializable objects perform their own escaping when JSON.stringify
    // calls toJSON. Do not turn them into plain objects.
    if (
      "lc_serializable" in value &&
      "toJSON" in value &&
      typeof value.toJSON === "function"
    ) {
      return value;
    }
    if ("toJSON" in value && typeof value.toJSON === "function") {
      // Preserve JSON hooks (Date, URL, Buffer and user-defined objects), with
      // the property key JSON.stringify would supply. Normalize to plain JSON
      // once so a copied hook cannot execute later and bypass escaping.
      // Any LC-shaped output of this non-LC hook is still untrusted user data.
      const normalized = JSON.parse(JSON.stringify({ [key]: value }))[key];
      return escapeIfNeeded(normalized, pathSet, key, secretMarkers);
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(value) && ("lc" in record || isEscapedObject(record))) {
      // Do not recurse into a wrapped value: all of it is inert user data.
      return { [LC_ESCAPED_KEY]: record };
    }
    pathSet.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item, index) =>
          escapeIfNeeded(item, pathSet, `${index}`, secretMarkers)
        );
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, val]) => [
          key,
          escapeIfNeeded(val, pathSet, key, secretMarkers),
        ])
      );
    } finally {
      pathSet.delete(value);
    }
  }
  return value;
}
