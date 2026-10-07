// Kategorien und regelbasierte Zuordnung anhand von Empfänger/Verwendungszweck.
// Schlüsselwörter passen am Wortanfang ("tank" → "Tankstelle"); mit "=" davor nur als ganzes Wort.
// Die Reihenfolge der Regeln ist die Priorität (erste passende Regel gewinnt).
// Ergänzend lernt js/transactions/rules.js aus deinen eigenen Zuordnungen (siehe autoCategory).

export const normalizeText = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const RULES = [
  { name: "Gehalt", type: "income", words: ["gehalt", "lohn", "bezuege", "besoldung", "=salary", "=payroll", "arbeitgeber", "verdienst", "rente", "pension", "versorgungsbezuege", "krankengeld", "elterngeld", "arbeitslosengeld", "buergergeld", "bafoeg", "stipendium", "honorar", "dienstbezuege"] },
  { name: "Erstattung", type: "income", words: ["erstattung", "rueckzahlung", "rückzahlung", "=refund", "retoure", "kindergeld", "erstattet", "steuererstattung", "rueckerstattung", "kostenerstattung", "cashback", "=storno", "rueckbuchung"] },
  { name: "Zinsen & Erträge", type: "income", words: ["zinsen", "dividende", "kapitalertrag", "ertragsausschuettung", "zinsertrag", "habenzinsen", "zinsgutschrift"] },
  { name: "Sparen & Anlage", type: "both", words: ["sparplan", "tagesgeld", "festgeld", "depot", "trade republic", "scalable", "=etf", "wertpapier", "umbuchung", "vermoegenswirk", "flatex", "smartbroker", "bitcoin", "krypto", "crypto", "coinbase", "kraken", "binance", "=bison", "sparbrief", "bausparen", "bausparvertrag", "schwaebisch hall", "wuestenrot", "=lbs", "sparkonto", "aktien", "fonds", "investment"] },
  { name: "Wohnen", type: "expense", words: ["miete", "kaltmiete", "warmmiete", "nebenkosten", "betriebskosten", "hausgeld", "stadtwerke", "strom", "=gas", "wasser", "abwasser", "energie", "vattenfall", "=eon", "=e on", "enbw", "=rwe", "eprimo", "lichtblick", "naturstrom", "tibber", "mainova", "=swm", "avacon", "gasag", "=ewe", "heizoel", "fernwaerme", "schornsteinfeger", "hausverwaltung", "wohnungsbau", "wohnungsgenossenschaft", "vonovia", "=leg", "grundsteuer", "muellgebuehr", "abfall", "entsorgung", "hausmeister", "beitragsservice", "rundfunk", "=gez"] },
  { name: "Lebensmittel", type: "expense", words: ["rewe", "sagt danke", "edeka", "aldi", "lidl", "penny", "netto", "kaufland", "norma", "tegut", "globus", "marktkauf", "nahkauf", "nah und gut", "alnatura", "denns", "famila", "=combi", "e center", "ecenter", "frischemarkt", "frischmarkt", "wochenmarkt", "hofladen", "biomarkt", "bio company", "denree", "naturkost", "reformhaus", "getraenke", "trinkgut", "fristo", "=metro", "=selgros", "supermarkt", "backerei", "baeckerei", "baecker", "backshop", "back factory", "=kamps", "=ihle", "steinecke", "konditorei", "fleischerei", "metzger", "=fleischer", "=real"] },
  { name: "Restaurants & Café", type: "expense", words: ["restaurant", "ristorante", "trattoria", "osteria", "cafe", "=kaffee", "eiscafe", "eisdiele", "mcdonald", "mc donald", "burger", "lieferando", "=wolt", "uber eats", "just eat", "=gorillas", "=flink", "starbucks", "=kfc", "subway", "five guys", "domino", "pizza", "vapiano", "block house", "nordsee", "dean david", "backwerk", "imbiss", "bistro", "gaststaette", "gasthof", "gasthaus", "brauhaus", "kneipe", "biergarten", "=pub", "doener", "kebab", "kebap", "sushi", "mensa", "kantine", "catering", "grill"] },
  { name: "Mobilität", type: "expense", words: ["tankstelle", "tank", "autohof", "=aral", "=shell", "=esso", "=jet", "=total", "totalenergies", "=agip", "=hem", "=avia", "=orlen", "=bft", "allguth", "=q1", "=tamoil", "deutsche bahn", "=db", "bahn", "flixbus", "flixtrain", "=uber", "=bolt", "free now", "freenow", "share now", "sharenow", "=miles", "=tier", "=lime", "nextbike", "call a bike", "=bvg", "=hvv", "=mvg", "=mvv", "=rmv", "=vrr", "=kvb", "=vbb", "=vgn", "=vag", "=ssb", "=gvh", "uestra", "=rnv", "=nvv", "=vvs", "=bsag", "=dvb", "nahverkehr", "verkehrsbetriebe", "verkehrsverbund", "deutschlandticket", "parkhaus", "parken", "parkplatz", "parkschein", "easypark", "parkster", "apcoa", "q park", "contipark", "kfz", "=adac", "=tuv", "=dekra", "=gtue", "=atu", "pit stop", "autohaus", "werkstatt", "reifen", "carglass", "autowasch", "waschstrasse", "autoteile", "maut", "vignette", "ladestation", "ladekarte", "=ionity", "supercharger", "=sixt", "europcar", "=hertz", "=avis"] },
  { name: "Reisen", type: "expense", words: ["hotel", "booking com", "airbnb", "lufthansa", "ryanair", "easyjet", "eurowings", "condor", "wizz", "tuifly", "urlaub", "=tui", "reise", "hostel", "expedia", "trivago", "=hrs", "opodo", "flug", "ferienwohnung", "ferienhaus", "camping"] },
  { name: "Freizeit", type: "expense", words: ["netflix", "spotify", "disney", "prime video", "amazon prime", "dazn", "=sky", "youtube", "apple tv", "paramount", "=rtl", "joyn", "crunchyroll", "=audible", "kindle", "bookbeat", "storytel", "=deezer", "tidal", "kino", "cinemaxx", "cinestar", "=uci", "filmpalast", "=steam", "playstation", "sony interactive", "xbox", "nintendo", "epic games", "=twitch", "google play", "itunes", "apple com bill", "icloud", "google one", "dropbox", "adobe", "fitness", "=mcfit", "=fitx", "clever fit", "urban sports", "fitnessstudio", "sportstudio", "yoga", "=gym", "schwimmbad", "freibad", "hallenbad", "therme", "sauna", "theater", "konzert", "ticketmaster", "eventim", "reservix", "museum", "=zoo", "freizeitpark", "bowling", "minigolf", "mitgliedsbeitrag"] },
  { name: "Haustier", type: "expense", words: ["fressnapf", "zooplus", "tierarzt", "tierklinik", "tierbedarf", "futterhaus", "=napf", "hundefutter", "katzenfutter", "tierpension"] },
  { name: "Kinder & Familie", type: "expense", words: ["kita", "kindergarten", "kinderkrippe", "=hort", "babymarkt", "baby walz", "spielwaren", "=smyths", "mytoys", "jako o", "kinderbetreuung", "schulessen", "tagesmutter"] },
  { name: "Einkaufen", type: "expense", words: ["amazon", "zalando", "=otto", "ikea", "ebay", "kleinanzeigen", "=temu", "=shein", "aliexpress", "=etsy", "=dm", "rossmann", "mueller", "=budni", "douglas", "saturn", "mediamarkt", "cyberport", "notebooksbilliger", "alternate", "decathlon", "sportscheck", "intersport", "=obi", "hornbach", "bauhaus", "toom", "hagebau", "=tedi", "=action", "woolworth", "thomas philipps", "=kik", "takko", "deichmann", "=c&a", "=h&m", "=zara", "primark", "new yorker", "tk maxx", "about you", "peek cloppenburg", "=esprit", "=s.oliver", "=depot", "jysk", "=poco", "=roller", "xxxlutz", "moemax", "tchibo", "conrad", "apple store"] },
  { name: "Gesundheit", type: "expense", words: ["apotheke", "docmorris", "doc morris", "arzt", "zahnarzt", "zahn", "kieferorthop", "praxis", "klinik", "krankenhaus", "physio", "krankengymnastik", "ergotherap", "logopaed", "optik", "optiker", "=fielmann", "=apollo", "brille", "labor", "=mvz", "heilpraktiker", "sanitaets", "orthopaed", "psycholog", "therapeut", "osteopath", "massage"] },
  { name: "Versicherungen", type: "expense", words: ["versicherung", "rentenversicherung", "=drv", "allianz", "=huk", "huk coburg", "=axa", "=ergo", "generali", "=r+v", "gothaer", "wuerttembergische", "cosmos direkt", "=vhv", "concordia", "provinzial", "barmenia", "=dkv", "hanse merkur", "haftpflicht", "hausrat", "rechtsschutz", "unfallversicherung", "berufsunfaehigkeit", "=devk", "=lvm", "debeka", "signal iduna", "krankenkasse", "krankenversicherung", "=aok", "=barmer", "=dak", "=ikk", "=bkk", "=tkk", "techniker", "knappschaft", "=kkh", "=hkk"] },
  { name: "Telefon & Internet", type: "expense", words: ["telekom", "vodafone", "=o2", "telefonica", "=1&1", "congstar", "=freenet", "mobilcom", "=ionos", "=strato", "internet", "mobilfunk", "=dsl", "=simyo", "=lebara", "=fonic", "aldi talk", "alditalk", "=otelo", "klarmobil", "winsim", "drillisch", "sipgate", "netcologne", "=m net", "glasfaser", "pyur", "unitymedia", "kabel"] },
  { name: "Bargeld", type: "expense", words: ["geldautomat", "bargeldauszahlung", "=atm", "bankautomat", "bargeld", "auszahlung", "geldausgabe", "abhebung"] },
  { name: "Gebühren", type: "expense", words: ["kontofuehrung", "kontofuhrung", "kontogebuehr", "entgelt", "gebuehr", "provision", "jahresbeitrag", "kartenentgelt", "=mahnung", "sollzinsen", "dispozinsen", "kreditzinsen", "ruecklastschrift", "fremdwaehrung", "porto"] },
  { name: "Steuern", type: "expense", words: ["finanzamt", "steuer", "hauptzollamt", "=zoll", "=elster"] },
  { name: "Bildung", type: "expense", words: ["universitaet", "=uni", "=vhs", "semesterbeitrag", "studierendenwerk", "studentenwerk", "udemy", "coursera", "schulgeld", "thalia", "hugendubel", "=osiander", "buchhandlung", "duolingo", "babbel", "fernuni", "=ihk", "lehrgang", "seminar", "kursgebuehr", "nachhilfe"] },
  { name: "Spenden", type: "expense", words: ["spende", "=unicef", "=wwf", "=caritas", "diakonie", "=drk", "rotes kreuz", "aerzte ohne grenzen", "greenpeace", "=nabu", "betterplace", "tierheim", "=amnesty"] }
];

export const FALLBACK = { income: "Sonstige Einnahmen", expense: "Sonstiges" };

const compiled = RULES.map((rule) => ({
  name: rule.name,
  type: rule.type,
  words: rule.words.map((word) =>
    word.startsWith("=") ? { w: normalizeText(word.slice(1)), whole: true } : { w: normalizeText(word), whole: false }
  )
}));

export const CATEGORY_NAMES = [...new Set([...RULES.map((rule) => rule.name), FALLBACK.income, FALLBACK.expense])];

export const isFallbackCategory = (name) => name === FALLBACK.income || name === FALLBACK.expense;

// Kategorien, die für Einnahmen ("income") bzw. Ausgaben ("expense") sinnvoll sind (ohne "Sonstiges").
export const categoriesFor = (type) => [...new Set(RULES.filter((rule) => rule.type === type || rule.type === "both").map((rule) => rule.name))];

export function categorize(text, type) {
  const haystack = ` ${normalizeText(text)} `;
  if (haystack.trim()) {
    for (const rule of compiled) {
      if (type && rule.type !== "both" && rule.type !== type) continue;
      for (const { w, whole } of rule.words) {
        if (w && haystack.includes(whole ? ` ${w} ` : ` ${w}`)) return rule.name;
      }
    }
  }
  return type === "income" ? FALLBACK.income : FALLBACK.expense;
}
