/**
 * Endpoint coverage: what the app actually serves vs. what the spec
 * documents.
 *
 * The OpenAPI paths are hand-registered (see `paths/`), which is a
 * deliberate trade — a generated spec cannot express a good summary,
 * a realistic example, or which of three 4xx a caller should expect.
 * The cost of hand-registration is that a new endpoint is documented
 * only if someone remembers. This module removes the remembering: it
 * enumerates the live Express router tree from the same mount table
 * index.ts uses, so the guard test can name every endpoint that has no
 * entry in the spec.
 *
 * Exclusions are listed here, by mount id, and nowhere else. An
 * endpoint is either documented or explicitly named as out of scope —
 * "we forgot" is not a reachable state.
 */

import type { Router } from 'express';

import { apiMounts } from '../../routes/mounts';

export interface MountedEndpoint {
  /** Lowercase HTTP method, e.g. "get". */
  method: string;
  /** OpenAPI-style path relative to the /api/v1 server root, e.g. "/flights/{id}". */
  path: string;
  /** `id` of the mount table entry this endpoint came from. */
  mountId: string;
}

/**
 * Mounts deliberately kept out of the published spec.
 *
 * Owner decision (2026-08-28): the spec covers everything a normal user
 * token can reach. Admin and the first-boot wizard stay out — publishing
 * them alongside the wiki would turn 60-odd internal signatures into a
 * compatibility promise, and neither is a surface an external
 * integration is meant to drive.
 */
export const UNDOCUMENTED_MOUNTS: ReadonlyMap<string, string> = new Map([
  ['admin', 'Admin console API — admin-scope only, free to change between minor versions'],
  ['setup', 'First-boot wizard — unauthenticated, single-use, not an integration surface'],
  ['openapi', 'The spec and Swagger UI themselves'],
]);

const API_ROOT = '/api/v1';

/** Express 4 builds this source for a router mounted at '/'. */
const FAST_SLASH = '^\\/?(?=\\/|$)';
const MOUNT_SUFFIX = '\\/?(?=\\/|$)';
/** What path-to-regexp emits for a `:param` segment inside a mount path. */
const PARAM_GROUP = '(?:([^\\/]+?))';

interface ExpressLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: ExpressLayer[] };
  regexp?: RegExp;
  keys?: Array<{ name: string | number }>;
}

/**
 * Recover the mount path of a nested router from its compiled regexp.
 *
 * Express keeps no plain-text copy of it, so this decodes the source and
 * puts `:param` names back from `layer.keys`. Returning a wrong prefix
 * would make the guard demand documentation for paths that do not exist,
 * so anything unrecognised throws rather than guesses.
 */
const decodeMountPrefix = (layer: ExpressLayer): string => {
  const source = layer.regexp?.source;
  if (!source || source === FAST_SLASH) return '';

  let body = source.startsWith('^') ? source.slice(1) : source;
  if (body.endsWith(MOUNT_SUFFIX)) body = body.slice(0, -MOUNT_SUFFIX.length);

  const keys = layer.keys ?? [];
  let keyIndex = 0;
  while (body.includes(PARAM_GROUP)) {
    const key = keys[keyIndex++];
    if (!key) throw new Error(`Cannot name parameter ${keyIndex} in mount regexp ${source}`);
    body = body.replace(PARAM_GROUP, `:${String(key.name)}`);
  }

  const prefix = body.replace(/\\(.)/g, '$1');
  if (!prefix.startsWith('/') || /[()[\]?*+|^$]/.test(prefix)) {
    throw new Error(`Unsupported router mount regexp: ${source}`);
  }
  return prefix;
};

/** `/trips/:id/photos/:photoId` → `/trips/{id}/photos/{photoId}` */
export const toOpenApiPath = (expressPath: string): string =>
  expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

const walk = (stack: ExpressLayer[], prefix: string, mountId: string, out: MountedEndpoint[]) => {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        const full = `${prefix}${routePath === '/' ? '' : routePath}`;
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          out.push({ method: method.toLowerCase(), path: full, mountId });
        }
      }
      continue;
    }
    if (layer.handle?.stack) {
      walk(layer.handle.stack, prefix + decodeMountPrefix(layer), mountId, out);
    }
  }
};

/** Every endpoint the app serves, deduplicated, in mount order. */
export const listMountedEndpoints = (): MountedEndpoint[] => {
  const out: MountedEndpoint[] = [];
  for (const { id, base, router } of apiMounts) {
    const stack = (router as Router & { stack?: ExpressLayer[] }).stack ?? [];
    walk(stack, base, id, out);
  }

  const seen = new Set<string>();
  return out
    .filter((e) => {
      const key = `${e.method} ${e.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((e) => ({
      ...e,
      path: toOpenApiPath(e.path.startsWith(API_ROOT) ? e.path.slice(API_ROOT.length) || '/' : e.path),
    }));
};

/** The subset the spec is expected to document in full. */
export const listDocumentableEndpoints = (): MountedEndpoint[] =>
  listMountedEndpoints().filter((e) => !UNDOCUMENTED_MOUNTS.has(e.mountId));
