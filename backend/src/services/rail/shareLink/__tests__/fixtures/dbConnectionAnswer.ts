/**
 * A tester's real bahn.de connection answer (forgejo#204, 2026-10-16), sanitised:
 * the day moved to an invented one (3 November 2026), the price-context blocks
 * (`¶KRCC¶`, `¶SC¶`) and the search's own bookkeeping dropped. What is left is
 * public timetable data — three stations with their EVA numbers and positions,
 * a regional train, a walk to the deep station, the S1 — plus the `¶KCC¶`
 * block naming each vehicle's HAFAS category (DRB, DBS) and the `¶KC¶` product
 * list every such answer carries. No one's ride.
 */
export const ALEX_RECON =
  "¶HKI¶T$A=1@O=Augsburg Hbf@X=10885568@Y=48365444@L=8000013@a=128@$A=1@O=München Hbf@X=11558339@Y=48140229@L=8000261@a=128@$202611030808$202611030854$            57031$$1$$$$$$§W$A=1@O=München Hbf@X=11558339@Y=48140229@L=8000261@a=128@$A=1@O=München Hbf (tief)@X=11560496@Y=48141173@L=8098263@a=128@$202611030854$202611030904$$$1$$$$$$§T$A=1@O=München Hbf (tief)@X=11560496@Y=48141173@L=8098263@a=128@$A=1@O=München Flughafen Terminal@X=11785973@Y=48353732@L=8004168@a=128@$202611030942$202611031028$               S1$$1$$$$$$" +
  "¶KC¶#VE#2#CF#100#CA#0#CM#0#SICT#0#AM#649#AM2#0#GP0#Bsv#GP0#BSV#GP0#Bus#GP0#BUS#GP0#CAT#GP0#CJX#GP0#DBS#GP0#DPN#GP0#DRB#GP0#DRE#GP0#DRS#GP0#FEX#GP0#EBd#GP0#R84#GP0#RJd#GP0#IXr#GP0#TER#GP0#MEX#GP0#SON#GP0#ICd#GP0#ICr#GP0#stb#GP0#IRE#GP0#REX#GP0#IXd#GP0#T84#GP0#S84#GP0#NRB#GP0#NRE#GP0#OBU#GP0#stR#GP0#STR#GP0#SWB#GP0#PPN#GP0#ubu#GP0#Stb#GP0#RER#GP0#Str#GP0#ZRB#GP0#Os#GP0#OZ#GP0#RB#GP0#RE#GP0#SB#GP0#lt#GP0#Sp#GP0#RT#GP0#Zr#GP0#e#GP0#R#GP0#N#GP0#s#GP0#S#GP0#E#GP0#u#GP0#U#GP1#Bsv#GP1#BSV#GP1#Bus#GP1#BUS#GP1#CAT#GP1#CJX#GP1#DBS#GP1#DPN#GP1#DRB#GP1#DRE#GP1#DRS#GP1#FEX#GP1#EBd#GP1#R84#GP1#RJd#GP1#IXr#GP1#TER#GP1#MEX#GP1#SON#GP1#ICd#GP1#ICr#GP1#stb#GP1#IRE#GP1#REX#GP1#IXd#GP1#T84#GP1#S84#GP1#NRB#GP1#NRE#GP1#OBU#GP1#stR#GP1#STR#GP1#SWB#GP1#PPN#GP1#ubu#GP1#Stb#GP1#RER#GP1#Str#GP1#ZRB#GP1#Os#GP1#OZ#GP1#RB#GP1#RE#GP1#SB#GP1#lt#GP1#Sp#GP1#RT#GP1#Zr#GP1#e#GP1#R#GP1#N#GP1#s#GP1#S#GP1#E#GP1#u#GP1#U#GP2#Bsv#GP2#BSV#GP2#Bus#GP2#BUS#GP2#CAT#GP2#CJX#GP2#DBS#GP2#DPN#GP2#DRB#GP2#DRE#GP2#DRS#GP2#FEX#GP2#EBd#GP2#R84#GP2#RJd#GP2#IXr#GP2#TER#GP2#MEX#GP2#SON#GP2#ICd#GP2#ICr#GP2#stb#GP2#IRE#GP2#REX#GP2#IXd#GP2#T84#GP2#S84#GP2#NRB#GP2#NRE#GP2#OBU#GP2#stR#GP2#STR#GP2#SWB#GP2#PPN#GP2#ubu#GP2#Stb#GP2#RER#GP2#Str#GP2#ZRB#GP2#Os#GP2#OZ#GP2#RB#GP2#RE#GP2#SB#GP2#lt#GP2#Sp#GP2#RT#GP2#Zr#GP2#e#GP2#R#GP2#N#GP2#s#GP2#S#GP2#E#GP2#u#GP2#U#RT#7#" +
  "¶KCC¶" +
  "I1ZFIzEjClojVk4jMSNTVCMxNzkyMDAxOTYyI1BJIzAjWkkjNjkzNjMjVEEjMCNEQSMwMzExMjYjMVMjODAwMDAwMiMxVCM2MDgjTFMjODAwMDI2MSNMVCM4NTQjUFUjODAjUlQjMSNDQSNEUkIjWkUjNTcwMzEjWkIjICAgICAgICAgICAgNTcwMzEjUEMjMyNGUiM4MDAwMDEzI0ZUIzgwOCNUTyM4MDAwMjYxI1RUIzg1NCMKRiNWTiMwI1NUIzE3OTIwMDE5NjIjUEkjMCNQVSM4MCNaSSMyNDE1OTQzNzQ4I0RBIzAzMTEyNiNGUiM4MDAwMjYxI1RPIzgwOTgyNjMjRlQjODU0I1RUIzkwNCNUUyMwI0ZGIyNGViMwIwpaI1ZOIzEjU1QjMTc5MjAwMTk2MiNQSSMwI1pJIzM4OTQwNSNUQSM0I0RBIzAzMTEyNiMxUyM4MDA0MTM0IzFUIzkzMSNMUyM4MDA0MTY4I0xUIzEwMjgjUFUjODAjUlQjMSNDQSNEQlMjWkUjUzEjWkIjICAgICAgICAgICAgICAgUzEjUEMjNCNGUiM4MDk4MjYzI0ZUIzk0MiNUTyM4MDA0MTY4I1RUIzEwMjgjCg==" +
  "¶";

export const ALEX_ANSWER = {
  startOrt: "Augsburg Hbf",
  zielOrt: "München Flughafen Terminal",
  hinfahrtDatum: "2026-11-03T08:08:00+01:00",
  hinfahrtRecon: ALEX_RECON,
};

/** Every category code the answer's product list (`#GP0#…`) enumerates. */
export const ALEX_PRODUCT_CODES: readonly string[] = [
  "Bsv",
  "BSV",
  "Bus",
  "BUS",
  "CAT",
  "CJX",
  "DBS",
  "DPN",
  "DRB",
  "DRE",
  "DRS",
  "FEX",
  "EBd",
  "R84",
  "RJd",
  "IXr",
  "TER",
  "MEX",
  "SON",
  "ICd",
  "ICr",
  "stb",
  "IRE",
  "REX",
  "IXd",
  "T84",
  "S84",
  "NRB",
  "NRE",
  "OBU",
  "stR",
  "STR",
  "SWB",
  "PPN",
  "ubu",
  "Stb",
  "RER",
  "Str",
  "ZRB",
  "Os",
  "OZ",
  "RB",
  "RE",
  "SB",
  "lt",
  "Sp",
  "RT",
  "Zr",
  "e",
  "R",
  "N",
  "s",
  "S",
  "E",
  "u",
  "U",
];
