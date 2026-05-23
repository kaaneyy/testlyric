const dbName = "testlyric_db";
let db;
let debounceTimer;
let currentSong = createSong();
let versionSnapshots = [];
const suggestionCache = new Map();

const rhymeMap = {
  light: ["night", "fight", "sight", "bite", "satellite"],
  you: ["blue", "true", "through", "do", "new"],
  emotion: ["ocean", "devotion", "explosion", "slow motion", "unspoken"]
};

const wordplayMap = {
  light: ["spotlight", "ignite", "make light of", "light work"],
  fall: ["free fall", "fall for", "autumn leaves", "gravity pull"],
  game: ["play your cards", "change the rules", "score to settle"]
};

init();

async function init() {
  bindUi();
  await openDb();
  const saved = await loadSong();
  if (saved) currentSong = saved;
  hydrate();
  runLocalAnalysis();
}

function bindUi() {
  const editor = el("editor");
  editor.addEventListener("input", onEdit);
  el("title").addEventListener("input", (e) => currentSong.title = e.target.value);
  el("saveBtn").addEventListener("click", () => saveSong("manual save"));
  el("openMenu").addEventListener("click", () => el("menu").classList.remove("hidden"));
  el("closeMenu").addEventListener("click", () => el("menu").classList.add("hidden"));

  document.querySelectorAll("[data-ai]").forEach((btn) => btn.addEventListener("click", () => runManualAI(btn.dataset.ai)));
  document.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => runAction(btn.dataset.action)));
}

function createSong() {
  return { id: crypto.randomUUID(), title: "Untitled Song", genre: "", mood: [], theme: "", sections: [], memory: {}, versions: [] };
}

function onEdit(e) {
  const text = e.target.value;
  currentSong.sections = detectSections(text);
  currentSong.memory = buildSongBrain(currentSong.sections);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runLocalAnalysis, 500);
  setTimeout(() => saveSong("autosave"), 2000);
}

function detectSections(text) {
  const lines = text.split("\n");
  let type = "verse";
  const sections = [];
  let buffer = [];

  const pushSection = () => {
    if (!buffer.length) return;
    const id = `${type}_${sections.filter((s) => s.type === type).length + 1}`;
    sections.push({ id, type, text: buffer.join("\n"), lines: buffer.map((line, i) => enrichLine(id, line, i)) });
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    const detected = /^(verse|chorus|pre-chorus|bridge|hook|outro)\b/i.exec(line);
    if (detected) { pushSection(); type = detected[1].toLowerCase().replace("-", "_"); continue; }
    buffer.push(raw);
  }
  pushSection();
  return sections;
}

function enrichLine(sectionId, text, index) {
  const cleaned = text.trim();
  const endingWord = cleaned.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") || "";
  return {
    id: `${sectionId}_line_${index + 1}`,
    text,
    syllables: estimateSyllables(cleaned),
    endingSound: endingWord.slice(-3),
    rhymeGroup: String.fromCharCode(65 + (index % 4)),
    keywords: cleaned.toLowerCase().split(/\W+/).filter(Boolean).slice(0, 3)
  };
}

function estimateSyllables(line) { return (line.toLowerCase().match(/[aeiouy]+/g) || []).length || 1; }

function runLocalAnalysis() {
  const text = el("editor").value;
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  const lastWord = words.at(-1) || "";
  const rhyme = rhymeMap[lastWord] || guessNearRhymes(lastWord);
  const repeats = findRepeats(words);
  const cliches = detectCliches(text);
  const wordplay = wordplayMap[lastWord] || [];
  renderSuggestions([ ...rhyme.slice(0, 3), ...wordplay.slice(0, 2) ]);
  el("details").textContent = `rhyme: ${rhyme.join(" / ")}\nnear-rhyme: ${guessNearRhymes(lastWord).join(" / ")}\nrepeats: ${repeats.join(", ") || "none"}\ncliché warnings: ${cliches.join(", ") || "none"}`;
}

function guessNearRhymes(word) { if (!word) return []; return [word.slice(0, 1) + "ight", word.slice(0, 1) + "ime", word + "er"].filter(Boolean); }
function findRepeats(words) { const counts = {}; for (const w of words) counts[w]=(counts[w]||0)+1; return Object.keys(counts).filter(k=>counts[k]>2).slice(0,5); }
function detectCliches(text) { return ["broken heart","lost without you","tears fall down"].filter(c=>text.toLowerCase().includes(c)); }

function runManualAI(task) {
  const line = getCurrentLine();
  const key = JSON.stringify({ task, line, genre: currentSong.genre, mood: currentSong.mood });
  if (suggestionCache.has(key)) return renderAi(suggestionCache.get(key), true);

  const generated = {
    improve_line: [`${line.replace(/\b(sad|bad)\b/gi, "heavy")}`, "Your ghost still sleeps in my phone"],
    generate_chorus: ["Chorus", "I wear your echo like a chain tonight", "Say I'm alright while I hide from the light"],
    wordplay: ["falling for you / gravity pull", "cold shoulder / winter warning"],
    double_meanings: ["kept me in rotation (playlist / option)", "on repeat (song / behavior)"],
    analyze_structure: [analyzeStructureText()]
  }[task] || ["No suggestion"];

  suggestionCache.set(key, generated);
  renderAi(generated, false);
  saveVersion(`AI tool: ${task}`);
}

function analyzeStructureText() {
  const counts = currentSong.sections.reduce((a, s) => ((a[s.type] = (a[s.type] || 0) + 1), a), {});
  return `Structure: ${Object.entries(counts).map(([k,v]) => `${k} x${v}`).join(", ") || "verse x1"}. Consider repeating the hook phrase in chorus.`;
}

function runAction(action) {
  if (action === "show-structure") return renderAi([analyzeStructureText()], true);
  if (action === "show-versions") return renderAi(versionSnapshots.slice(-8).map(v => `${v.at}: ${v.reason}`), true);
  if (action === "export") {
    const blob = new Blob([el("editor").value], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${currentSong.title || "song"}.txt`; a.click();
  }
  if (action === "import") {
    const txt = prompt("Paste lyrics"); if (!txt) return; el("editor").value = txt; onEdit({target: el("editor")});
  }
}

function buildSongBrain(sections) {
  const all = sections.flatMap(s => s.lines.map(l => l.text));
  return {
    oneSentenceSummary: `${sections.length} sections, ${all.length} lines`,
    recurringImages: ["night", "light", "ghost", "rain"].filter((w) => all.join(" ").toLowerCase().includes(w)),
    rhymePalette: sections.flatMap(s => s.lines.map(l => l.endingSound)).filter(Boolean).slice(0, 15),
    sectionSummaries: Object.fromEntries(sections.map(s => [s.id, `${s.lines.length} lines in ${s.type}`]))
  };
}

async function saveSong(reason) {
  currentSong.genre = el("genreInput").value;
  currentSong.mood = el("moodInput").value.split(",").map(s => s.trim()).filter(Boolean);
  currentSong.theme = el("themeInput").value;
  saveVersion(reason);
  const tx = db.transaction("songs", "readwrite");
  tx.objectStore("songs").put(currentSong);
  await tx.complete;
}

function saveVersion(reason) {
  const v = { at: new Date().toISOString(), reason, text: el("editor").value };
  versionSnapshots.push(v);
  currentSong.versions = versionSnapshots;
}

function renderSuggestions(items) { el("suggestionStrip").innerHTML = items.slice(0, 5).map((i) => `<span class='chip'>${i}</span>`).join(""); }
function renderAi(lines, cached) { el("details").textContent = `${cached ? "[cached]\n" : ""}${lines.join("\n")}`; }
function getCurrentLine() { const lines = el("editor").value.split("\n"); return lines.at(-1) || ""; }
function el(id) { return document.getElementById(id); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("songs", { keyPath: "id" });
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function loadSong() {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const tx = db.transaction("songs", "readonly");
    const req = tx.objectStore("songs").getAll();
    req.onsuccess = () => resolve(req.result?.[0] || null);
    req.onerror = () => resolve(null);
  });
}

function hydrate() {
  el("title").value = currentSong.title;
  el("editor").value = currentSong.sections?.map((s) => `${s.type}\n${s.text}`).join("\n\n") || "";
  versionSnapshots = currentSong.versions || [];
}
