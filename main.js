// Onlineklas.nl — Woordenkampioen
// Typ een reeks woorden zo snel mogelijk. 5 niveaus (groep 4 t/m 8).

import { WOORDEN } from "./words.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const AANTAL_WOORDEN = 30;
const MAX_HIGHSCORES = 100;

// ---------- Hulpfuncties ----------

const $ = (id) => document.getElementById(id);

function schud(lijst) {
  const l = lijst.slice();
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

// Maak een lijst van precies AANTAL_WOORDEN woorden voor een groep.
function maakWoordenlijst(groep) {
  const bron = WOORDEN[groep];
  let lijst = [];
  while (lijst.length < AANTAL_WOORDEN) {
    lijst = lijst.concat(schud(bron));
  }
  return lijst.slice(0, AANTAL_WOORDEN);
}

// Tijd in ms -> "12,345" (seconden, komma, milliseconden)
function formatTijd(ms) {
  const sec = Math.floor(ms / 1000);
  const rest = Math.floor(ms % 1000);
  return `${sec},${String(rest).padStart(3, "0")}`;
}

function formatDatum(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

// ---------- Highscore-opslag (localStorage, met geheugen-terugval) ----------

const geheugenScores = {};

// Let op: "hs2" in de sleutel — bij deze versie zijn alle oude lijsten gewist.
function scoresLaden(groep) {
  try {
    const raw = localStorage.getItem(`onlineklas_hs2_groep${groep}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return geheugenScores[groep] || [];
  }
}

function scoresBewaren(groep, scores) {
  geheugenScores[groep] = scores;
  try {
    localStorage.setItem(`onlineklas_hs2_groep${groep}`, JSON.stringify(scores));
  } catch {
    /* localStorage niet beschikbaar — scores blijven in geheugen */
  }
}

function laatsteNaam() {
  try { return localStorage.getItem("onlineklas_naam") || ""; } catch { return ""; }
}

function naamBewaren(naam) {
  try { localStorage.setItem("onlineklas_naam", naam); } catch { /* geen opslag */ }
}

// Voegt score toe; geeft de positie (1-based) terug of null als buiten top 100.
function scoreToevoegen(groep, naam, tijdMs) {
  const scores = scoresLaden(groep);
  const nieuw = { naam, tijdMs, datum: new Date().toISOString() };
  scores.push(nieuw);
  scores.sort((a, b) => a.tijdMs - b.tijdMs);
  const positie = scores.indexOf(nieuw) + 1;
  if (positie > MAX_HIGHSCORES) {
    return null;
  }
  scoresBewaren(groep, scores.slice(0, MAX_HIGHSCORES));
  return positie;
}

// ---------- Online database (Supabase) ----------
// Als config.js is ingevuld, delen alle bezoekers dezelfde highscores.
// Lukt een database-actie niet (offline, storing), dan valt het spel
// stilletjes terug op de lijst op de eigen computer.

function dbActief() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function dbHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

async function dbTop100(groep) {
  const url = `${SUPABASE_URL}/rest/v1/highscores` +
    `?groep=eq.${groep}&select=naam,tijd_ms,datum&order=tijd_ms.asc&limit=${MAX_HIGHSCORES}`;
  const antwoord = await fetch(url, { headers: dbHeaders() });
  if (!antwoord.ok) throw new Error(`Database-fout ${antwoord.status}`);
  const rijen = await antwoord.json();
  return rijen.map((r) => ({ naam: r.naam, tijdMs: r.tijd_ms, datum: r.datum }));
}

async function dbToevoegen(groep, naam, tijdMs) {
  const antwoord = await fetch(`${SUPABASE_URL}/rest/v1/highscores`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({ groep, naam, tijd_ms: tijdMs })
  });
  if (!antwoord.ok) throw new Error(`Database-fout ${antwoord.status}`);

  // Positie bepalen: aantal snellere tijden + 1.
  const telling = await fetch(
    `${SUPABASE_URL}/rest/v1/highscores?groep=eq.${groep}&tijd_ms=lt.${tijdMs}&select=id`,
    { method: "HEAD", headers: { ...dbHeaders(), Prefer: "count=exact" } }
  );
  const bereik = telling.headers.get("content-range") || "";
  const aantalSneller = parseInt(bereik.split("/")[1], 10);
  const positie = Number.isFinite(aantalSneller) ? aantalSneller + 1 : null;
  return positie !== null && positie <= MAX_HIGHSCORES ? positie : positie;
}

// Haalt de top 100 op: online als het kan, anders lokaal.
async function haalScores(groep) {
  if (dbActief()) {
    try {
      return await dbTop100(groep);
    } catch {
      /* database niet bereikbaar — val terug op lokaal */
    }
  }
  return scoresLaden(groep);
}

// ---------- Spelstatus ----------

let huidigeGroep = 4;
let woorden = [];
let woordIndex = 0;
let startTijd = 0;
let timerLoopt = false;
let eindTijdMs = 0;
let laatstePositie = null;
let spelerNaam = "Anoniem";
let aftelTimer = null;

// ---------- Schermen ----------

const SCHERMEN = ["scherm-home", "scherm-groep", "scherm-spel", "scherm-highscores"];

function toonScherm(id) {
  SCHERMEN.forEach((s) => $(s).classList.toggle("hidden", s !== id));
  $("dialog-start").classList.add("hidden");
  $("dialog-einde").classList.add("hidden");
}

// ---------- Stopwatch ----------

function updateStopwatch() {
  if (!timerLoopt) return;
  $("stopwatch").textContent = formatTijd(performance.now() - startTijd);
  requestAnimationFrame(updateStopwatch);
}

// ---------- Spel ----------

function openGroepMenu(groep) {
  huidigeGroep = groep;
  $("groep-titelbalk").textContent = `Onlineklas.nl — Groep ${groep}`;
  $("groep-kop").textContent = `Groep ${groep}`;
  toonScherm("scherm-groep");
}

function startVoorbereiding() {
  woorden = maakWoordenlijst(huidigeGroep);
  woordIndex = 0;
  timerLoopt = false;
  $("spel-titelbalk").textContent = `Woordenkampioen — Groep ${huidigeGroep}`;
  $("stopwatch").textContent = "0,000";
  $("voortgang-balk").style.width = "0%";
  $("woord").textContent = " ";
  $("invoer").value = "";
  $("invoer").classList.remove("fout");
  toonScherm("scherm-spel");
  $("dialog-start").classList.remove("hidden");
  $("naam-invoer").value = laatsteNaam();
  $("naam-invoer").focus();
}

function startSpel() {
  spelerNaam = $("naam-invoer").value.trim() || "Anoniem";
  naamBewaren(spelerNaam);
  $("dialog-start").classList.add("hidden");
  $("invoer").value = "";
  $("invoer").focus();

  // Aftellen: 3... 2... 1... en dan pas start de stopwatch.
  let teller = 3;
  const stap = () => {
    if (teller > 0) {
      $("woord").textContent = String(teller);
      $("woord").classList.add("aftellen");
      teller--;
      aftelTimer = setTimeout(stap, 1000);
    } else {
      aftelTimer = null;
      $("woord").classList.remove("aftellen");
      woordIndex = 0;
      toonWoord();
      startTijd = performance.now();
      timerLoopt = true;
      requestAnimationFrame(updateStopwatch);
      $("invoer").focus();
    }
  };
  stap();
}

function toonWoord() {
  $("woord").textContent = woorden[woordIndex];
  $("voortgang-balk").style.width = `${(woordIndex / AANTAL_WOORDEN) * 100}%`;
  $("invoer").value = "";
  $("invoer").classList.remove("fout");
}

function flitsRood() {
  const flash = $("flash");
  flash.classList.remove("flash-on");
  // herstart de animatie
  void flash.offsetWidth;
  flash.classList.add("flash-on");
}

// Wordt bij elke toetsaanslag aangeroepen: is het woord goed getypt,
// dan gaat het spel vanzelf door. Staat er iets fout, dan kleuren de
// letters rood (met een korte flits) en verbeter je het zelf met backspace.
function controleerInvoer() {
  if (!timerLoopt) return;
  const invoer = $("invoer");
  const getypt = invoer.value.toLowerCase();
  const doel = woorden[woordIndex].toLowerCase();

  if (getypt === doel) {
    invoer.classList.remove("fout");
    woordIndex++;
    if (woordIndex >= AANTAL_WOORDEN) {
      eindeSpel();
    } else {
      toonWoord();
    }
    return;
  }

  const foutGetypt = getypt !== "" && !doel.startsWith(getypt);
  if (foutGetypt && !invoer.classList.contains("fout")) {
    flitsRood(); // flits alleen op het moment dat het fout gaat
  }
  invoer.classList.toggle("fout", foutGetypt);
}

async function eindeSpel() {
  timerLoopt = false;
  eindTijdMs = performance.now() - startTijd;
  $("stopwatch").textContent = formatTijd(eindTijdMs);
  $("voortgang-balk").style.width = "100%";

  $("einde-tijd").textContent = `${formatTijd(eindTijdMs)} sec`;

  // Niet automatisch opslaan: de speler kiest zelf (opslaan / opnieuw / menu).
  const scores = await haalScores(huidigeGroep);
  const inTop = scores.length < MAX_HIGHSCORES ||
    eindTijdMs < scores[scores.length - 1].tijdMs;
  $("btn-opslaan").classList.toggle("hidden", !inTop);
  if (inTop) {
    $("einde-positie").textContent = `Goed gedaan, ${spelerNaam}! Wil je deze tijd opslaan in de top 100 van groep ${huidigeGroep}?`;
  } else {
    $("einde-positie").textContent = `Helaas ${spelerNaam}, deze tijd is niet snel genoeg voor de top 100. Probeer het nog eens!`;
  }
  $("dialog-einde").classList.remove("hidden");
  if (inTop) {
    $("btn-opslaan").focus();
  } else {
    $("btn-opnieuw").focus();
  }
}

async function tijdOpslaan() {
  const knop = $("btn-opslaan");
  knop.disabled = true;
  knop.textContent = "Bezig...";
  const tijd = Math.round(eindTijdMs);

  if (dbActief()) {
    try {
      laatstePositie = await dbToevoegen(huidigeGroep, spelerNaam, tijd);
    } catch {
      laatstePositie = scoreToevoegen(huidigeGroep, spelerNaam, tijd);
    }
  } else {
    laatstePositie = scoreToevoegen(huidigeGroep, spelerNaam, tijd);
  }

  knop.disabled = false;
  knop.textContent = "💾 Tijd opslaan";
  toonHighscores(huidigeGroep, laatstePositie);
}

// ---------- Highscores ----------

async function toonHighscores(groep, markeerPositie = null) {
  huidigeGroep = groep;
  $("hs-titelbalk").textContent = `Onlineklas.nl — Highscores Groep ${groep}`;
  $("hs-kop").textContent = `Highscores — Groep ${groep}`;

  const body = $("hs-body");
  body.innerHTML = "";
  $("hs-leeg").textContent = "Laden...";
  $("hs-leeg").classList.remove("hidden");
  toonScherm("scherm-highscores");

  const scores = await haalScores(groep);
  $("hs-leeg").textContent = "Nog geen scores. Wees de eerste Woordenkampioen!";
  $("hs-leeg").classList.toggle("hidden", scores.length > 0);

  scores.forEach((s, i) => {
    const tr = document.createElement("tr");
    if (markeerPositie !== null && i === markeerPositie - 1) tr.classList.add("mijn-score");
    const cellen = [
      String(i + 1),
      s.naam,
      `${formatTijd(s.tijdMs)} sec`,
      formatDatum(s.datum)
    ];
    cellen.forEach((tekst) => {
      const td = document.createElement("td");
      td.textContent = tekst;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  if (markeerPositie !== null) {
    const rij = body.children[markeerPositie - 1];
    if (rij) rij.scrollIntoView({ block: "center" });
  }
}

// ---------- Thema's (Windows 95 / Schoolsite 2005 / Krijtbord) ----------

const THEMAS = ["win95", "school", "krijtbord"];

function zetThema(thema) {
  if (!THEMAS.includes(thema)) thema = "win95";
  document.body.classList.remove("thema-school", "thema-krijtbord");
  if (thema !== "win95") document.body.classList.add(`thema-${thema}`);
  document.querySelectorAll("[data-thema]").forEach((k) => {
    k.classList.toggle("actief", k.dataset.thema === thema);
  });
  try { localStorage.setItem("onlineklas_thema", thema); } catch { /* geen opslag */ }
}

function themaLaden() {
  let thema = "win95";
  try { thema = localStorage.getItem("onlineklas_thema") || "win95"; } catch { /* geen opslag */ }
  zetThema(thema);
}

document.querySelectorAll("[data-thema]").forEach((knop) => {
  knop.addEventListener("click", () => zetThema(knop.dataset.thema));
});

themaLaden();

// ---------- Gebeurtenissen ----------

document.querySelectorAll("[data-groep]").forEach((knop) => {
  knop.addEventListener("click", () => openGroepMenu(Number(knop.dataset.groep)));
});

$("btn-spelen").addEventListener("click", startVoorbereiding);
$("btn-highscores").addEventListener("click", () => toonHighscores(huidigeGroep));
$("btn-terug-home").addEventListener("click", () => toonScherm("scherm-home"));

$("btn-start").addEventListener("click", startSpel);

$("invoer").addEventListener("input", controleerInvoer);
$("invoer").addEventListener("keydown", (e) => {
  // Enter en spatie zijn niet meer nodig — negeer ze stilletjes.
  if (e.key === "Enter" || e.key === " ") e.preventDefault();
});
$("invoer").addEventListener("paste", (e) => e.preventDefault());

$("btn-stoppen").addEventListener("click", () => {
  timerLoopt = false;
  if (aftelTimer !== null) {
    clearTimeout(aftelTimer);
    aftelTimer = null;
  }
  $("woord").classList.remove("aftellen");
  toonScherm("scherm-groep");
});

$("btn-opslaan").addEventListener("click", tijdOpslaan);
$("naam-invoer").addEventListener("keydown", (e) => {
  if (e.key === "Enter") startSpel();
});
$("btn-opnieuw").addEventListener("click", startVoorbereiding);
$("btn-einde-menu").addEventListener("click", () => toonScherm("scherm-groep"));

$("btn-hs-spelen").addEventListener("click", startVoorbereiding);
$("btn-hs-terug").addEventListener("click", () => toonScherm("scherm-groep"));
$("btn-hs-home").addEventListener("click", () => toonScherm("scherm-home"));
