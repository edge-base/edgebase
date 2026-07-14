export const mutationTargets = Object.freeze([
  'src/lib/query-engine.ts',
  'src/lib/validation.ts',
  'src/lib/schema.ts',
  'src/lib/op-parser.ts',
  'src/lib/uuid.ts',
  'src/lib/errors.ts',
  'src/lib/cidr.ts',
  'src/lib/password.ts',
  'src/lib/do-router.ts',
  'src/lib/service-key.ts',
]);

export function filterMutationTargets(paths) {
  const configured = new Set(mutationTargets);
  const files = Array.isArray(paths) ? paths : paths.split(/\r?\n/);
  return files.map((file) => file.trim()).filter((file) => configured.has(file));
}
