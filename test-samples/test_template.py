"""
Template-Parser Test v2: Lufthansa Buchungsbestätigung (DE + EN)
Kombiniert Reiseplan (Segmente + Zeiten) mit Buchungsdetails (IATA-Codes).
"""
import sys, re, json, os
sys.stdout.reconfigure(encoding='utf-8')
import extract_msg

# ── Regex-Bausteine ──────────────────────────────────────────────────────────

# Fingerprint: Muss im Body vorhanden sein
FINGERPRINT = ["noti.swiss.com", "Buchungsübersicht"]

# PNR
RE_PNR = re.compile(r'Buchungscode:\s*([A-Z0-9]{5,8})')

# Format A (labeled): Buchungsübersicht mit "Flugnummer / IATA-Code" Labels
#   Datum der Abreise 18.09.2025 Abflugzeit 08:25
#   Flugnummer LH2460
#   IATA-Code des Abflughafens MUC
#   IATA-Code des Ankunftsflughafens HEL
RE_UEBERSICHT_A = re.compile(
    r'Datum der Abreise\s+(\d{2})\.(\d{2})\.(\d{4})\s+Abflugzeit\s+(\d{2}:\d{2})'
    r'(?:.*?Flugnummer\s+([A-Z0-9]{2,3}\s?\d{1,4}))?'   # optional für 1-Stopps-Abschnitt
    r'.*?IATA-Code des Abflughafens\s+([A-Z]{3})'
    r'.*?IATA-Code des Ankunftsflughafens\s+([A-Z]{3})',
    re.DOTALL
)

# Format B (kompakt, Osaka-Stil): "DD.MM.YYYY - HH:MM\n<image>\tLHxxx\n\tIATA\t<image>\tIATA"
RE_UEBERSICHT_B = re.compile(
    r'(\d{2})\.(\d{2})\.(\d{4})\s+-\s+(\d{2}:\d{2})\s*\n'   # date - time
    r'.*?<https?://[^>]+>\s+([A-Z]{2,3}\s?\d{1,4})\s*\n'     # image + flightnumber
    r'\s+([A-Z]{3})\s+<https?://[^>]+>\s+([A-Z]{3})',         # IATA dep + image + IATA arr
    re.DOTALL
)

# Reiseplan-Segment: dep_bullet → arr_bullet → FlightNumber Durchgeführt
# Jedes Segment in Reiseplan endet mit "LHxxx Durchgeführt von:"
RE_REISEPLAN_SEG = re.compile(
    r'(\d{2})\.(\d{2})\.(\d{4})\s+-\s+(\d{2}:\d{2})'   # dep datetime (bullet)
    r'[\s\S]{1,800}?'
    r'(\d{2})\.(\d{2})\.(\d{4})\s+-\s+(\d{2}:\d{2})'   # arr datetime (bullet)
    r'[\s\S]{1,400}?'
    r'([A-Z]{2,3}\s?\d{1,4})\s+Durchgeführt',           # flight number
)

# Buchungsdetails-Block: IATA1 <image> IATA2 + stacked times (dep\narr)
RE_DETAILS_BLOCK = re.compile(
    r'([A-Z]{3})\s+<https?://[^>]+>\s+([A-Z]{3})'       # IATA dep/arr
    r'[\s\S]{1,300}?'
    r'(\d{2}:\d{2})\s*\n\s*(\d{2}:\d{2})',              # dep_time \n arr_time
)

# Aircraft
RE_AIRCRAFT = re.compile(r'(?:Airbus\s[\w\s\-]+?|Boeing\s[\w\-]+?|Embraer\s[\w\-]+?)(?=\*|\s*\n)')


def fingerprint_match(body: str) -> bool:
    return all(p in body for p in FINGERPRINT)


def parse(subject: str, body: str) -> list[dict]:
    if not fingerprint_match(body):
        return []

    pnr = None
    m = RE_PNR.search(body)
    if m:
        pnr = m.group(1)

    flights = []

    # ── Strategy 1: Reiseplan segments (most reliable for all formats) ──────
    reiseplan_idx = body.find('Reiseplan')
    if reiseplan_idx >= 0:
        reiseplan_text = body[reiseplan_idx:]
        for m in RE_REISEPLAN_SEG.finditer(reiseplan_text):
            dep_d, dep_mo, dep_y, dep_t = m.group(1), m.group(2), m.group(3), m.group(4)
            arr_d, arr_mo, arr_y, arr_t = m.group(5), m.group(6), m.group(7), m.group(8)
            fn = m.group(9).replace(' ', '')
            flights.append({
                'flightNumber':  fn,
                'departureTime': f'{dep_y}-{dep_mo}-{dep_d}T{dep_t}',
                'arrivalTime':   f'{arr_y}-{arr_mo}-{arr_d}T{arr_t}',
                'departureCode': None,
                'arrivalCode':   None,
                'pnr':           pnr,
            })

    # ── Strategy 2: Buchungsdetails IATA pairs → match to flights by dep time ──
    for m in RE_DETAILS_BLOCK.finditer(body):
        dep_iata, arr_iata = m.group(1), m.group(2)
        dep_time_hhmm = m.group(3)
        for f in flights:
            if f['departureCode'] is None and f['departureTime'].endswith('T' + dep_time_hhmm):
                f['departureCode'] = dep_iata
                f['arrivalCode']   = arr_iata
                break

    # ── Strategy 3: Buchungsübersicht Format A for missing IATA codes ─────────
    if any(f['departureCode'] is None for f in flights):
        for m in RE_UEBERSICHT_A.finditer(body):
            dep_d, dep_mo, dep_y, dep_t = m.group(1), m.group(2), m.group(3), m.group(4)
            dep_iata, arr_iata = m.group(6), m.group(7)
            dep_dt = f'{dep_y}-{dep_mo}-{dep_d}T{dep_t}'
            for f in flights:
                if f['departureCode'] is None and f['departureTime'] == dep_dt:
                    f['departureCode'] = dep_iata
                    f['arrivalCode']   = arr_iata
                    break

    # ── Strategy 4: Buchungsübersicht Format B (Osaka-style) ─────────────────
    # Used when Reiseplan parsing missed flights (fallback)
    found_fn = {f['flightNumber'] for f in flights}
    for m in RE_UEBERSICHT_B.finditer(body):
        dep_d, dep_mo, dep_y, dep_t = m.group(1), m.group(2), m.group(3), m.group(4)
        fn = m.group(5).replace(' ', '')
        dep_iata, arr_iata = m.group(6), m.group(7)
        if fn not in found_fn:
            flights.append({
                'flightNumber':  fn,
                'departureTime': f'{dep_y}-{dep_mo}-{dep_d}T{dep_t}',
                'arrivalTime':   None,
                'departureCode': dep_iata,
                'arrivalCode':   arr_iata,
                'pnr':           pnr,
            })

    # Sort by departure time
    flights.sort(key=lambda f: f['departureTime'] or '')
    return flights


# ── Test ─────────────────────────────────────────────────────────────────────
emails_dir = os.path.join(os.path.dirname(__file__), 'emails')
with open(os.path.join(emails_dir, 'samples.json'), encoding='utf-8') as f:
    samples = json.load(f)

total_flights = 0
field_hits   = {k: 0 for k in ['flightNumber','departureCode','arrivalCode','departureTime','arrivalTime','pnr']}
field_total  = {k: 0 for k in field_hits}

for sample in samples:
    fname    = sample['filename']
    expected = sample['expected']
    msg      = extract_msg.openMsg(os.path.join(emails_dir, fname))
    got      = parse(msg.subject or '', msg.body or '')

    print(f"\n{'='*62}")
    print(f"  {fname}")
    print(f"  Expected {len(expected)} flights — got {len(got)}")

    for i, exp in enumerate(expected):
        total_flights += 1
        g = got[i] if i < len(got) else {}
        print(f"\n  Flight {i+1}: {exp.get('flightNumber','?')}  {exp.get('departureCode','?')}->{exp.get('arrivalCode','?')}")

        for field in field_hits:
            ev = exp.get(field)
            gv = g.get(field)
            field_total[field] += 1
            ok = '✓' if ev and gv and (ev[:16] == gv[:16] if 'Time' in field else ev == gv) else '✗'
            if ok == '✓':
                field_hits[field] += 1
            print(f"    {ok} {field:16s}  exp={str(ev)!r:26} got={str(gv)!r}")

print(f"\n{'='*62}")
print("SUMMARY")
nf = sum(1 for s in samples for i in range(len(s['expected'])) if i < len(parse('', extract_msg.openMsg(os.path.join(emails_dir, s['filename'])).body or '')))
print(f"  Flights found:   {nf}/{total_flights}")
for field, hits in field_hits.items():
    tot = field_total[field]
    pct = 100 * hits // tot if tot else 0
    bar = '█' * (pct // 10) + '░' * (10 - pct // 10)
    print(f"  {field:16s}  {bar}  {hits:2}/{tot}  ({pct}%)")
