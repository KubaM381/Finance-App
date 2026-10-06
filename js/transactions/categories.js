// Kategorien und regelbasierte Zuordnung anhand von Empfänger/Verwendungszweck.
// Schlüsselwörter passen am Wortanfang ("tank" → "Tankstelle"); mit "=" davor nur als ganzes Wort.
// Die Reihenfolge der Regeln ist die Priorität (erste passende Regel gewinnt).

export const normalizeText = (value = "") =>
  String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const RULES = [
  { name: "Gehalt", type: "income", words: ["gehalt", "lohn", "bezuege", "besoldung", "=salary", "=payroll", "arbeitgeber", "verdienst"] },
  { name: "Erstattung", type: "income", words: ["erstattung", "rueckzahlung", "rückzahlung", "=refund", "retoure", "kindergeld", "erstattet"] },
  { name: "Zinsen & Erträge", type: "income", words: ["zinsen", "dividende", "kapitalertrag", "ertragsausschuettung"] },
  { name: "Sparen & Anlage", type: "both", words: ["sparplan", "tagesgeld", "festgeld", "depot", "trade republic", "scalable", "=etf", "wertpapier", "umbuchung", "vermoegenswirk"] },
  { name: "Wohnen", type: "expense", words: ["miete", "nebenkosten", "hausgeld", "stadtwerke", "strom", "=gas", "wasser", "energie", "vattenfall", "=eon", "=e on", "hausverwaltung", "wohnungsbau", "grundsteuer", "beitragsservice", "rundfunk", "=gez"] },
  { name: "Lebensmittel", type: "expense", words: ["rewe", "edeka", "aldi", "lidl", "penny", "netto", "kaufland", "norma", "tegut", "globus", "marktkauf", "nahkauf", "alnatura", "denns", "supermarkt", "backerei", "baeckerei", "metzger", "=real"] },
  { name: "Restaurants & Café", type: "expense", words: ["restaurant", "cafe", "=kaffee", "mcdonald", "burger king", "lieferando", "=wolt", "uber eats", "starbucks", "=kfc", "subway", "pizz", "imbiss", "bistro", "gaststaette", "gasthof", "dominos"] },
  { name: "Mobilität", type: "expense", words: ["tankstelle", "tank", "=aral", "=shell", "=esso", "=jet", "totalenergies", "=agip", "=hem", "deutsche bahn", "=db", "bahn", "=uber", "=bolt", "flixbus", "flixtrain", "=bvg", "=hvv", "=mvg", "=rmv", "=vrr", "=kvb", "parkhaus", "parken", "=adac", "kfz", "=tuv", "autohaus", "werkstatt", "deutschlandticket", "=sixt"] },
  { name: "Reisen", type: "expense", words: ["hotel", "booking com", "airbnb", "lufthansa", "ryanair", "easyjet", "eurowings", "urlaub", "=tui", "reise", "hostel", "expedia", "flug"] },
  { name: "Freizeit", type: "expense", words: ["netflix", "spotify", "disney", "prime video", "amazon prime", "dazn", "=sky", "youtube", "kino", "cinemaxx", "=steam", "playstation", "nintendo", "fitness", "=mcfit", "urban sports", "theater", "konzert", "ticketmaster", "eventim", "=audible"] },
  { name: "Einkaufen", type: "expense", words: ["amazon", "zalando", "=otto", "ikea", "ebay", "=dm", "rossmann", "mueller", "saturn", "mediamarkt", "decathlon", "=obi", "hornbach", "bauhaus", "=tedi", "=action"] },
  { name: "Gesundheit", type: "expense", words: ["apotheke", "arzt", "zahnarzt", "praxis", "klinik", "krankenhaus", "physio", "optiker", "=fielmann"] },
  { name: "Versicherungen", type: "expense", words: ["versicherung", "allianz", "=huk", "huk coburg", "=axa", "=ergo", "haftpflicht", "=devk", "=lvm", "debeka", "signal iduna", "krankenkasse", "=aok", "=barmer", "=dak", "=ikk", "=bkk", "techniker"] },
  { name: "Telefon & Internet", type: "expense", words: ["telekom", "vodafone", "=o2", "telefonica", "=1&1", "congstar", "=freenet", "mobilcom", "=ionos", "=strato", "internet", "mobilfunk", "=dsl", "=simyo", "=lebara", "=fonic"] },
  { name: "Bargeld", type: "expense", words: ["geldautomat", "bargeldauszahlung", "=atm", "bankautomat", "bargeld", "auszahlung"] },
  { name: "Gebühren", type: "expense", words: ["kontofuehrung", "kontofuhrung", "entgelt", "gebuehr", "provision", "jahresbeitrag", "kartenentgelt", "=mahnung"] },
  { name: "Steuern", type: "expense", words: ["finanzamt", "steuer", "hauptzollamt", "=zoll"] },
  { name: "Bildung", type: "expense", words: ["universitaet", "=uni", "=vhs", "semesterbeitrag", "studierendenwerk", "udemy", "schulgeld", "thalia", "hugendubel"] },
  { name: "Spenden", type: "expense", words: ["spende", "=unicef", "=wwf", "=caritas"] }
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
