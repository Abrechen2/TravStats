/**
 * The completeness guard for the OpenAPI spec.
 *
 * `openapi.test.ts` next door checks that the spec *builds* and that a
 * handful of paths are present. This one checks the opposite direction:
 * that nothing the app serves is missing from it.
 *
 * Without this, "the API docs are complete" is a claim nobody measures.
 * It was wrong for 244 endpoints before anyone noticed, and the README
 * asserted the spec "never drifts" the whole time.
 */

import '../services/openapi/paths';
import { buildOpenApiDocument } from '../services/openapi/registry';
import {
  listDocumentableEndpoints,
  listMountedEndpoints,
  UNDOCUMENTED_MOUNTS,
} from '../services/openapi/coverage';
import { PENDING_DOCUMENTATION } from '../services/openapi/pending';

const documentedOperations = (): Set<string> => {
  const doc = buildOpenApiDocument();
  const ops = new Set<string>();
  for (const [path, operations] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(operations as Record<string, unknown>)) {
      ops.add(`${method.toLowerCase()} ${path}`);
    }
  }
  return ops;
};

const label = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

describe('openapi coverage', () => {
  const documented = documentedOperations();
  const inScope = listDocumentableEndpoints();
  const pending = new Set(PENDING_DOCUMENTATION);

  it('has no endpoint that is neither documented nor explicitly pending', () => {
    const undocumented = inScope
      .filter((e) => !documented.has(`${e.method} ${e.path}`))
      .map((e) => label(e.method, e.path))
      .filter((l) => !pending.has(l));

    expect(undocumented).toEqual([]);
  });

  it('has no pending entry that is already documented', () => {
    // Forces the ratchet to tighten: documenting an endpoint without
    // removing its line here fails the build.
    const stale = [...pending].filter((entry) => {
      const [method, ...rest] = entry.split(' ');
      return documented.has(`${method.toLowerCase()} ${rest.join(' ')}`);
    });

    expect(stale).toEqual([]);
  });

  it('has no pending entry for an endpoint that no longer exists', () => {
    const live = new Set(inScope.map((e) => label(e.method, e.path)));
    const orphaned = [...pending].filter((entry) => !live.has(entry));

    expect(orphaned).toEqual([]);
  });

  it('documents nothing the app does not serve', () => {
    const live = new Set(listMountedEndpoints().map((e) => `${e.method} ${e.path}`));
    const phantom = [...documented].filter((op) => !live.has(op));

    expect(phantom).toEqual([]);
  });

  it('keeps every excluded mount id present in the mount table', () => {
    // A rename in mounts.ts would otherwise silently turn an exclusion
    // into a no-op and pull 60 admin endpoints into scope.
    const mountIds = new Set(listMountedEndpoints().map((e) => e.mountId));
    for (const id of UNDOCUMENTED_MOUNTS.keys()) {
      // 'openapi' serves openapi.json via a route; admin/setup have routes too.
      expect(mountIds.has(id)).toBe(true);
    }
  });
});
