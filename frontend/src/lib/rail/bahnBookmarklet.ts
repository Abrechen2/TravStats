/**
 * The „In TravStats übernehmen“ bookmarklet (forgejo#204).
 *
 * bahn.de refuses the server's request for a shared connection (403
 * OPS_BLOCKED, by TLS fingerprint), and TravStats does not disguise itself as a
 * browser; CORS keeps the TravStats page from reading bahn.de. So the request is
 * made where it is an ordinary visitor's request: on bahn.de, from a bookmark
 * the user clicks there. It does exactly three things and nothing else:
 *
 * 1. takes the `vbid` from the page's address — or, on any other bahn.de page,
 *    from a share link the user pastes into the browser's own prompt;
 * 2. GETs `/web/api/angebote/verbindung/{vbid}` same-origin — the one request
 *    the page itself makes. Never the recon POST, which bahn.de blocks after a
 *    few requests;
 * 3. opens THIS instance with the answer, trimmed to the connection — its
 *    stops' EVA numbers and each vehicle's product group included, which tell
 *    a tram from a train (2026-10-23) — in the
 *    URL FRAGMENT — a fragment is never sent to a server, so the ride does not
 *    land in any access log.
 *
 * It writes nothing into bahn.de's page. TravStats treats what arrives as
 * untrusted (`bahnHandoff.ts`), and every failure arrives as a code (`e=…`)
 * the TravStats page words, never as text the bookmarklet made up.
 */

/** Where the bookmarklet hands over; the page that reads the fragment. */
export const BAHN_HANDOFF_PATH = "/rail/from-bahn";

/** Longest fragment the bookmarklet sends and TravStats accepts. */
export const MAX_HANDOFF_FRAGMENT = 48_000;

/**
 * Readable source. `__TARGET__`, `__PROMPT__` and `__MAX__` are replaced with
 * JSON literals, so neither an origin nor a translation can break out of a
 * string. ES5 on purpose: it runs in whatever browser the user has, on a page
 * whose build we do not control.
 */
const SOURCE = `(function(){
var T=__TARGET__,go=function(h){location.href=T+"#"+h};
if(!/(^|\\.)bahn\\.de$/.test(location.hostname))return go("e=notBahn");
var id=function(u){try{var x=new URL(u);return x.searchParams.get("vbid")||new URLSearchParams(x.hash.slice(1)).get("vbid")}catch(e){return null}};
var v=id(location.href);
if(!v){var p=prompt(__PROMPT__);if(p===null)return;v=id(p.trim())}
if(!v||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))return go("e=noVbid");
fetch("/web/api/angebote/verbindung/"+v,{headers:{Accept:"application/json"},credentials:"same-origin"})
.then(function(r){if(!r.ok)throw r.status;return r.json()})
.then(function(j){
var c=j.verbindung||(j.verbindungen||[])[0]||j,a=c.verbindungsAbschnitte;
if(Array.isArray(a)&&a.length>30)return go("e=tooLarge");
var d={v:1,answer:{hinfahrtRecon:j.hinfahrtRecon,klasse:j.klasse,verbindungsAbschnitte:Array.isArray(a)?a.map(function(s){var m=s.verkehrsmittel||{};return{abfahrtsOrt:s.abfahrtsOrt,ankunftsOrt:s.ankunftsOrt,abfahrtsZeitpunkt:s.abfahrtsZeitpunkt,ankunftsZeitpunkt:s.ankunftsZeitpunkt,verkehrsmittel:{name:m.name,kurzText:m.kurzText,nummer:m.nummer,typ:m.typ,produktGattung:m.produktGattung},abfahrtsOrtExtId:s.abfahrtsOrtExtId,ankunftsOrtExtId:s.ankunftsOrtExtId}}):undefined}};
var q=encodeURIComponent(JSON.stringify(d));
go(q.length>__MAX__?"e=tooLarge":"d="+q)})
.catch(function(s){go("e="+(s===403?"blocked":s===404||s===410?"expired":s===429?"rateLimited":typeof s==="number"?"providerError":s instanceof SyntaxError?"unreadable":"fetchFailed"))})
})()`;

/** The script itself, for a test to run against a stand-in bahn.de. */
export function bahnBookmarkletSource(origin: string, promptText: string): string {
  // Function replacements: a `$` in a translation must not be read as `$&`.
  return SOURCE.replace("__TARGET__", () => JSON.stringify(`${origin}${BAHN_HANDOFF_PATH}`))
    .replace("__PROMPT__", () => JSON.stringify(promptText))
    .replace("__MAX__", () => String(MAX_HANDOFF_FRAGMENT - 2))
    .replace(/\n/g, "");
}

/**
 * The bookmark's address. Percent-encoded as a whole: a browser decodes a
 * `javascript:` URL before running it, and an unencoded `%` or `#` in a
 * translation would otherwise corrupt the script.
 */
export function bahnBookmarkletHref(origin: string, promptText: string): string {
  return `javascript:${encodeURIComponent(bahnBookmarkletSource(origin, promptText))}`;
}
