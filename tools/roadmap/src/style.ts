/** Inline CSS for the generated roadmap page — kept out of render.ts so that file stays focused on markup. */
export const STYLE = `
:root { color-scheme: dark; --bg:#12141a; --card:#1b1e26; --line:#2a2e39; --text:#e6e8ee;
        --muted:#8b90a0; --amber:#f0a947; --red:#e0605e; --green:#7bc47f; --blue:#4aa6b0; }
* { box-sizing:border-box; }
body { margin:0; padding:24px; background:var(--bg); color:var(--text);
       font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:15px; margin:28px 0 10px; color:var(--muted);
     text-transform:uppercase; letter-spacing:.08em; }
.meta { color:var(--muted); font-size:12px; margin-bottom:20px; }
.warn { border-left:3px solid var(--amber); background:#241f16; padding:8px 12px; margin:6px 0;
        border-radius:0 4px 4px 0; font-size:13px; }
.decision { border:1px solid var(--line); border-left:3px solid var(--red); background:var(--card);
            padding:12px 14px; border-radius:0 6px 6px 0; margin-bottom:8px; }
.decision.merge { border-left-color:var(--amber); } .decision.triage { border-left-color:var(--blue); }
.decision h3 { margin:0 0 6px; font-size:14px; } .decision ul { margin:0; padding-left:18px; color:var(--muted); }
.tiles { display:flex; flex-wrap:wrap; gap:10px; }
.tile { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px 14px; min-width:150px; }
.tile .v { font-size:16px; font-weight:600; } .tile.bad .v { color:var(--red); }
.tile .r { color:var(--muted); font-size:12px; }
.board { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; }
.col { min-width:260px; flex:0 0 260px; }
.col h3 { margin:0 0 8px; font-size:13px; display:flex; justify-content:space-between; }
.col .n { color:var(--muted); font-weight:400; }
.col .note { color:var(--muted); font-size:12px; margin:0 0 8px; }
.card { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px; margin-bottom:8px; }
.card summary { cursor:pointer; list-style:none; } .card summary::-webkit-details-marker { display:none; }
.card .badges { margin-top:6px; display:flex; gap:6px; flex-wrap:wrap; }
.b { font-size:11px; padding:1px 6px; border-radius:10px; border:1px solid var(--line); color:var(--muted); }
.b.fixed-awaiting-release { border-color:var(--green); color:var(--green); }
.b.blocked { border-color:var(--red); color:var(--red); }
.card .notes { margin-top:8px; padding-top:8px; border-top:1px solid var(--line); color:var(--muted);
               white-space:pre-wrap; font-size:13px; }
.msg { border:1px solid var(--line); background:var(--card); border-radius:6px; padding:10px; margin-bottom:8px; }
.msg .h { color:var(--muted); font-size:12px; margin-bottom:4px; }
.msg .c { white-space:pre-wrap; }
table { border-collapse:collapse; width:100%; } td,th { text-align:left; padding:5px 10px 5px 0;
        border-bottom:1px solid var(--line); font-size:13px; } th { color:var(--muted); font-weight:500; }
a { color:var(--blue); }
`;
