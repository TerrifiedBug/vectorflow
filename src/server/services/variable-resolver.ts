export const VAR_REF_PATTERN = /^VAR\[(.+)]$/;

export function parseVarRef(value: string): string | null {
  const match = value.match(VAR_REF_PATTERN);
  return match ? match[1] : null;
}

export function makeVarRef(name: string): string {
  return `VAR[${name}]`;
}

export function collectVarRefs(config: Record<string, unknown>): Set<string> {
  const refs = new Set<string>();
  collectStringRefs(config, refs);
  return refs;
}

export function resolveVarRefs(
  config: Record<string, unknown>,
  pipelineVars: Record<string, string>,
  envVars: Map<string, string>,
): Record<string, unknown> {
  const refs = collectVarRefs(config);
  for (const ref of refs) {
    if (pipelineVars[ref] === undefined && !envVars.has(ref)) {
      throw new Error(`Variable "${ref}" not found in pipeline or environment variables`);
    }
  }

  return replaceVarRefs(config, pipelineVars, envVars);
}

function collectStringRefs(
  obj: Record<string, unknown> | unknown[],
  refs: Set<string>,
): void {
  const values = Array.isArray(obj) ? obj : Object.values(obj);
  for (const value of values) {
    if (typeof value === "string") {
      const ref = parseVarRef(value);
      if (ref) refs.add(ref);
    } else if (Array.isArray(value)) {
      collectStringRefs(value, refs);
    } else if (typeof value === "object" && value !== null) {
      collectStringRefs(value as Record<string, unknown>, refs);
    }
  }
}

function resolveValue(
  name: string,
  pipelineVars: Record<string, string>,
  envVars: Map<string, string>,
): string {
  if (pipelineVars[name] !== undefined) return pipelineVars[name];
  const envValue = envVars.get(name);
  if (envValue !== undefined) return envValue;
  throw new Error(`Variable "${name}" not found in pipeline or environment variables`);
}

function replaceVarRefs(
  obj: Record<string, unknown>,
  pipelineVars: Record<string, string>,
  envVars: Map<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const ref = parseVarRef(value);
      result[key] = ref ? resolveValue(ref, pipelineVars, envVars) : value;
    } else if (Array.isArray(value)) {
      result[key] = replaceVarRefsArray(value, pipelineVars, envVars);
    } else if (typeof value === "object" && value !== null) {
      result[key] = replaceVarRefs(value as Record<string, unknown>, pipelineVars, envVars);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function replaceVarRefsArray(
  arr: unknown[],
  pipelineVars: Record<string, string>,
  envVars: Map<string, string>,
): unknown[] {
  return arr.map((value) => {
    if (typeof value === "string") {
      const ref = parseVarRef(value);
      return ref ? resolveValue(ref, pipelineVars, envVars) : value;
    }
    if (Array.isArray(value)) {
      return replaceVarRefsArray(value, pipelineVars, envVars);
    }
    if (typeof value === "object" && value !== null) {
      return replaceVarRefs(value as Record<string, unknown>, pipelineVars, envVars);
    }
    return value;
  });
}
