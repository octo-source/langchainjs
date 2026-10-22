import { load as coreLoad, type LoadOptions } from "@langchain/core/load";
import { optionalImportEntrypoints } from "./import_constants.js";
import * as importMap from "./import_map.js";
import { OptionalImportMap } from "./import_type.js";

/**
 * Load a LangChain module from a serialized text representation.
 * NOTE: This functionality is currently in beta.
 * Loaded classes may change independently of semver.
 * @param text Serialized text representation of the module.
 * @param secretsMap
 * @param optionalImportsMap
 * @param options Environment secrets are disabled by default. Only enable them
 * for trusted serialized text; import maps must also be trusted.
 * @returns A loaded instance of a LangChain module.
 */
export async function load<T>(
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  secretsMap: Record<string, any> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionalImportsMap: OptionalImportMap & Record<string, any> = {},
  options: Pick<LoadOptions, "secretsFromEnv" | "maxDepth"> = {}
): Promise<T> {
  return coreLoad(text, {
    ...options,
    secretsMap,
    optionalImportsMap,
    optionalImportEntrypoints,
    importMap,
  });
}
