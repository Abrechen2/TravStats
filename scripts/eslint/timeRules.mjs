/**
 * ESLint rules for the time model (ADR 0002, D6) — used by BOTH trees.
 *
 * Every rule here forbids a way of letting the HOST's zone (the server's
 * container, the reader's browser) decide a calendar day or a clock reading.
 * The ADR counted 29 host-local getters in the backend and 75 in the web, and
 * about 35 incidents in 60 days that came from answering "which day" in the
 * wrong zone. The one module allowed to talk to zones is `shared/time/`; each
 * tree's config exempts it.
 *
 * The rules are a RATCHET, not a cleanup: today's offenders are frozen per
 * tree in `eslint-suppressions.json` (ESLint bulk suppressions), a new
 * offender fails `npm run lint`, and a fixed one leaves a stale suppression,
 * which ESLint also reports as an error until the entry is pruned. The
 * baselines go to zero in phase 4 of the plan.
 *
 * No type information: the frontend lints without a TypeScript program (it
 * would multiply lint time), so both trees get the same syntactic rules and
 * behave identically. Where syntax cannot tell a Date from a number —
 * `toLocaleString` — the receiver must LOOK like a date (see DATE_LIKE_NAME);
 * the 40-odd number formatters in the web tree are not dates and are not
 * reported.
 */

/** Getters and setters that read or write the host zone's wall clock. */
const HOST_LOCAL_METHODS = new Set([
  "getFullYear",
  "getYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "getTimezoneOffset",
  "setFullYear",
  "setYear",
  "setMonth",
  "setDate",
  "setHours",
  "setMinutes",
  "setSeconds",
  "setMilliseconds",
]);

/** Formatters that use the host zone unless given `timeZone`. */
const ZONED_FORMAT_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);

/**
 * `toLocaleString` is also Number's, and most calls in this codebase format
 * distances. It is reported only when the receiver is `new Date(…)` or an
 * identifier/property whose last camelCase word names a moment
 * (`time`, `startedAt`, `checkInDate`, `departureTime`, …).
 */
const DATE_LIKE_NAME =
  /(?:^(?:date|time|when|instant|timestamp|now|day)$)|(?:[a-z0-9](?:Date|Time|At|When|Instant|Timestamp|Day)$)/;

/** date-fns / date-fns-tz exports that format or convert in a zone. */
const RESTRICTED_IMPORTS = {
  "date-fns": new Set(["format"]),
  "date-fns-tz": new Set(["fromZonedTime", "toZonedTime", "formatInTimeZone", "format"]),
};

function propertyName(member) {
  if (member.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (member.computed && member.property.type === "Literal") return String(member.property.value);
  return null;
}

function isDateConstructor(node) {
  return (
    node.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "Date"
  );
}

function isIntlDateTimeFormat(callee) {
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Intl" &&
    propertyName(callee) === "DateTimeFormat"
  );
}

function looksLikeDate(receiver) {
  if (isDateConstructor(receiver)) return true;
  if (receiver.type === "Identifier") return DATE_LIKE_NAME.test(receiver.name);
  const name = propertyName(receiver);
  return name !== null && DATE_LIKE_NAME.test(name);
}

function hasTimeZoneKey(objectExpression) {
  return objectExpression.properties.some((p) => {
    if (p.type !== "Property") return false;
    if (!p.computed && p.key.type === "Identifier") return p.key.name === "timeZone";
    return p.key.type === "Literal" && p.key.value === "timeZone";
  });
}

/**
 * Does this options argument name a `timeZone`? An object literal is read
 * directly; an identifier is followed ONE step to a `const` initialised with an
 * object literal in the same file. Anything else cannot be known and counts
 * as "no" — a baseline entry is cheaper than a false "fine".
 */
function optionsNameTimeZone(context, node, options) {
  if (!options) return false;
  if (options.type === "ObjectExpression") return hasTimeZoneKey(options);
  if (options.type !== "Identifier") return false;
  const scope = context.sourceCode.getScope(node);
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(options.name);
    if (!variable) continue;
    const def = variable.defs[0];
    const init = def?.node?.type === "VariableDeclarator" ? def.node.init : null;
    return (
      def?.parent?.kind === "const" && init?.type === "ObjectExpression" && hasTimeZoneKey(init)
    );
  }
  return false;
}

const noHostLocalDate = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid Date getters/setters and multi-argument `new Date(…)` that use the host's zone",
    },
    schema: [],
    messages: {
      hostGetter:
        "`{{name}}()` reads the HOST zone's clock. Use shared/time (toLocal, localDay) or the UTC getter.",
      hostConstructor:
        "`new Date(y, m, …)` builds the date in the HOST zone. Use `new Date(Date.UTC(…))` or shared/time.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (name && HOST_LOCAL_METHODS.has(name) && node.parent.type === "CallExpression") {
          if (node.parent.callee !== node) return;
          context.report({ node: node.property, messageId: "hostGetter", data: { name } });
        }
      },
      NewExpression(node) {
        if (isDateConstructor(node) && node.arguments.length > 1) {
          context.report({ node, messageId: "hostConstructor" });
        }
      },
    };
  },
};

const noZonelessFormat = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid date formatting without an explicit `timeZone`",
    },
    schema: [],
    messages: {
      localeString:
        "`{{name}}()` without a `timeZone` option formats in the HOST zone. Pass `timeZone`, or use shared/time formatTimeValue.",
      intlFormat:
        "`Intl.DateTimeFormat` without a `timeZone` option formats in the HOST zone. Pass `timeZone`, or use shared/time.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = propertyName(node.callee);
        if (!name) return;
        const zoned = ZONED_FORMAT_METHODS.has(name);
        const dateLike = name === "toLocaleString" && looksLikeDate(node.callee.object);
        if (!zoned && !dateLike) return;
        if (optionsNameTimeZone(context, node, node.arguments[1])) return;
        context.report({ node: node.callee.property, messageId: "localeString", data: { name } });
      },
      "NewExpression, CallExpression"(node) {
        if (!isIntlDateTimeFormat(node.callee)) return;
        if (optionsNameTimeZone(context, node, node.arguments[1])) return;
        context.report({ node, messageId: "intlFormat" });
      },
    };
  },
};

const noZoneLibrary = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid date-fns `format` and date-fns-tz zone conversions outside shared/time",
    },
    schema: [],
    messages: {
      restricted:
        "`{{name}}` from {{source}} converts or formats in a zone outside shared/time. Use shared/time instead.",
      namespace:
        "A namespace import of {{source}} reaches its zone functions outside shared/time. Use shared/time instead.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const restricted = RESTRICTED_IMPORTS[source];
        if (!restricted) return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportNamespaceSpecifier" && source === "date-fns-tz") {
            context.report({ node: spec, messageId: "namespace", data: { source } });
          } else if (spec.type === "ImportSpecifier") {
            const name = spec.imported.name ?? spec.imported.value;
            if (restricted.has(name)) {
              context.report({ node: spec, messageId: "restricted", data: { name, source } });
            }
          }
        }
      },
    };
  },
};

const noAmbientNow = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid reading the clock directly in files that decide a day or a status; ask shared/time's clock",
    },
    schema: [],
    messages: {
      ambientNow:
        "This file decides a day or a status, so it must not read the clock itself (`{{what}}`). Take `now` as a parameter or use shared/time `now()`, so tests can pin it at 23:59 and 00:01.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Date" &&
          propertyName(callee) === "now"
        ) {
          context.report({ node, messageId: "ambientNow", data: { what: "Date.now()" } });
        }
      },
      NewExpression(node) {
        if (isDateConstructor(node) && node.arguments.length === 0) {
          context.report({ node, messageId: "ambientNow", data: { what: "new Date()" } });
        }
      },
    };
  },
};

/** The plugin, registered in both trees as `time`. */
export const timePlugin = {
  meta: { name: "travstats-time" },
  rules: {
    "no-host-local-date": noHostLocalDate,
    "no-zoneless-format": noZonelessFormat,
    "no-zone-library": noZoneLibrary,
    "no-ambient-now": noAmbientNow,
  },
};

/** The three rules every non-exempt source file gets, as errors. */
export const timeRulesEverywhere = {
  "time/no-host-local-date": "error",
  "time/no-zoneless-format": "error",
  "time/no-zone-library": "error",
};

/** The rule that applies only to the files listed per tree (status / "today" deciders). */
export const timeRulesStatusFiles = {
  "time/no-ambient-now": "error",
};
