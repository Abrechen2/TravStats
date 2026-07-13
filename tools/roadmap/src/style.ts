/** Inline CSS for the generated roadmap page — kept out of render.ts so that file stays focused on markup. */
export const STYLE = `
:root { color-scheme: dark; --bg:#12141a; --card:#1b1e26; --card-quiet:#15171e; --line:#2a2e39;
        --text:#e6e8ee; --muted:#8b90a0; --amber:#f0a947; --red:#e0605e; --green:#7bc47f; --blue:#4aa6b0; }
* { box-sizing:border-box; }
body { margin:0; padding:24px; background:var(--bg); color:var(--text);
       font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1440px; margin:0 auto; }
h1 { font-size:19px; margin:0 0 4px; }
h2 { font-size:11px; margin:24px 0 8px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
h3 { font-size:11px; margin:14px 0 6px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
.meta { color:var(--muted); font-size:12px; margin-bottom:14px; }
.empty { color:var(--muted); font-size:13px; }
.warn { border-left:3px solid var(--amber); background:#241f16; padding:6px 10px; margin:4px 0;
        border-radius:0 4px 4px 0; font-size:12px; }

/* Above-the-fold two-column layout: decisions on the left get the only
   visual weight on the page, everything else is quieter by comparison. */
.top { display:grid; grid-template-columns:1.3fr 1fr; gap:16px; align-items:start; }
@media (max-width:900px) { .top { grid-template-columns:1fr; } }

/* Colour carries exactly one meaning each: red = drift/blocker, amber = a
   decision is needed, green = released/healthy, blue = links. Nothing else
   on this page is coloured. */
.decision { border:1px solid var(--line); border-left:3px solid var(--line); background:var(--card);
            padding:12px 14px; border-radius:0 6px 6px 0; margin-bottom:8px; }
.decision.amber { border-left-color:var(--amber); }
.decision.red { border-left-color:var(--red); }
.decision h3 { margin:0 0 6px; font-size:15px; text-transform:none; letter-spacing:normal; color:var(--text); }
.decision .d-lines { margin:0; padding-left:18px; color:var(--muted); font-size:13px; }
.decision .d-more { margin-top:4px; }
.decision .d-more summary { cursor:pointer; color:var(--muted); font-size:12px; list-style:none; }
.decision .d-more summary::-webkit-details-marker { display:none; }
.decision .d-more ul { margin:6px 0 0; padding-left:18px; color:var(--muted); font-size:13px; }

/* Deployment matrix: version-first, one row per running tag. */
.matrix { border-collapse:collapse; width:100%; }
.matrix th, .matrix td { text-align:left; padding:6px 10px 6px 0; border-bottom:1px solid var(--line);
                          font-size:13px; vertical-align:top; }
.matrix th { font-weight:600; white-space:nowrap; }
.matrix tr.red th { color:var(--red); }
.chip { display:inline-block; border:1px solid var(--line); border-radius:10px; padding:2px 8px;
        margin:0 6px 4px 0; font-size:12px; background:var(--card-quiet); }
.chip.red { border-color:var(--red); color:var(--red); }
.chip .hint { color:var(--muted); margin-left:6px; font-size:11px; }
.chip.red .hint { color:var(--red); }

/* Release table replaces the old 7-column kanban board. */
.release-table { border:1px solid var(--line); border-radius:6px; overflow:hidden; }
.release-head { display:grid; grid-template-columns:1fr 1fr 1.4fr .6fr .8fr; gap:8px; padding:6px 12px;
                background:var(--card-quiet); color:var(--muted); font-size:11px; text-transform:uppercase;
                letter-spacing:.06em; }
.release-row { border-top:1px solid var(--line); background:var(--card-quiet); }
.release-row summary { list-style:none; cursor:pointer; display:grid;
                        grid-template-columns:1fr 1fr 1.4fr .6fr .8fr; gap:8px; padding:8px 12px;
                        font-size:13px; align-items:center; }
.release-row summary::-webkit-details-marker { display:none; }
.release-row[open] summary { border-bottom:1px solid var(--line); }
.release-row .col-version { font-weight:600; }
.items { border-collapse:collapse; width:100%; }
.items th, .items td { text-align:left; padding:6px 12px; border-bottom:1px solid var(--line); font-size:12px; }
.items th { color:var(--muted); font-weight:500; }
.items .notes { margin-top:4px; color:var(--muted); white-space:pre-wrap; font-size:12px; }
.items p.empty { padding:8px 12px; margin:0; }
.badge { font-size:11px; padding:1px 6px; border-radius:10px; border:1px solid var(--line); }
.badge.green { border-color:var(--green); color:var(--green); }

/* Discord digest: grouped by channel + day, verbatim messages collapsed. */
.discord-group { border:1px solid var(--line); background:var(--card-quiet); border-radius:6px;
                  padding:8px 12px; margin-bottom:6px; }
.discord-group summary { cursor:pointer; list-style:none; font-size:13px; color:var(--muted); }
.discord-group summary::-webkit-details-marker { display:none; }
.discord-group[open] summary { color:var(--text); margin-bottom:8px; }
.msg { border-top:1px solid var(--line); padding-top:8px; margin-top:8px; }
.msg:first-of-type { border-top:none; padding-top:0; margin-top:0; }
.msg .h { color:var(--muted); font-size:12px; margin-bottom:4px; }
.msg .c { white-space:pre-wrap; }

/* Collapsed diagnostics: version notes, worktree paths, Dependabot — real
   information, not part of the five-second read. */
.diagnostics { border:1px solid var(--line); border-radius:6px; padding:10px 14px; margin-top:20px; }
.diagnostics summary { cursor:pointer; color:var(--muted); font-size:11px; text-transform:uppercase;
                        letter-spacing:.06em; list-style:none; }
.diagnostics summary::-webkit-details-marker { display:none; }
.diagnostics table { border-collapse:collapse; width:100%; margin-bottom:10px; }
.diagnostics td, .diagnostics th { text-align:left; padding:5px 10px 5px 0; border-bottom:1px solid var(--line);
                                    font-size:12px; }
.diagnostics th { color:var(--muted); font-weight:500; }
.diagnostics ul { margin:0 0 10px; padding-left:18px; color:var(--muted); font-size:12px; }

a { color:var(--blue); }
.red { color:var(--red); }
.green { color:var(--green); }
`;
