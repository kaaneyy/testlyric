const DB_NAME = "testlyric_studio_v2";
const AI_GUARDRAIL = "Do not change, replace, or rewrite any words in the user's lyrics without explicitly asking first. Return suggestions as proposals only. The app will ask the user before applying anything.";
const DEFAULT_TEXT = "Verse 1\nI kept your shadow in the hallway light\nI say I'm fine but I still look twice\n\nChorus\nI keep dancing with the ghost of us\nActing like the quiet doesn't open up";

let db;
let autosaveTimer;
let currentSong = createSong();
let selectedRange = { start: 0, end: 0, lineIndex: 0 };
let pendingProposal = null;
const sessionApiKeys = { openai: "", claude: "", deepseek: "" };

const rhymeBank = {
  light: ["night", "fight", "sight", "bite", "satellite", "ignite"],
  twice: ["ice", "nice", "price", "advice", "device", "sacrifice"],
  us: ["trust", "dust", "rush", "crush", "adjust"],
  up: ["cup", "enough", "rough", "tough", "love"],
  fine: ["line", "sign", "mine", "shine", "decline", "design"],
  gone: ["phone", "alone", "stone", "home", "unknown"]
};
const wordplayBank = {
  light: ["spotlight", "make light of it", "light work", "ignite", "not heavy"],
  ghost: ["haunted", "transparent", "seen through", "spirit", "left on read"],
  fine: ["fine print", "paying a fine", "fine line", "fine by design"],
  shadow: ["followed by the past", "outline", "shade", "silhouette"]
};
const cliches = ["broken heart", "lost without you", "tears fall down", "dancing in the rain", "cold as ice"];
const fillerWords = ["really", "very", "just", "maybe", "kinda", "sorta"];

init();

async function init() {
  bindUi();
  db = await openDb();
  const saved = await loadSong();
  currentSong = saved || currentSong;
  hydrate();
  refreshAnalysis();
}

function bindUi() {
  el("editor").addEventListener("input", onEditorInput);
  el("editor").addEventListener("click", updateSelection);
  el("editor").addEventListener("keyup", updateSelection);
  el("editor").addEventListener("select", updateSelection);
  el("title").addEventListener("input", (event) => {
    currentSong.title = event.target.value;
    queueSave("title edit");
  });
  el("saveBtn").addEventListener("click", () => saveSong("manual save"));
  el("openMenu").addEventListener("click", () => el("menu").classList.remove("hidden"));
  el("closeMenu").addEventListener("click", () => el("menu").classList.add("hidden"));

  el("darkModeBtn").addEventListener("click", toggleDarkMode);
  el("focusModeBtn").addEventListener("click", toggleFocusMode);
  el("learnModeBtn").addEventListener("click", toggleLearnMode);
  el("providerSelect").addEventListener("change", syncProviderDefaults);
  el("clearKeysBtn").addEventListener("click", clearKeys);
  ["genreInput", "moodInput", "themeInput"].forEach((id) => el(id).addEventListener("input", () => queueSave("settings edit")));
  ["openai", "claude", "deepseek"].forEach((provider) => {
    el(`${provider}Key`).addEventListener("input", (event) => {
      sessionApiKeys[provider] = event.target.value;
    });
  });

  document.querySelectorAll("[data-local]").forEach((button) => button.addEventListener("click", () => runLocalTool(button.dataset.local)));
  document.querySelectorAll("[data-ai]").forEach((button) => button.addEventListener("click", () => runAiTool(button.dataset.ai)));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => runAction(button.dataset.action)));

  el("replaceBtn").addEventListener("click", () => applyProposal("replace"));
  el("insertBtn").addEventListener("click", () => applyProposal("insert"));
  el("copyBtn").addEventListener("click", copyProposal);
  el("keepBtn").addEventListener("click", dismissProposal);
  el("dismissBtn").addEventListener("click", dismissProposal);
}

function createSong() {
  return {
    id: crypto.randomUUID(),
    title: "Untitled Song",
    text: DEFAULT_TEXT,
    genre: "",
    mood: "",
    theme: "",
    sections: [],
    memory: {},
    versions: []
  };
}

function onEditorInput() {
  currentSong.text = el("editor").value;
  updateSelection();
  refreshAnalysis();
  queueSave("autosave");
}

function updateSelection() {
  const editor = el("editor");
  selectedRange = getSelectionInfo(editor.value, editor.selectionStart, editor.selectionEnd);
  const selectedText = getTargetText();
  el("selectedLine").textContent = selectedText || "Click or highlight a lyric line.";
  el("lineStats").innerHTML = renderStats(selectedText);
}

function getSelectionInfo(text, start, end) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = text.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lineIndex = text.slice(0, lineStart).split("\n").length - 1;
  return { start, end, lineStart, lineEnd, lineIndex };
}

function getTargetText() {
  const editor = el("editor");
  const highlighted = editor.value.slice(selectedRange.start, selectedRange.end).trim();
  if (highlighted) return highlighted;
  return editor.value.slice(selectedRange.lineStart, selectedRange.lineEnd).trim();
}

function refreshAnalysis() {
  currentSong.sections = detectSections(currentSong.text);
  currentSong.memory = buildMemory(currentSong.text, currentSong.sections);
  renderSuggestions(currentSong.memory);
}

function detectSections(text) {
  const lines = text.split("\n");
  const sections = [];
  let current = { type: "verse", heading: "Verse", lines: [] };
  const push = () => {
    if (current.lines.some((line) => line.trim())) {
      sections.push({ ...current, id: `${current.type}_${sections.length + 1}`, text: current.lines.join("\n") });
    }
  };

  lines.forEach((line) => {
    const match = line.trim().match(/^(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro)(\s+\d+)?$/i);
    if (match) {
      push();
      current = { type: match[1].toLowerCase().replace(/[- ]/g, "_"), heading: line.trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  });
  push();
  return sections;
}

function buildMemory(text, sections) {
  const words = getWords(text);
  const counts = countWords(words.filter((word) => word.length > 3));
  const repeated = Object.entries(counts).filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word);
  const endings = text.split("\n").map((line) => lastWord(line)).filter(Boolean);
  return {
    lineCount: text.split("\n").filter((line) => line.trim()).length,
    sectionCount: sections.length,
    repeatedImages: repeated,
    clichesFound: cliches.filter((phrase) => text.toLowerCase().includes(phrase)),
    fillerFound: [...new Set(words.filter((word) => fillerWords.includes(word)))],
    rhymePalette: [...new Set(endings.map((word) => word.slice(-3)))].slice(0, 10),
    summary: `${sections.length || 1} section(s), ${endings.length} lyric line(s), recurring words: ${repeated.slice(0, 4).join(", ") || "none yet"}.`
  };
}

function renderSuggestions(memory) {
  const target = getTargetText();
  const ending = lastWord(target || currentSong.text);
  const rhymes = findRhymes(ending);
  const ideas = findWordplay(target);
  const chips = [...rhymes.slice(0, 4), ...ideas.slice(0, 3), ...memory.clichesFound.map((item) => `freshen: ${item}`)].slice(0, 8);
  el("suggestionStrip").innerHTML = chips.map((chip) => `<button class="chip" data-action="insert-chip">${escapeHtml(chip)}</button>`).join("") || "<span class='stat'>Write a line to get suggestions</span>";
  el("suggestionStrip").querySelectorAll("[data-action='insert-chip']").forEach((button) => button.addEventListener("click", () => createProposal("local suggestion", getTargetText(), button.textContent)));
  el("details").textContent = `Memory: ${memory.summary}\nWarnings: ${[...memory.clichesFound, ...memory.fillerFound.map((word) => `filler: ${word}`)].join(", ") || "none"}`;
}

function renderStats(text) {
  if (!text) return "<span class='stat'>No line selected</span>";
  return [
    `<span class="stat">${estimateSyllables(text)} syllables</span>`,
    `<span class="stat">${getWords(text).length} words</span>`,
    `<span class="stat">ending: ${escapeHtml(lastWord(text) || "—")}</span>`
  ].join("");
}

function runLocalTool(tool) {
  const target = getTargetText();
  if (tool === "rhymes") return showTextPanel(`Rhymes for "${lastWord(target)}":\n${findRhymes(lastWord(target)).join(" · ") || "No ending word selected."}`);
  if (tool === "syllables") return showTextPanel(`Selected line syllables: ${estimateSyllables(target)}\nTip: choruses often feel tighter when line syllables stay within a 2-count range.`);
  if (tool === "cliches") return showTextPanel(currentSong.memory.clichesFound.length ? `Clichés found:\n${currentSong.memory.clichesFound.join("\n")}` : "No built-in cliché phrases found.");
  if (tool === "structure") return showTextPanel(formatStructure());
}

async function runAiTool(task) {
  const original = getTargetText();
  if (!original && task !== "generate_chorus" && task !== "analyze_structure") {
    showTextPanel("Select or click a line before using this tool.");
    return;
  }
  const approved = confirm("Before this AI request, TestLyric will instruct the AI: do not change any words without asking. Suggestions will appear in review for your approval. Continue?");
  if (!approved) return;

  setAiWaiting(true);
  setSaveState("Asking AI…");
  const prompt = buildAiPrompt(task, original);
  let response;
  try {
    response = await requestAi(prompt, task);
  } catch (error) {
    response = localFallback(task, original);
    showTextPanel(`AI provider was unavailable, so TestLyric used local fallback suggestions.\n\n${error.message}`);
  } finally {
    setAiWaiting(false);
  }
  createProposal(task, original, response);
  setSaveState("AI suggestion ready");
}

function buildAiPrompt(task, target) {
  const isWholeSongTask = ["analyze_structure", "generate_chorus", "full_review", "initial_audit"].includes(task);
  const context = isWholeSongTask ? currentSong.text : target;
  return `${AI_GUARDRAIL}\n\nTask: ${task}\nSong title: ${currentSong.title}\nGenre: ${el("genreInput").value || "unspecified"}\nMood: ${el("moodInput").value || "unspecified"}\nTheme: ${el("themeInput").value || "unspecified"}\nSong memory: ${JSON.stringify(currentSong.memory)}\nContext type: ${isWholeSongTask ? "whole_song" : "selected_lyric"}\nContext:\n${context || "none"}\n\nReturn strict JSON only with these keys:\n{\n  "updatedLyric": "the replacement lyric text, or the exact original lyric if no lyric change is recommended",\n  "keepOriginal": true or false,\n  "explanation": "detailed explanation, reasoning, double meaning, structure critique, or coaching notes",\n  "changeSummary": "short summary of what changed or why no change is needed",\n  "suggestedActions": [{ "label": "short button label", "type": "replace|insert|review", "text": "optional lyric or review note" }]\n}\nDo not put explanations in updatedLyric. If the task is analysis, full_review, initial_audit, or double meanings and no replacement lyric is needed, keep updatedLyric identical to the selected lyric and put all analysis in explanation. For initial_audit, inspect the full song for empty sections, weak lines, grammar issues, repeated filler, missing chorus/hook, and return suggestedActions for one-click review/fix ideas.`;
}

async function requestAi(prompt, task) {
  const provider = el("providerSelect").value;
  const model = el("modelInput").value.trim();
  if (provider === "local") return localFallback(task, getTargetText());
  const key = sessionApiKeys[provider];
  if (!key) throw new Error(`Missing ${provider} API key. Choose Local mock or enter a session-only key.`);

  if (provider === "claude") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: model || "claude-3-5-haiku-latest", max_tokens: 300, messages: [{ role: "user", content: prompt }] })
    });
    return parseClaudeResponse(response);
  }

  const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || (provider === "deepseek" ? "deepseek-v4-flash" : "gpt-4o-mini"), messages: [{ role: "system", content: AI_GUARDRAIL }, { role: "user", content: prompt }], temperature: 0.7 })
  });
  return parseOpenAiResponse(response);
}

async function parseOpenAiResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "AI request failed.");
  return parseAiPayload(data.choices?.[0]?.message?.content?.trim() || "{}");
}

async function parseClaudeResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude request failed.");
  return parseAiPayload(data.content?.map((part) => part.text).join("\n").trim() || "{}");
}

function parseAiPayload(raw) {
  const cleaned = String(raw).replace(/^```json|```$/g, "").trim();
  try {
    return normalizeAiResult(JSON.parse(cleaned), getTargetText());
  } catch {
    return makeAiResult(getTargetText(), true, cleaned, "Kept lyric; AI returned explanation text instead of structured JSON.");
  }
}

function normalizeAiResult(value, original) {
  if (typeof value === "string") return makeAiResult(original, true, value, "Kept lyric; explanation only.");
  return makeAiResult(
    value.updatedLyric || original,
    Boolean(value.keepOriginal),
    value.explanation || "Review the proposal before applying it.",
    value.changeSummary || (value.keepOriginal ? "Kept original lyric." : "Proposed an updated lyric."),
    Array.isArray(value.suggestedActions) ? value.suggestedActions : []
  );
}

function makeAiResult(updatedLyric, keepOriginal, explanation, changeSummary, suggestedActions = []) {
  return { updatedLyric, keepOriginal, explanation, changeSummary, suggestedActions };
}

function localFallback(task, original) {
  const ending = lastWord(original);
  const rhymes = findRhymes(ending).slice(0, 3).join(" / ");
  if (task === "next_lines") return makeAiResult(`${original}\nMaybe I only miss the version I designed`, false, `Adds a follow-up line that keeps the emotional subject while opening a new rhyme path. Ending options: ${rhymes || ending}.`, "Added a possible next line.");
  if (task === "wordplay") return makeAiResult(original, true, findWordplay(original).join(" · ") || `Try turning "${ending}" into a second meaning or phrase flip.`, "Kept lyric; provided wordplay notes.");
  if (task === "double_meanings") return makeAiResult(original, true, `Surface reading: the line says what happens literally. Hidden reading: key words like "${ending || "the ending"}" can also point to emotional status, power, ownership, or movement. Keep the lyric if you like the ambiguity; only rewrite if you want the double meaning to be more obvious.`, "Kept lyric; explained double meaning.");
  if (task === "generate_chorus") return makeAiResult("Chorus\nI say I'm fine but the room knows better\nYour name still pulls like a thread in my sweater", false, "Uses the whole song context to generate a compact hook with repeatable emotional language and a tactile image.", "Generated chorus proposal.");
  if (task === "analyze_structure") return makeAiResult(original, true, `Structure review from full song:\n${formatStructure()}`, "Kept lyric; provided structure review.", [{ label: "Review structure map", type: "review", text: formatStructure() }]);
  if (task === "full_review") return makeAiResult(original, true, `Full-song review:\n${currentSong.memory.summary}\nObvious checks: confirm chorus appears, vary repeated images, trim filler, and make the strongest hook phrase repeat intentionally.`, "Kept lyric; provided full-song feedback.", [{ label: "Show song memory", type: "review", text: JSON.stringify(currentSong.memory, null, 2) }]);
  if (task === "initial_audit") return makeAiResult(original, true, `Initial test results:\n- Sections found: ${currentSong.sections.length || 0}.\n- Lines found: ${currentSong.memory.lineCount || 0}.\n- Clichés: ${currentSong.memory.clichesFound.join(", ") || "none"}.\n- Filler: ${currentSong.memory.fillerFound.join(", ") || "none"}.\n- Empty/missing spots: ${currentSong.sections.some((section) => section.lines.filter((line) => line.trim()).length < 2) ? "one or more sections look underfilled" : "none obvious"}.`, "Initial audit complete.", [{ label: "Generate chorus idea", type: "insert", text: "Chorus\nI say I'm fine but the room knows better" }, { label: "Review structure", type: "review", text: formatStructure() }]);
  return makeAiResult(`${original}\nAlternative direction: sharpen the image and keep an ending rhyme near ${rhymes || ending}.`, false, "Provides an optional direction without overwriting the original. Review before inserting or replacing.", "Suggested a sharper direction.");
}

function createProposal(task, original, response) {
  const parsed = normalizeAiResult(response, original);
  pendingProposal = {
    task,
    original,
    suggestion: cleanSuggestion(parsed.updatedLyric),
    explanation: parsed.explanation,
    changeSummary: parsed.changeSummary,
    keepOriginal: parsed.keepOriginal,
    suggestedActions: parsed.suggestedActions || [],
    range: { ...selectedRange }
  };
  showReview();
}

function showReview() {
  el("aiReview").classList.remove("hidden");
  el("reviewPrompt").textContent = `Task: ${pendingProposal.task}. ${pendingProposal.changeSummary} Nothing changes unless you choose Replace or Insert.`;
  el("diffView").innerHTML = renderDiff(pendingProposal.original, pendingProposal.suggestion);
  el("explanationView").textContent = pendingProposal.explanation || "No explanation returned.";
  renderSuggestedActions();
  el("aiReview").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderSuggestedActions() {
  const actions = pendingProposal?.suggestedActions || [];
  el("actionView").innerHTML = actions.map((action, index) => `<button data-action-index="${index}">${escapeHtml(action.label || "Review action")}</button>`).join("");
  el("actionView").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => runSuggestedAction(actions[Number(button.dataset.actionIndex)])));
}

function runSuggestedAction(action) {
  if (!action) return;
  if (action.type === "insert") {
    createProposal("suggested action", getTargetText(), makeAiResult(action.text || "", false, "One-click action generated from the initial audit.", action.label || "Suggested action"));
  } else {
    showTextPanel(action.text || action.label || "No action details.");
  }
}

function renderDiff(original, suggestion) {
  return `<div class="diff-row"><span class="diff-label">Original</span><div>${tokenize(original).map((token) => `<span class="old-token">${escapeHtml(token)}</span>`).join(" ") || "—"}</div></div>
<div class="diff-row"><span class="diff-label">Proposal</span><div>${tokenize(suggestion).map((token) => `<span class="new-token">${escapeHtml(token)}</span>`).join(" ")}</div></div>`;
}

function applyProposal(mode) {
  if (!pendingProposal) return;
  const editor = el("editor");
  const text = editor.value;
  const replaceStart = pendingProposal.range.start === pendingProposal.range.end ? pendingProposal.range.lineStart : pendingProposal.range.start;
  const replaceEnd = pendingProposal.range.start === pendingProposal.range.end ? pendingProposal.range.lineEnd : pendingProposal.range.end;
  let nextText = text;
  if (mode === "replace") nextText = text.slice(0, replaceStart) + pendingProposal.suggestion + text.slice(replaceEnd);
  if (mode === "insert") nextText = text.slice(0, pendingProposal.range.lineEnd) + "\n" + pendingProposal.suggestion + text.slice(pendingProposal.range.lineEnd);
  editor.value = nextText;
  currentSong.text = nextText;
  saveVersion(`AI ${mode}: ${pendingProposal.task}`);
  refreshAnalysis();
  queueSave(`AI ${mode}`);
  dismissProposal();
}

async function copyProposal() {
  if (!pendingProposal) return;
  await navigator.clipboard.writeText(pendingProposal.suggestion);
  showTextPanel("Suggestion copied to clipboard.");
}

function dismissProposal() {
  pendingProposal = null;
  el("aiReview").classList.add("hidden");
  showTextPanel("Kept original. No lyric text changed.");
}

function runAction(action) {
  if (action === "show-structure") return showTextPanel(formatStructure());
  if (action === "show-memory") return showTextPanel(JSON.stringify(currentSong.memory, null, 2));
  if (action === "show-versions") return showTextPanel(formatVersions());
  if (action === "restore-version") return restoreLatestVersion();
  if (action === "export") return exportLyrics();
  if (action === "import") return importLyrics();
}

function formatStructure() {
  return currentSong.sections.map((section, index) => `${index + 1}. ${section.heading || section.type}: ${section.lines.filter((line) => line.trim()).length} lines`).join("\n") || "No sections detected yet.";
}

function formatVersions() {
  return currentSong.versions.slice(-12).map((version) => `${new Date(version.at).toLocaleString()} — ${version.reason}`).join("\n") || "No versions saved yet.";
}

function restoreLatestVersion() {
  const previous = currentSong.versions.at(-2);
  if (!previous) return showTextPanel("No previous version to restore.");
  el("editor").value = previous.text;
  currentSong.text = previous.text;
  saveVersion("restored previous version");
  refreshAnalysis();
  queueSave("restore");
}

function importLyrics() {
  const text = prompt("Paste lyrics to import. This replaces the editor after saving a version.");
  if (!text) return;
  saveVersion("before import");
  currentSong.text = text;
  el("editor").value = text;
  refreshAnalysis();
  queueSave("import");
}

function exportLyrics() {
  const blob = new Blob([currentSong.text], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentSong.title || "song"}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function queueSave(reason) {
  clearTimeout(autosaveTimer);
  setSaveState("Unsaved changes…");
  autosaveTimer = setTimeout(() => saveSong(reason), 700);
}

async function saveSong(reason) {
  currentSong.title = el("title").value;
  currentSong.text = el("editor").value;
  currentSong.genre = el("genreInput").value;
  currentSong.mood = el("moodInput").value;
  currentSong.theme = el("themeInput").value;
  saveVersion(reason);
  const transaction = db.transaction("songs", "readwrite");
  transaction.objectStore("songs").put(currentSong);
  setSaveState("Saved locally");
}

function saveVersion(reason) {
  const last = currentSong.versions.at(-1);
  if (last && last.text === currentSong.text && last.reason === reason) return;
  currentSong.versions.push({ at: new Date().toISOString(), reason, text: currentSong.text });
  currentSong.versions = currentSong.versions.slice(-50);
}

function syncProviderDefaults() {
  const provider = el("providerSelect").value;
  const defaults = { local: "local", openai: "gpt-4o-mini", claude: "claude-3-5-haiku-latest", deepseek: "deepseek-v4-flash" };
  el("modelInput").value = defaults[provider];
}

function clearKeys() {
  sessionApiKeys.openai = "";
  sessionApiKeys.claude = "";
  sessionApiKeys.deepseek = "";
  el("openaiKey").value = "";
  el("claudeKey").value = "";
  el("deepseekKey").value = "";
  showTextPanel("API keys cleared from this tab's memory. They were never saved by TestLyric.");
}

function toggleDarkMode() {
  const enabled = !document.body.classList.contains("dark");
  document.body.classList.toggle("dark", enabled);
  el("darkModeBtn").setAttribute("aria-pressed", String(enabled));
}
function toggleFocusMode() {
  const enabled = !document.body.classList.contains("focus");
  document.body.classList.toggle("focus", enabled);
  el("focusModeBtn").setAttribute("aria-pressed", String(enabled));
}
function toggleLearnMode() {
  const visible = el("tips").hidden;
  el("tips").hidden = !visible;
  el("learnModeBtn").setAttribute("aria-pressed", String(visible));
}

function findRhymes(word) {
  if (!word) return [];
  const key = word.toLowerCase();
  if (rhymeBank[key]) return rhymeBank[key];
  const suffix = key.slice(-2);
  return Object.keys(rhymeBank).flatMap((bankKey) => rhymeBank[bankKey]).filter((candidate) => candidate.endsWith(suffix)).slice(0, 8);
}
function findWordplay(text) {
  const words = getWords(text);
  return [...new Set(words.flatMap((word) => wordplayBank[word] || []))];
}
function estimateSyllables(text) {
  return getWords(text).reduce((sum, word) => sum + Math.max(1, (word.match(/[aeiouy]+/g) || []).length - (word.endsWith("e") ? 1 : 0)), 0);
}
function getWords(text) { return (text.toLowerCase().match(/[a-z']+/g) || []); }
function countWords(words) { return words.reduce((counts, word) => ({ ...counts, [word]: (counts[word] || 0) + 1 }), {}); }
function lastWord(text) { return (text.toLowerCase().match(/[a-z']+/g) || []).at(-1) || ""; }
function tokenize(text) { return text.split(/\s+/).filter(Boolean); }
function cleanSuggestion(text) { return String(text).replace(/^```[a-z]*|```$/g, "").trim(); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]); }
function showTextPanel(text) { el("details").textContent = text; }
function setSaveState(text) { el("saveState").textContent = text; }
function setAiWaiting(waiting) { el("aiStatus").classList.toggle("hidden", !waiting); el("aiOverlay").classList.toggle("hidden", !waiting); }
function el(id) { return document.getElementById(id); }

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("songs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function loadSong() {
  return new Promise((resolve) => {
    const transaction = db.transaction("songs", "readonly");
    const request = transaction.objectStore("songs").getAll();
    request.onsuccess = () => resolve(request.result?.[0] || null);
    request.onerror = () => resolve(null);
  });
}
function hydrate() {
  el("title").value = currentSong.title;
  el("editor").value = currentSong.text || DEFAULT_TEXT;
  el("genreInput").value = currentSong.genre || "";
  el("moodInput").value = currentSong.mood || "";
  el("themeInput").value = currentSong.theme || "";
  updateSelection();
  setSaveState("Saved locally");
}
