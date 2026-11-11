const R=(k,id,t,v,o={})=>({k,id,t,v,...o});
const sw=(id,t,v,o)=>R("switch",id,t,v,o), seg=(id,t,opt,v,o)=>R("seg",id,t,v??opt[0],{opt,...o}), sel=(id,t,opt,v,o)=>R("select",id,t,v??opt[0],{opt,...o});
const tx=(id,t,v="",o)=>R("text",id,t,v,o), num=(id,t,v,o)=>R("number",id,t,v,o), der=(id,t,v,o)=>R("derived",id,t,v,o), inf=(id,t,v,o)=>R("info",id,t,v,o);
const act=(id,t,btn,o)=>R("action",id,t,"",{btn,...o}), lnk=(id,t,to,btn,o)=>R("link",id,t,"",{to,btn,...o}), lst=(id,t,items,o)=>R("list",id,t,"",{items,...o});
const call=(id,t,o)=>R("callout",id,t,"",o);
const FLIGHTSVC="airlabs.key|my.airlabs.key|aviationstack.key|my.aviationstack.key|aerodatabox.key|my.aerodatabox.key|aeroapi.key";
const AIANY="ai&openai.key|ai&anthropic.key|ai&gemini.key|ai&ollama.url|ai&custom.url|ai&my.openai.key|ai&my.anthropic.key|ai&my.gemini.key";
const KINDS=[["flights","Flüge","#f0a947"],["cruises","Kreuzfahrten","#4aa6b0"],["hotels","Unterkünfte","#5ec2b2"],["trains","Bahn","#a597e8"],["bus","Bus","#c28a5a"],["ferry","Fähre","#5aa0c2"],["rental","Mietwagen","#b0b05a"],["places","Orte","#e08caa"],["tours","Touren","#86ad70"],["roadtrips","Roadtrips","#7fa9d3"]];
const CUR=["EUR","USD","GBP","CHF"];
const P=(id,area,t,d,ico,rows,o={})=>({id,area,t,d,ico,rows,...o});

const PAGES=[
/* ===== Mein Konto ===== */
P("profil","konto","Profil & Anmeldung","Dein Profil, deine Anmeldung und wer dich finden kann.","account",[
 act("avatar","Profilbild","Datei wählen",{g:"Persönliche Angaben",s:"PNG oder JPG, bis 5 MB"}),
 tx("vorname","Vorname","Mara",{g:"Persönliche Angaben"}), tx("nachname","Nachname","Ostend",{g:"Persönliche Angaben"}),
 der("anzeige","Anzeigename","Mara Ostend",{g:"Persönliche Angaben",s:"Wie dich Freunde sehen"}),
 inf("benutzer","Benutzername","mara",{g:"Persönliche Angaben",s:"Zum Anmelden, bleibt fest"}),
 tx("email","E-Mail","mara@example.org",{g:"Persönliche Angaben",s:"Für ein neues Passwort"}),
 R("date","pass","Reisepass gültig bis","",{g:"Persönliche Angaben",s:"Die Companion-App warnt 6 Monate vorher"}),
 R("date","geburtstag","Geburtstag","",{g:"Persönliche Angaben",x:1,s:"Optional",h:"Schaltet den Erfolg „Geburtstagsflug“ frei."}),
 act("password","Passwort","Ändern",{g:"Anmeldung & Sicherheit",res:"Passwort geändert"}),
 sw("twofa","Zwei-Faktor-Anmeldung",false,{g:"Anmeldung & Sicherheit",s:"Code aus einer Authenticator-App zusätzlich zum Passwort",h:"API-Schlüssel umgehen den zweiten Faktor. Ein Passkey ersetzt Passwort und zweiten Faktor."}),
 act("codes","Ersatzcodes","Neu erzeugen",{g:"Anmeldung & Sicherheit",s:"Falls das Telefon fehlt",need:"twofa",needMsg:"Erst mit Zwei-Faktor-Anmeldung.",dlg:"codesnew",res:"10 neue Codes · nur jetzt sichtbar"}),
 lst("passkeys","Passkeys",[{a:"iPad",b:"seit 12.08.2026"}],{g:"Anmeldung & Sicherheit",s:"Anmelden ohne Passwort",btn:"Passkey hinzufügen",add:[["Name des Geräts","text"]],rm:1,h:"Ein Passkey ersetzt Passwort und zweiten Faktor. Er gilt nur unter der Adresse, unter der du ihn angelegt hast."}),
 lst("tokens","API-Schlüssel",[{a:"Heimserver-Skript",b:"lesen · seit 02.10.2026"}],{g:"Anmeldung & Sicherheit",x:1,s:"Für Skripte und Werkzeuge",btn:"Neuer Schlüssel",add:[["Name","text"]],acts:[["Zurückziehen","tokenrevoke",1]],rmOnAct:1,h:"Ein Schlüssel umgeht den zweiten Faktor. Du siehst ihn nur beim Anlegen."}),
 sw("findable","Für andere Server auffindbar",false,{g:"Sichtbarkeit",s:"Menschen auf verbundenen Servern dürfen dir eine Freundschaftsanfrage schicken",need:"fed",needMsg:"Der Admin hat andere Server nicht freigegeben."}),
 act("delete","Konto löschen","Konto löschen",{g:"Konto verwalten",s:"Mit allen Einträgen, Fotos und Dateien",danger:1,dlg:"deleteacct"})]),
P("anzeige","konto","Anzeige","Sprache, Zeit und Einheiten.","display",[
 seg("lang","Sprache",["Deutsch","English"],"Deutsch",{g:"Sprache & Region"}),
 der("tz","Zeitzone","Europe/Berlin (vom Gerät)",{g:"Sprache & Region",s:"Für Ortszeiten und Tageswerte"}),
 sel("datefmt","Datumsformat",["08.11.2026","2026-11-08","11/08/2026"],0,{g:"Datum & Uhrzeit",s:"Tabellen zeigen immer 2026-11-08"}), seg("timefmt","Uhrzeit",["24 h","12 h"],0,{g:"Datum & Uhrzeit"}),
 seg("dist","Entfernungen",["km","mi","sm"],0,{g:"Einheiten & Währung"}), seg("weight","Gepäck",["kg","lb"],0,{g:"Einheiten & Währung",s:"Für Freigepäck ohne Einheit",h:"Rechnet nichts um."}),
 sel("cur","Anzeigewährung",CUR,0,{g:"Einheiten & Währung",s:"Wie Beträge angezeigt werden"}),
 sel("basecur","Basiswährung für Summen",CUR,0,{g:"Einheiten & Währung",x:1,s:"Alle Kosten werden für Summen in diese Währung umgerechnet",h:"Schon umgerechnete Beträge behalten ihren Wert. Kurse der EZB ab 1999."})]),
P("reisearten","konto","Reisearten","Dein Logbuch, deine Reisearten. Aktiviere, was zu dir passt.","domains",[
 ...KINDS.map(([id,t,c],i)=>sw("d_"+id,t,i<3,{g:"Deine Reisearten",dot:c,beta:id==="tours"||id==="roadtrips"?1:0})),
 act("farbenreset","Farben zurücksetzen","Zurücksetzen",{g:"Deine Reisearten",x:1,s:"Die Karte hat eigene Farben und bleibt, wie sie ist.",res:"Farben zurückgesetzt"}),
 sel("country","Ein Land zählt ab",["Wie der Server","Bei Aufenthalt","Besucht","Durchreist","Auch beim Umsteigen"],0,{g:"Länder & Zuhause",s:"Server-Standard: Auch beim Umsteigen",h:"Bei Aufenthalt: mindestens eine Nacht. Besucht: ein Ort dort. Durchreist: am Boden gewesen. Auch beim Umsteigen: auch nur beim Umsteigen."}),
 lst("home","Heimatort",[{a:"Leipzig",b:"seit 03/2021"},{a:"Halle",b:"2016–2021"}],{g:"Länder & Zuhause",s:"Von hier misst TravStats Entfernungen",btn:"Umgezogen",add:[["Ab Datum","date"],["Ort","text"]],fmt:v=>v[1],fmtb:v=>"ab "+v[0],h:"Ein Umzug beginnt einen neuen Zeitraum, nichts wird überschrieben. Alte Reisen zählen gegen den Wohnort ihres Tages. Der aktuelle Heimatort ist auch dein Zuhause in der Companion-App."}),
 lst("homeair","Heimatflughäfen",[{a:"LEJ",b:"Standard"},{a:"BER",b:""}],{g:"Länder & Zuhause",s:"Bis zu drei, einer als Standard",btn:"Flughafen hinzufügen",add:[["Ab Datum","date"],["IATA-Code","text"]],fmt:v=>v[1].toUpperCase(),fmtb:v=>"ab "+v[0],rm:1,h:"Sie gehören zum aktuellen Wohnort. Ziehst du um, bleiben die alten mit ihrem Zeitraum."}),
 der("heimatland","Heimatland","Deutschland (aus dem Heimatort)",{g:"Länder & Zuhause",x:1,s:"Buchungsvorlagen von hier zuerst"})]),
P("reisen","konto","Reisen & Vorschläge","Weniger sortieren, mehr Erinnerungen sammeln.","trips",[
 sw("autotrip","Reisen automatisch anlegen",true,{g:"Reisen",s:"Gleiche Buchungsnummer, eine Reise"}),
 sw("tripsug","Reisen vorschlagen",true,{g:"Reisen",s:"Aus Flügen und Unterkünften, die zusammengehören",h:"Aus: Es wird nichts mehr berechnet. Deine Entscheidungen bleiben."}),
 sel("color","Farbe neuer Reisen",["Automatisch","Bernstein","Türkis","Mint","Violett","Rosa","Blau"],0,{g:"Reisen",x:1}),
 inf("offenevor","Offene Vorschläge","4 im Posteingang",{g:"Posteingang",tone:"good"}),
 act("ics","Kalender-Abo","Link erstellen",{g:"Kalender",beta:1,s:"Deine Reisen in jeder Kalender-App",need:"puburl",needMsg:"Dem Server fehlt eine öffentliche Adresse.",dlg:"icsnew",res:"Link erstellt · nur jetzt sichtbar",h:"Den Link siehst du nur beim Erstellen. Neu erzeugen beendet alte Abos. Google Kalender braucht eine öffentliche Adresse des Servers."})]),
P("fluege","konto","Flüge","Aktuelle Flugdaten und passende Voreinstellungen.","flight",[
 sw("live","Live-Updates",true,{g:"Live-Updates",s:"Ab 24 h vor Abflug bis zur Landung alle 15 Minuten: Verspätung, Gate, Annullierung",need:FLIGHTSVC,needMsg:"Braucht einen Flugdaten-Dienst.",needTo:"dienstek",needBtn:"Zu Dienste"}),
 sw("approve","Änderungen erst bestätigen",true,{g:"Live-Updates",when:"live"}),
 inf("offen","Offene Änderungen","2 offen, im Posteingang",{g:"Live-Updates",when:"live",tone:"warn"}),
 num("expiry","Offene Änderungen verfallen nach",24,{g:"Live-Updates",x:1,u:"h",when:"live",s:"1 bis 168 Stunden"}),
 sw("costs","Steuern und Gebühren erfassen",true,{g:"Was festgehalten wird",s:"Auch Geschäftsreise-Summen",h:"Preis und Währung gibt es immer."}),
 sw("flugweg","Flugweg vom Telefon",true,{g:"Was festgehalten wird",s:"Die Companion-App zeichnet ihn auf",h:"Aus: Der Server nimmt keine Flugwege mehr an."}),
 sw("kennz","Kennzeichen der Maschine",true,{g:"Was festgehalten wird",x:1,h:"Aus: nur Flugzeugtypen, keine einzelnen Maschinen."}),
 sw("enrich","Ältere Flüge ergänzen",false,{g:"Ältere Flüge",x:1,s:"Aus Live-Flügen mit derselben Nummer",h:"Es entstehen nur Vorschläge im Posteingang."}),
 num("enrichconf","Mindestübereinstimmung",60,{g:"Ältere Flüge",x:1,u:"%",when:"enrich"}), num("enrichmax","Vorschläge pro Nacht",50,{g:"Ältere Flüge",x:1,u:"/ Nacht",when:"enrich"}),
 inf("enrichcand","Passende Flüge","12 lassen sich ergänzen",{g:"Ältere Flüge",x:1,when:"enrich"}),
 sel("fklasse","Klasse",["keine","Economy","Premium Economy","Business","First"],0,{g:"Neue Flüge starten mit",x:1}),
 tx("fairline","Airline","",{g:"Neue Flüge starten mit",x:1}),
 sel("fanlass","Anlass",["keiner","Geschäftlich","Privat","Urlaub"],0,{g:"Neue Flüge starten mit",x:1,s:"Nur für Statistiken"})],{when:"d_flights"}),
P("kreuzfahrten","konto","Kreuzfahrten","Voreinstellungen und Zählweise.","cruise",[
 tx("klinie","Reederei","",{g:"Neue Kreuzfahrten starten mit",x:1}), sel("kkabine","Kabine",["keine","Innen","Meerblick","Balkon","Suite"],0,{g:"Neue Kreuzfahrten starten mit",x:1}),
 sw("seetage","Seetage als Reisetage",true,{g:"Zählen",x:1,h:"Die Zahl der Seetage bleibt sichtbar."})],{when:"d_cruises",x:1}),
P("treue","konto","Treueprogramme","Karten, die TravStats Flügen, Hotels und Fahrten zuordnet.","loyalty",[
 lst("tr_flights","Airlines",[{a:"Miles & More",b:"•••• 4821 · Frequent Traveller"}],{g:"Karten",btn:"Karte hinzufügen",add:[["Programm","text"],["Nummer","text"]],fmt:v=>v[0],fmtb:v=>"•••• "+v[1].slice(-4),rm:1,s:"Vorschläge aus deinen Flügen erscheinen hier zum Übernehmen."}),
 lst("tr_hotels","Hotels",[],{g:"Karten",when:"d_hotels",btn:"Karte hinzufügen",add:[["Programm","text"],["Nummer","text"]],fmt:v=>v[0],fmtb:v=>"•••• "+v[1].slice(-4),rm:1,s:"Ketten und einzelne Häuser"}),
 lst("tr_trains","Bahn",[],{g:"Karten",when:"d_trains",btn:"Karte hinzufügen",add:[["Programm","text"],["Nummer","text"]],fmt:v=>v[0],fmtb:v=>"•••• "+v[1].slice(-4),rm:1}),
 lst("tr_cruises","Reedereien",[],{g:"Karten",when:"d_cruises",btn:"Karte hinzufügen",add:[["Programm","text"],["Nummer","text"]],fmt:v=>v[0],fmtb:v=>"•••• "+v[1].slice(-4),rm:1})]),
P("erinnerungen","konto","Erinnerungen","Rechtzeitig Bescheid wissen, bevor es losgeht.","notifications",[
 der("remaddr","Erinnerungen an","= Profil-E-Mail",{g:"Wohin",s:"Leer: keine Mails"}),
 seg("rchan","Kanal",["App","Mail","Beides"],"Beides",{g:"Wohin"}),
 inf("pushstate","Mitteilungen an die App","1 Telefon bereit",{g:"Wohin",tone:"good",need:"push",needMsg:"Der Server sendet gerade keine Mitteilungen an die App.",s:"Bereit, sobald ein gekoppeltes Telefon Mitteilungen erlaubt."}),
 ...[["flights","Flug"],["cruises","Kreuzfahrt"],["hotels","Unterkunft"],["trains","Bahn"],["bus","Bus"],["ferry","Fähre"],["rental","Mietwagen"],["roadtrips","Roadtrip"]].map(([id,t])=>sel("rem_"+id,t,["Aus","2 h","24 h","2 Tage"],"24 h",{g:"Vor der Abreise",when:"d_"+id,s:"Erinnerung vor Abreise"}))]),
P("freunde","konto","Freunde & Teilen","Reisen verbinden. Du entscheidest, mit wem du teilst.","sharing",[
 lst("friends","Freunde",[{a:"jonas",b:"teilt Reisen und Pläne · verbunden seit 03.2026"}],{g:"Freunde",btn:"Freund hinzufügen",add:[["Benutzername oder Adresse","text"]],fmt:v=>v[0],fmtb:()=>"Anfrage gesendet",acts:[["Trennen","shareend",1]],rmOnAct:1,s:"Vergleich, geteilte Reisen und Pläne laufen über eine Verbindung pro Freund.",h:"Zurückziehen beendet das Abgleichen. Schon Geteiltes bleibt als eigene Kopie."}),
 lst("personen","Mitreisende",[{a:"Jonas",b:"14 Einträge"},{a:"Ilka",b:"3 Einträge"}],{g:"Mitreisende",s:"Personen in deinen Einträgen, auch ohne Konto",acts:[["Zusammenführen","merge"]],h:"Zusammenführen ändert jeden Eintrag mit dieser Person und lässt sich nicht zurücknehmen."}),
 act("unused","Unbenutzte Personen löschen","Löschen",{g:"Mitreisende",dlg:"unused",res:"Aufgeräumt"}),
 call("linksoff","Öffentliche Links sind auf diesem Server aus. Der Admin kann sie erlauben.",{g:"Öffentliche Links",when:"!links"}),
 lst("linkliste","Deine Links",[{a:"Reise · Lissabon",b:"noch 6 Tage · 41 Aufrufe"}],{g:"Öffentliche Links",when:"links",s:"Erstellt an Flug, Reise oder Jahr",acts:[["Widerrufen","linksoff",1]],rmOnAct:1}),
 act("rangliste","Rangliste","Öffnen",{g:"Vergleichen & übergeben",beta:1,s:"Wer deine Summen sieht"}),
 act("verschl","Verschlüsselt übergeben","Öffnen",{g:"Vergleichen & übergeben",beta:1,s:"Ganze Einträge an ein anderes Konto"})]),
P("telefone","konto","Telefone","Deine gekoppelten Telefone auf einen Blick.","account",[
 lst("phones","Gekoppelte Telefone",[{a:"iPhone von Mara",b:"zuletzt heute, 09:41"}],{g:"Telefone",acts:[["Abmelden","deviceout",1]],rmOnAct:1,h:"Der Kopplungscode verfällt nach wenigen Minuten. Abmelden nimmt dem Telefon sofort den Zugang."}),
 act("pair","Telefon koppeln","Code anzeigen",{g:"Telefone",dlg:"pairqr",s:"Zeigt einen QR-Code für die Companion-App"}),
 inf("pushstate2","Mitteilungen","1 Telefon bereit",{g:"Mitteilungen",tone:"good",need:"push",needMsg:"Der Server sendet gerade keine Mitteilungen an die App."})]),
P("dienstek","konto","Verbundene Dienste","Deine Verbindungen. Deine Daten. Deine Entscheidung.","services",[],{svcPage:1}),
P("daten","konto","Daten","Deine Reisegeschichte gehört dir.","data",[
 inf("srvbackup","Letzte Sicherung des Servers","heute 02:00 · 1,2 GB",{g:"Sicherung",tone:"good",s:"Darum kümmert sich der Admin"}),
 sw("webdaveigen","Eigene Kopie auf WebDAV",false,{g:"Sicherung",s:"Dein Export, regelmäßig",need:"webdav.url|my.webdav.url",needMsg:"Noch kein WebDAV-Speicher verbunden.",needTo:"dienstek",needBtn:"Verbinden"}),
 seg("webdavtakt","Wie oft",["täglich","wöchentlich"],"wöchentlich",{g:"Sicherung",x:1,when:"webdaveigen"}), num("webdavvers","Versionen behalten",7,{g:"Sicherung",x:1,when:"webdaveigen",s:"1–30"}),
 inf("webdavlast","Letzte eigene Kopie","gestern 03:12 · erfolgreich",{g:"Sicherung",when:"webdaveigen",tone:"good"}),
 act("meine","Alle meine Daten","Herunterladen",{g:"Mitnehmen",s:"JSON, ohne Passwörter und Schlüssel",res:"Fertig · Herunterladen",h:"Fotos und Dokumente sind nicht dabei."}),
 act("excelexp","Excel-Tabelle","Erstellen",{g:"Mitnehmen",s:"Ein Blatt pro Reiseart",res:"Fertig · Herunterladen"}),
 act("gpxzip","Aufzeichnungen","Herunterladen",{g:"Mitnehmen",when:"d_tours|d_roadtrips",s:"Alle Touren als GPX im ZIP",res:"Fertig · Herunterladen"}),
 act("listen","Listen importieren","Datei wählen",{g:"Einlesen",s:"CSV, Flightradar24, andere Apps"}),
 act("excelimp","Excel-Tabelle einlesen","Datei wählen",{g:"Einlesen",s:"Mit Vorschau",dlg:"replace",h:"Hinzufügen, Abgleichen oder Ersetzen. Ersetzen löscht, was in der Datei fehlt. Vorher lege ich eine Sicherung des ganzen Servers an."}),
 act("gpxin","Aufzeichnungen einlesen","Dateien wählen",{g:"Einlesen",when:"d_tours|d_roadtrips",s:"GPX, TCX, FIT oder ZIP",h:"ZIP bis 500 Dateien und 200 MB, eine Aufzeichnung bis 15 MB."}),
 lst("implog","Bisherige Importe",[{a:"flugdaten.csv",b:"21.10.2026 · 48 Flüge"}],{g:"Einlesen",s:"Ganz zurücknehmen",acts:[["Zurücknehmen","impundo",1]],rmOnAct:1,h:"Einträge, auf die schon anderes verweist, bleiben; ich sage, welche."}),
 seg("ubahn","U-Bahn und Tram beim Bahn-Import",["Überspringen","Importieren"],0,{g:"Beim Import von bahn.de",x:1,when:"d_trains"}),
 seg("busleg","Busabschnitte beim Bahn-Import",["Überspringen","Importieren"],0,{g:"Beim Import von bahn.de",x:1,when:"d_trains"})]),
P("ueber","konto","Über TravStats","Version und Herkunft.","about",[
 inf("ver","Version","2.8.0",{g:"Version"}), inf("build","Build","2.8.0-rc28+4f1c",{g:"Version",x:1}),
 act("changelog","Changelog","Öffnen",{g:"Mehr"}), act("docs","Dokumentation","Öffnen",{g:"Mehr"})],{credit:1}),

/* ===== TravTrack ===== */
P("tt-aufz","track","Aufzeichnung & Orte","Wo du warst, bleibt auf deinem Server.","travtrack",[
 sel("quelle","Standort kommt von",["Keine","TravTrack","Dawarich"],"TravTrack",{g:"Quelle",s:"Für Ländertage, Aufenthalte, Routen",h:"Umschalten verschiebt und löscht nichts. TravTrack speichert auf diesem Server. Dawarich geht nur mit deiner eigenen Dawarich-Verbindung."}),
 sw("aufz","Reisen aufzeichnen",true,{g:"Quelle",s:"Positionen aus der Companion-App",when:"quelle=TravTrack",h:"Aus: Der Server nimmt keine neuen Positionen an. Gespeicherte bleiben."}),
 lnk("dawlink","Deine Dawarich-Verbindung","dienstek","Verbindung öffnen",{g:"Quelle",when:"quelle=Dawarich",need:"my.dawarich.key",needMsg:"Dawarich ist für dich noch nicht verbunden. Bis dahin liest TravStats keine Positionen.",needTo:"dienstek",needBtn:"Verbinden"}),
 lnk("geraete","Geräte","telefone","Telefone",{g:"Quelle",s:"Koppeln und abmelden"}),
 lst("orte","Feste Orte",[{a:"Zuhause",b:"150 m · aus deinem Heimatort"},{a:"Arbeit",b:"200 m · Mo–Fr 08–18 Uhr"}],{g:"Feste Orte",btn:"Ort hinzufügen",add:[["Name","text"],["Radius in Metern","number"]],fmt:v=>v[0],fmtb:v=>v[1]+" m",rm:1,s:"Zuhause, Arbeit und andere Orte",h:"Alles innerhalb des Radius erscheint auf der Karte als ein Stopp mit dem Namen des Orts. Die einzelnen Punkte bleiben gespeichert."}),
 sw("unterkunft","Unterkunft während der Buchung",false,{g:"Feste Orte",x:1,s:"Von Check-in bis Check-out zählt das Hotel als fester Ort",h:"Buchungen ohne Koordinaten werden übersprungen."}),
 lst("zonen","Schutzzonen",[{a:"Zuhause",b:"250 m"},{a:"Büro",b:"100 m"}],{g:"Schutzzonen",btn:"Zone hinzufügen",add:[["Name","text"],["Radius in Metern","number"]],fmt:v=>v[0],fmtb:v=>v[1]+" m",rm:1,s:"Hier wird nichts gespeichert",h:"Eine neue Zone löscht Punkte, die schon darin liegen; vorher siehst du, wie viele. Entfernen holt nichts zurück."})],
 {when:"offer_tt",stats:[["Gespeichert","18.204 Punkte","seit 03/2025 · 2 Telefone"],["Zuletzt eingegangen","heute 10:12","von iPhone von Mara"]]}),
P("tt-erk","track","Erkennung & Vorschläge","Aus Punkten werden Aufenthalte und Orte.","travtrack",[
 sw("staysug","Aufenthalte vorschlagen",true,{g:"Aufenthalte",s:"Aus deinem Standortverlauf",need:"hasloc",needMsg:"Wirkt erst mit einer Standortquelle.",needTo:"tt-aufz",needBtn:"Quelle wählen"}),
 sw("stopps","Stopps benennen",true,{g:"Aufenthalte",s:"Namen von Läden, Firmen und Hotels in der Nähe vorschlagen",h:"Aus: der Posteingang bietet keine Aufenthaltsvorschläge an."}),
 sw("scan","Automatisch suchen",false,{g:"Suchlauf",s:"Alle 6 Stunden, auch Märkte, Parks, Museen",need:"hasloc",needMsg:"Wirkt erst mit einer Standortquelle.",needTo:"tt-aufz",needBtn:"Quelle wählen",h:"Funde landen als Vorschlag im Posteingang. Pausiert, solange Aufenthaltsvorschläge aus sind."}),
 inf("scaninfo","Letzter Suchlauf","heute 03:00 · 2 neue Vorschläge",{g:"Suchlauf",tone:"good"}),
 act("scanjetzt","Jetzt suchen","Jetzt suchen",{g:"Suchlauf",need:"hasloc",needMsg:"Wirkt erst mit einer Standortquelle.",res:"Gestartet · Ergebnis im Posteingang"}),
 sw("photoev","Fotos als Beleg nutzen",true,{g:"Belege",s:"Immich-Fotos zu einem Aufenthalt",need:"immich.key|my.immich.key",needMsg:"Immich ist nicht verbunden.",needTo:"dienstek",needBtn:"Verbinden"}),
 sw("staedte","Städte benennen",false,{g:"Feinabstimmung",x:1,s:"Orte ab 30 Minuten",h:"Sendet auf 1 km gerundete Positionen an die Ortssuche des Servers. Aus entfernt die Städte wieder."}),
 sw("aiplace","Ortsart per KI erkennen",false,{g:"Feinabstimmung",x:1,s:"Nur Ortsnamen, keine Koordinaten",need:AIANY,needMsg:"Der Admin hat keine KI freigegeben.",needTo:"dienstek"}),
 sel("scanzeit","Zeitraum für „Jetzt suchen“",["7 Tage","14 Tage","30 Tage"],0,{g:"Feinabstimmung",x:1}),
 sw("gelaende","Märkte, Parks und Museen mitsuchen",true,{g:"Feinabstimmung",x:1})],{when:"offer_tt"}),
P("tt-daten","track","Daten & Quellen","Importieren, mitnehmen, löschen.","travtrack",[
 act("dawcopy","Aus Dawarich übernehmen","Übernehmen",{g:"Quellen",s:"Ganz oder ein Zeitraum",need:"my.dawarich.key",needMsg:"Braucht deine eigene Dawarich-Verbindung. Die des Servers reicht dafür nicht.",needTo:"dienstek",needBtn:"Verbinden",res:"Gestartet · lässt sich anhalten"}),
 inf("dawimp","Letzte Übernahme","Fertig am 24. Okt · 1,2 Mio. Punkte · 3 Lücken",{g:"Quellen",tone:"good"}),
 act("gpxtrack","Dateien importieren","Dateien wählen",{g:"Quellen",s:"GPX, GeoJSON, KML, TCX, Google-Takeout"}),
 lst("ttimp","Bisherige Importe",[{a:"takeout-2025.zip",b:"640.112 Punkte"},{a:"wanderung.gpx",b:"4.210 Punkte"}],{g:"Quellen",acts:[["Entfernen","impundo",1]],rmOnAct:1}),
 lst("apps","Weitere Apps",[{a:"OwnTracks · Pixel",b:"seit 14.09.2026"}],{g:"Quellen",x:1,s:"OwnTracks und Overland",btn:"Schlüssel erstellen",add:[["Name der App","text"]],rm:1,h:"Diese Apps kennen deine Schutzzonen nicht; der Server verwirft Punkte darin. Den Schlüssel siehst du nur einmal."}),
 act("ttexport","Verlauf exportieren","Exportieren",{g:"Export",s:"GPX oder JSON, Schutzzonen sind nie enthalten",res:"Fertig · Herunterladen",h:"Zeitraum, Anzahl der Punkte und Zeitzone siehst du vor dem Herunterladen."}),
 act("ttdel","Zeitraum löschen","Tage löschen",{g:"Löschen",s:"Löscht alle Standortpunkte im Zeitraum endgültig, auch die aus Importen",danger:1,dlg:"ttdel",h:"Gelöschte Tage bleiben gelöscht, auch wenn ein Telefon sie später nachreicht. Logbuch-Einträge bleiben unberührt."}),
 act("diag","Diagnose","Öffnen",{g:"Diagnose",x:1,s:"Warum Punkte fehlen",h:"Braucht das Diagnose-Protokoll in der Companion-App."})],{when:"offer_tt"}),
P("tt-bereit","track","Bereitstellung","Ob dieser Server TravTrack anbietet.","server",[
 sw("offer_tt","TravTrack anbieten",true,{g:"TravTrack",s:"Aus: Die Seiten verschwinden für alle Konten. Gespeicherte Punkte bleiben."}),
 inf("tt_all","Gespeichert auf dem Server","24.511 Punkte · 3 Konten",{g:"TravTrack",tone:"good"})],{srv:1}),

/* ===== TravPlan ===== */
P("pl-plan","plan","Reisen planen","Ideen und Pläne vor der Reise.","trips",[
 sw("travplan","Reisen planen",false,{g:"Planen",s:"Ideen und Pläne vor der Reise",h:"Ausschalten behält deine Pläne."}),
 sw("planai","KI-Vorschläge in Plänen",true,{g:"Planen",when:"travplan",need:AIANY,needMsg:"Der Admin hat keine KI freigegeben.",needTo:"dienstek"}),
 sw("planwx","Wetter in Plänen",true,{g:"Planen",when:"travplan"}),
 lnk("planshare","Pläne mit Freunden teilen","freunde","Freunde",{g:"Planen",when:"travplan",s:"Läuft über die Verbindung zu jedem Freund"})],
 {when:"offer_plan",stats:[["KI-Anfragen heute","3 von 10",""],["Wetter-Anfragen heute","5 von 20",""]]}),
P("pl-bereit","plan","Bereitstellung","Ob dieser Server Planen anbietet und wie viel.","server",[
 sw("offer_plan","Reisen planen anbieten",true,{g:"TravPlan",s:"Aus: Die Seiten verschwinden für alle Konten. Pläne bleiben gespeichert."}),
 num("pl_ai","KI-Anfragen je Konto und Tag",10,{g:"Grenzen",x:1,when:"offer_plan"}), num("pl_wx","Wetter-Anfragen je Konto und Tag",20,{g:"Grenzen",x:1,when:"offer_plan"})],{srv:1}),

/* ===== Server ===== */
P("allgemein","server","Allgemein","Die wichtigsten Einstellungen für deinen Server.","server",[
 tx("instname","Servername","TravStats",{g:"Dein Server",s:"In Mails und Sicherungen"}),
 tx("puburl","Öffentliche Adresse","https://trav.example.org",{g:"Dein Server",s:"Daraus werden alle anderen Adressen abgeleitet"}),
 call("puburlw","Fehlt noch. Bis dahin zeigen Einladungen, Mails und Kalender auf localhost.",{g:"Dein Server",when:"!puburl",tone:"warn"}),
 seg("reg","Registrierung",["Nur mit Einladung","Offen"],0,{g:"Zugang & Konten"}), num("maxusers","Höchstzahl Konten",10,{g:"Zugang & Konten"}),
 act("loginimg","Bilder der Anmeldeseite","Ändern",{g:"Zugang & Konten",x:1})]),
P("nutzer","server","Nutzer","Konten und Einladungen.","users",[
 lst("nutzerliste","Konten",[{a:"mara",b:"Admin · Zwei-Faktor an · zuletzt heute"},{a:"jonas",b:"Nutzer · Zwei-Faktor aus · zuletzt vor 3 Tagen"}],{g:"Konten",acts:[["Passwort zurücksetzen","userpw"],["Zwei-Faktor zurücksetzen","user2fa"],["Sperren","userlock"],["Löschen","userdel",1]]}),
 lst("einlliste","Einladungen",[{a:"ilka@example.org",b:"gilt noch 6 Tage"}],{g:"Einladungen",s:"Ein Link gilt einmal und 7 Tage",btn:"Einladung erstellen",add:[["E-Mail-Adresse","text"]],fmt:v=>v[0],fmtb:()=>"gilt 7 Tage",acts:[["Zurückziehen","invrevoke",1]],rmOnAct:1})]),
P("funktionen","server","Funktionen","Lege fest, was auf diesem Server möglich ist.","domains",[
 sw("internet","Server darf externe Dienste abfragen",true,{g:"Netz",s:"Wechselkurse, Bahnfahrpläne, Logos, Offene Kartendaten und die Suche nach Updates. Aus = Betrieb ohne Internet"}),
 sw("links","Öffentliche Links erlauben",false,{g:"Teilen",h:"Ausschalten zieht sofort alle Links aller Konten zurück."}),
 sw("fed","Mit anderen Servern verbinden",false,{g:"Teilen",s:"Freunde auf anderen TravStats-Servern; jeder neue Server braucht deine Freigabe"}),
 lnk("l_tt","TravTrack","tt-bereit","Bereitstellung",{g:"Bereiche",s:"Anbieten und Grenzen"}), lnk("l_pl","TravPlan","pl-bereit","Bereitstellung",{g:"Bereiche",s:"Anbieten und Grenzen"}),
 sw("beta","Beta-Funktionen zeigen",false,{g:"Erweitert",x:1}),
 sel("countrydef","Standard: wann zählt ein Land",["Auch beim Umsteigen","Bei Aufenthalt","Besucht","Durchreist"],0,{g:"Erweitert",x:1,s:"Konten können abweichen"}),
 sel("importmodus","Großer Import",["Normal","Grenzen für 24 h aufheben"],0,{g:"Erweitert",x:1})]),
P("email","server","E-Mail","Damit Einladungen und Erinnerungen ankommen.","notifications",[
 tx("smtphost","Mailserver","smtp.example.org",{g:"Mailserver"}), tx("smtpuser","Benutzer","travstats",{g:"Mailserver"}), R("secret","smtppw","Passwort","demo-passwort",{g:"Mailserver"}),
 tx("smtpfrom","Absenderadresse","reisen@example.org",{g:"Mailserver"}),
 act("smtptest","Testmail senden","Testmail senden",{g:"Mailserver",res:"Gesendet · gerade eben"}),
 inf("mailstat","Letzte Testmail","gestern 18:20 · zugestellt",{g:"Mailserver",tone:"good"}),
 der("smtpport","Port und Verschlüsselung","587, STARTTLS (erkannt)",{g:"Erweitert",x:1}), der("smtpname","Absendername","= Servername",{g:"Erweitert",x:1}),
 act("smtpdel","Mailserver entfernen","Entfernen",{g:"Erweitert",x:1,danger:1,dlg:"smtpdel"})]),
P("buchungen","server","Buchungen lesen","Aus Buchungsbestätigungen werden Reiseeinträge.","data",[
 inf("builtin","Bekannte Vorlagen","41 Anbieter · immer dabei",{g:"Lesen",tone:"good"}),
 sw("ai","KI zum Lesen von Buchungen",true,{g:"Lesen",s:"Ohne KI werden nur bekannte Vorlagen erkannt",h:"Was hingeht: der Text einer Mail oder PDF, höchstens 12.000 Zeichen, nur wenn die Vorlagen nichts finden."}),
 seg("order","Reihenfolge",["Vorlagen zuerst","KI zuerst"],0,{g:"Lesen",x:1,when:"ai"}),
 lst("cloudorder","Reihenfolge der KI-Anbieter",[{a:"OpenAI"},{a:"Anthropic"},{a:"Google"},{a:"Eigener"}],{g:"Lesen",x:1,when:"ai",ord:1,s:"Ollama kommt immer zuerst"}),
 sw("userkeys","Konten dürfen eigene Schlüssel nutzen",true,{g:"Lesen",x:1})]),
P("dienste","server","Dienste","Verbinde die Dienste, die deinen Server weiterbringen.","services",[],{svcPage:1}),
P("sicherungen","server","Sicherungen","Deine Reisegeschichte. Gut aufgehoben.","backups",[
 inf("baknow","Automatisch","wöchentlich · 30 Tage aufbewahrt",{g:"Sicherung",tone:"good"}),
 act("backupnow","Jetzt sichern","Jetzt sichern",{g:"Sicherung",res:"Gesichert · gerade eben"}),
 lst("bakliste","Vorhandene Sicherungen",[{a:"heute 02:00",b:"1,2 GB"},{a:"01.11.2026 02:00",b:"1,2 GB"},{a:"25.10.2026 02:00",b:"1,1 GB"}],{g:"Sicherung",acts:[["Wiederherstellen","restore"],["Löschen","bakdel",1]],rmOnAct:0}),
 act("bakwdload","Sicherungen von WebDAV holen","Holen",{g:"Sicherung",s:"Nach einem Umzug",need:"webdav.url",needMsg:"Noch kein WebDAV-Speicher verbunden.",needTo:"dienste",needBtn:"Verbinden"}),
 sel("interval","Intervall",["täglich","wöchentlich","monatlich"],"wöchentlich",{g:"Erweitert",x:1,s:"Um 02:00"}), num("retention","Aufbewahren",30,{g:"Erweitert",x:1,u:"Tage"}),
 sw("cloudprune","Alte Sicherungen auch auf WebDAV löschen",false,{g:"Erweitert",x:1}), der("zone","Zeitzone für 02:00","Europe/Berlin",{g:"Erweitert",x:1})],
 {stats:[["Letzte erfolgreiche Sicherung","heute 02:00","1,2 GB"],["Nächste","Sonntag 02:00",""],["Aufbewahrt","3 Sicherungen",""]]}),
P("srvconn","server","Server-Verbindungen","Vertrauensvolle Verbindungen zu anderen TravStats-Servern.","sharing",[
 lst("requests","Anfragen",[{a:"Reisefreunde · https://reisen.example.org",b:"Fingerabdruck A7:3F:92:B1"}],{g:"Anfragen",acts:[["Zulassen","shareend"],["Ablehnen","shareend",1]],rmOnAct:1}),
 lst("servers","Verbundene Server",[],{g:"Verbunden",acts:[["Trennen","peerremove",1]],empty:"Noch kein Server verbunden."}),
 der("fedorigin","Adresse dieses Servers","= Öffentliche Adresse",{g:"Erweitert",x:1}),
 act("fedkey","Server-Schlüssel","Neu erzeugen",{g:"Erweitert",x:1,danger:1,dlg:"fedkey"})],{when:"fed"}),
P("datenschutz","server","Datenschutz","Du bestimmst, welche Daten deinen Server verlassen.","about",[
 seg("stats","Anonyme Nutzungsstatistik senden",["Ja","Nein","Noch nicht entschieden"],2,{g:"Statistik",h:"Gesendet werden Version, Betriebssystem und Zähler ohne Inhalte. Keine Reisen, keine Namen, keine Adressen."}),
 sw("push","Benachrichtigungen aufs Telefon",false,{g:"Mitteilungen",s:"Über den Push-Dienst von TravStats (Einwilligung beim Einschalten)"}),
 tx("pushrelay","Push-Dienst-Adresse","https://push.travstats.de",{g:"Mitteilungen",x:1}),
 act("pushreset","Push zurücksetzen","Zurücksetzen",{g:"Mitteilungen",x:1,danger:1,dlg:"pushreset"})]),
P("adressen","server","Adressen & Passkeys","Adressen und Vertrauensbereiche für die Anmeldung.","server",[
 der("phoneurl","Adresse für Telefone","= Öffentliche Adresse",{g:"Adressen",s:"Steht im Kopplungs-QR"}),
 tx("lanurl","Adresse im eigenen Netz","",{g:"Adressen"}),
 der("rpid","Passkey-Domain","trav.example.org",{g:"Passkeys",s:"Eine Domain, für immer",h:"Ein Passkey gilt nur für die Domain, unter der er angelegt wurde. Ändern macht alle Passkeys unbrauchbar."}),
 lst("origins","Erlaubte Passkey-Adressen",[{a:"https://trav.example.org"}],{g:"Passkeys",btn:"Adresse hinzufügen",add:[["Adresse mit https","text"]],rm:1,h:"Eine pro Zeile, mit https und Port. Eine reine IP-Adresse ist keine gültige Passkey-Domain."})],{x:1}),
P("eigene","server","Eigene Server","Eigene Infrastruktur statt öffentlicher Dienste.","server",[
 tx("geo","Eigener Geo-Server","",{g:"Orte"}), tx("photon","Photon","",{g:"Orte"}), tx("nominatim","Nominatim","",{g:"Orte"}),
 sel("routing","Routing",["Kein","OSRM","Valhalla"],0,{g:"Routen"}), tx("rail","OpenRailRouting","",{g:"Routen"}), tx("overpass","Overpass","",{g:"Karten"}),
 tx("tplrepo","Vorlagen-Quelle","",{g:"Weitere"}), sel("fx","Wechselkurs-Quelle",["Frankfurter","EZB"],0,{g:"Weitere"})],{x:1}),
P("wartung","server","Wartung","Diagnose und Werkzeuge für deinen Server.","maintenance",[
 sel("loglevel","Protokoll-Stufe",["info","debug","warn"],0,{g:"Protokolle",h:"Gesetzt beim Start des Servers kann die Stufe hier nur teilweise geändert werden."}),
 act("debug24","Ausführliches Protokoll für 24 h","Einschalten",{g:"Protokolle",s:"Macht den Server langsamer",res:"Läuft bis morgen 16:44"}),
 num("logdays","Protokolle aufbewahren",7,{g:"Protokolle",u:"Tage"}), act("logfiles","Protokolldateien","Ansehen",{g:"Protokolle"}),
 act("logclean","Alte Protokolle löschen","Löschen",{g:"Protokolle",danger:1,dlg:"logclean"}),
 inf("sysver","Version","2.8.0",{g:"System"}), inf("tzreport","Zeitmodell","0 offene Fälle · letzte Prüfung gestern",{g:"System",tone:"good"}),
 act("tzresolve","Zeitzonen neu bestimmen","Probelauf",{g:"System",s:"Erst Probelauf, dann übernehmen"}),
 act("fulljson","Alle Daten aller Konten","Erstellen",{g:"System",s:"JSON",res:"Fertig · Herunterladen"}),
 act("enrich_air","Flughafen nachladen","Nachladen",{g:"System",s:"Holt einen Flughafen, der im Katalog fehlt, aus der externen Quelle"}),
 act("reseed","Kataloge neu einlesen","Neu einlesen",{g:"System",danger:1,dlg:"reseed",s:"Flughäfen, Airlines, Flugzeugtypen"}),
 act("demodel","Demo-Konto löschen","Löschen",{g:"System",danger:1,dlg:"demodel"})],{x:1}),
P("stamm","server","Stammdaten","Die Grundlagen deiner Reiseeinträge.","masterdata",
 ["Fluggesellschaften","Flugzeugtypen","Flughäfen","Schiffe","Häfen","Hotelketten"].map((t,i)=>act("md"+i,t,"Öffnen",{g:"Kataloge"})),{x:1})
];
module.exports=PAGES;