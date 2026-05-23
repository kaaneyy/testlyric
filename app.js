const dbName = "testlyric_db";
let db;
let currentSong = createSong();
let versionSnapshots = [];
let selectedLineIndex = -1;
let pendingProposal = null;
const sessionApiKeys = { openai: "", claude: "", deepseek: "" };

const rhymeMap = { light: ["night", "fight", "sight", "bite", "satellite"], you: ["blue", "true", "through", "do", "new"] };
const wordplayMap = { light: ["spotlight", "ignite", "light work"], fall: ["free fall", "autumn leaves", "gravity pull"] };

init();
async function init() { bindUi(); await openDb(); const saved = await loadSong(); if (saved) currentSong = saved; hydrate(); analyzeLocal(); }

function bindUi() {
  el("editor").addEventListener("input", onEdit);
  el("editor").addEventListener("click", updateSelectedLineFromCaret);
  el("editor").addEventListener("keyup", updateSelectedLineFromCaret);
  el("title").addEventListener("input", (e) => currentSong.title = e.target.value);
  el("saveBtn").addEventListener("click", () => saveSong("manual save"));
  el("openMenu").addEventListener("click", () => el("menu").classList.remove("hidden"));
  el("closeMenu").addEventListener("click", () => el("menu").classList.add("hidden"));

  el("darkModeBtn").addEventListener("click", () => toggleDarkMode());
  el("focusModeBtn").addEventListener("click", () => toggleFocusMode());
  el("learnModeBtn").addEventListener("click", () => toggleLearnMode());

  el("openaiKey").addEventListener("input", (e) => sessionApiKeys.openai = e.target.value);
  el("claudeKey").addEventListener("input", (e) => sessionApiKeys.claude = e.target.value);
  el("deepseekKey").addEventListener("input", (e) => sessionApiKeys.deepseek = e.target.value);
  el("clearKeysBtn").addEventListener("click", clearKeys);

  document.querySelectorAll("[data-ai]").forEach((btn) => btn.addEventListener("click", () => runAiTool(btn.dataset.ai)));
  document.querySelectorAll("[data-action]").forEach((btn) => btn.addEventListener("click", () => runAction(btn.dataset.action)));

  el("replaceBtn").addEventListener("click", () => applyProposal("replace"));
  el("insertBtn").addEventListener("click", () => applyProposal("insert"));
  el("dismissBtn").addEventListener("click", () => applyProposal("dismiss"));
}

function createSong() { return { id: crypto.randomUUID(), title: "Untitled Song", sections: [], memory: {}, versions: [] }; }

function onEdit(e) {
  currentSong.sections = detectSections(e.target.value);
  currentSong.memory = { updatedAt: new Date().toISOString() };
  analyzeLocal();
  setTimeout(() => saveSong("autosave"), 1200);
}

function updateSelectedLineFromCaret() {
  const t = el("editor");
  const before = t.value.slice(0, t.selectionStart);
  selectedLineIndex = before.split("\n").length - 1;
  const line = getLineByIndex(selectedLineIndex);
  el("details").textContent = `Selected line ${selectedLineIndex + 1}: ${line || "(empty)"}`;
}

function getLineByIndex(idx) { return el("editor").value.split("\n")[idx] ?? ""; }

function analyzeLocal() {
  const words = (el("editor").value.toLowerCase().match(/[a-z']+/g) || []);
  const lastWord = words.at(-1) || "";
  const rhymes = rhymeMap[lastWord] || [lastWord + "-ish", "night", "time"];
  const wordplay = wordplayMap[lastWord] || [];
  el("suggestionStrip").innerHTML = [...rhymes.slice(0, 3), ...wordplay.slice(0, 2)].map((w) => `<span class='chip'>${w}</span>`).join("");
}

function runAiTool(task) {
  if (selectedLineIndex < 0) updateSelectedLineFromCaret();
  const originalLine = getLineByIndex(selectedLineIndex);
  if (!originalLine && task === "improve_line") return renderDetails("Pick a line first.");

  const consent = confirm("Before AI request: do not change any words without asking. Continue?");
  if (!consent) return;

  const proposal = mockAi(task, originalLine);
  pendingProposal = { task, lineIndex: selectedLineIndex, original: originalLine, changed: proposal };
  showReview(pendingProposal);
}

function mockAi(task, line) {
  if (task === "improve_line") return line.replace(/\b(sad|bad|lonely)\b/gi, "heavy");
  if (task === "wordplay") return `${line} / (double image: orbit & gravity)`;
  if (task === "double_meanings") return `${line} (surface + hidden meaning)`;
  if (task === "generate_chorus") return "I say I'm good while I ghost in your light";
  if (task === "analyze_structure") return "Structure idea: verse -> pre-chorus -> chorus repeat with one line changed.";
  return line;
}

function showReview(p) {
  el("aiReview").classList.remove("hidden");
  el("reviewPrompt").textContent = `Task: ${p.task}. Original is preserved unless you accept replace/insert.`;
  el("diffView").innerHTML = renderWordDiff(p.original, p.changed);
}

function renderWordDiff(oldLine, newLine) {
  const oldWords = oldLine.split(/\s+/);
  const newWords = newLine.split(/\s+/);
  return `Old: <span class="old">${oldWords.join(" ")}</span>\nNew: <span class="new">${newWords.join(" ")}</span>`;
}

function applyProposal(mode) {
  if (!pendingProposal) return;
  if (mode === "dismiss") { renderDetails("Kept original line only."); hideReview(); return; }

  const lines = el("editor").value.split("\n");
  if (mode === "replace") lines[pendingProposal.lineIndex] = pendingProposal.changed;
  if (mode === "insert") lines.splice(pendingProposal.lineIndex + 1, 0, pendingProposal.changed);
  el("editor").value = lines.join("\n");
  onEdit({ target: el("editor") });
  saveVersion(`AI ${mode}: ${pendingProposal.task}`);
  hideReview();
}

function hideReview() { pendingProposal = null; el("aiReview").classList.add("hidden"); }
function runAction(action) {
  if (action === "show-structure") return renderDetails(analyzeStructure());
  if (action === "show-versions") return renderDetails(versionSnapshots.slice(-10).map((v) => `${v.at} ${v.reason}`).join("\n") || "No versions yet.");
  if (action === "export") return exportLyrics();
  if (action === "import") {
    const txt = prompt("Paste lyrics");
    if (!txt) return;
    el("editor").value = txt;
    onEdit({ target: el("editor") });
  }
}
function analyzeStructure() { return `Detected sections: ${detectSections(el("editor").value).map((s) => s.type).join(", ") || "verse"}`; }
function detectSections(text) { return text.split(/\n{2,}/).map((chunk, i) => ({ id: `section_${i+1}`, type: /chorus/i.test(chunk) ? "chorus" : "verse", text: chunk })); }

async function saveSong(reason) {
  saveVersion(reason);
  const tx = db.transaction("songs", "readwrite");
  tx.objectStore("songs").put(currentSong);
}
function saveVersion(reason) { const v = { at: new Date().toISOString(), reason, text: el("editor").value }; versionSnapshots.push(v); currentSong.versions = versionSnapshots; }

function toggleDarkMode() { const enabled = !document.body.classList.contains("dark"); document.body.classList.toggle("dark", enabled); el("darkModeBtn").setAttribute("aria-pressed", String(enabled)); }
function toggleFocusMode() { const enabled = !document.body.classList.contains("focus"); document.body.classList.toggle("focus", enabled); el("focusModeBtn").setAttribute("aria-pressed", String(enabled)); }
function toggleLearnMode() { const tips = el("tips"); const show = tips.style.display !== "none"; tips.style.display = show ? "none" : "block"; el("learnModeBtn").setAttribute("aria-pressed", String(!show)); }
function clearKeys() { sessionApiKeys.openai = ""; sessionApiKeys.claude = ""; sessionApiKeys.deepseek = ""; el("openaiKey").value = ""; el("claudeKey").value = ""; el("deepseekKey").value = ""; renderDetails("API keys cleared. They were only held in tab memory."); }

function renderDetails(msg) { el("details").textContent = msg; }
function openDb() { return new Promise((resolve, reject) => { const req = indexedDB.open(dbName, 1); req.onupgradeneeded = () => req.result.createObjectStore("songs", { keyPath: "id" }); req.onsuccess = () => { db = req.result; resolve(); }; req.onerror = () => reject(req.error); }); }
function loadSong() { return new Promise((resolve) => { const tx = db.transaction("songs", "readonly"); const req = tx.objectStore("songs").getAll(); req.onsuccess = () => resolve(req.result?.[0] || null); req.onerror = () => resolve(null); }); }
function hydrate() { el("title").value = currentSong.title; el("editor").value = currentSong.sections?.map((s) => s.text).join("\n\n") || ""; versionSnapshots = currentSong.versions || []; updateSelectedLineFromCaret(); }
function exportLyrics() { const blob = new Blob([el("editor").value], { type: "text/plain" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${currentSong.title || "song"}.txt`; a.click(); }
function el(id) { return document.getElementById(id); }
