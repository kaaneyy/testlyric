const DB_NAME = "testlyric_studio_v2";
const AI_GUARDRAIL = "Do not change, replace, or rewrite any words in the user's lyrics without explicitly asking first. Return suggestions as proposals only. The app will ask the user before applying anything.";
const DEFAULT_TEXT = "Verse 1\nI kept your shadow in the hallway light\nI say I'm fine but I still look twice\n\nChorus\nI keep dancing with the ghost of us\nActing like the quiet doesn't open up";
const WHOLE_CONTEXT_TASKS = ["analyze_structure", "generate_chorus", "full_review", "initial_audit"];
const WHOLE_REPLACE_TASKS = ["initial_audit"];

let db;
let autosaveTimer;
let currentSong = createSong();
let selectedRange = { start: 0, end: 0, lineStart: 0, lineEnd: 0, lineIndex: 0 };
let pendingProposal = null;
let lastDetailsText = "";

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
  const editor = el("editor");
  editor.addEventListener("input", onEditorInput);
  editor.addEventListener("paste", () => setTimeout(() => markInitialAnalysisNeeded("Song pasted. Click Initial analysis before editing."), 0));
  editor.addEventListener("click", updateSelection);
  editor.addEventListener("keyup", updateSelection);
  editor.addEventListener("select", updateSelection);

  el("title").addEventListener("input", (event) => {
    currentSong.title = event.target.value;
    queueSave("title edit");
  });

  el("saveBtn").addEventListener("click", () => saveSong("manual save"));
  el("openMenu").addEventListener("click", openSettings);
  el("closeMenu").addEventListener("click", closeSettings);
  el("menu").addEventListener("click", (event) => {
    if (event.target === el("menu")) closeSettings();
  });

  el("promptAnalysisBtn").addEventListener("click", () => runAiTool("initial_audit"));
  el("closeDetails").addEventListener("click", closeDetails);
  el("detailsModal").addEventListener("click", (event) => {
    if (event.target === el("detailsModal")) closeDetails();
  });
  el("copyDetailsBtn").addEventListener("click", copyDetails);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettings();
      closeDetails();
    }
  });

  el("darkModeBtn").addEventListener("click", toggleDarkMode);
  el("focusModeBtn").addEventListener("click", toggleFocusMode);
  el("learnModeBtn").addEventListener("click", toggleLearnMode);
  el("providerSelect").addEventListener("change", syncProviderDefaults);
  el("clearKeysBtn").addEventListener("click", clearKeys);

  ["genreInput", "moodInput", "themeInput"].forEach((id) => {
    el(id).addEventListener("input", () => queueSave("settings edit"));
  });

  ["openai", "claude", "deepseek"].forEach((provider) => {
    el(`${provider}Key`).addEventListener("input", (event) => {
      sessionApiKeys[provider] = event.target.value;
    });
  });

  document.querySelectorAll("[data-local]").forEach((button) => {
    button.addEventListener("click", () => runLocalTool(button.dataset.local));
  });
  document.querySelectorAll("[data-ai]").forEach((button) => {
    button.addEventListener("click", () => runAiTool(button.dataset.ai));
  });
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.action));
  });

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
    versions: [],
    needsInitialAnalysis: false,
    analysisCompletedAt: ""
  };
}

function onEditorInput(event) {
  currentSong.text = el("editor").value;
  updateSelection();
  refreshAnalysis();

  if (!currentSong.text.trim()) {
    clearInitialAnalysisPrompt();
  } else if (event?.inputType === "insertFromPaste" || event?.inputType === "insertReplacementText") {
    markInitialAnalysisNeeded("Song pasted. Click Initial analysis before editing.");
  } else if (!currentSong.analysisCompletedAt && looksLikeFullSong(currentSong.text)) {
    markInitialAnalysisNeeded("Run initial analysis before editing this song.");
  }

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
    const match = line.trim().match(/^(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro|final chorus)(\s+\d+)?$/i);
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
  const repeated = Object.entries(counts)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
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
  el("suggestionStrip").innerHTML = chips.map((chip) => `<button class="chip" data-chip="${escapeAttr(chip)}">${escapeHtml(chip)}</button>`).join("") || "<span class='stat'>Write a line to get suggestions</span>";
  el("suggestionStrip").querySelectorAll("[data-chip]").forEach((button) => {
    button.addEventListener("click", () => createProposal("local suggestion", getTargetText(), makeAiResult(button.textContent, false, "Local suggestion based on the selected line.", "Suggested a quick option.")));
  });
  setDetailsText(`Memory: ${memory.summary}\nWarnings: ${[...memory.clichesFound, ...memory.fillerFound.map((word) => `filler: ${word}`)].join(", ") || "none"}`);
}

function renderStats(text) {
  if (!text) return "<span class='stat'>No line selected</span>";
  return [
    `<span class="stat">${estimateSyllables(text)} syllables</span>`,
    `<span class="stat">${getWords(text).length} words</span>`,
    `<span class="stat">ending: ${escapeHtml(lastWord(text) || "-")}</span>`
  ].join("");
}

function runLocalTool(tool) {
  const target = getTargetText();
  if (tool === "rhymes") return showTextPanel(`Rhymes for "${lastWord(target)}":\n${findRhymes(lastWord(target)).join(" / ") || "No ending word selected."}`);
  if (tool === "syllables") return showTextPanel(`Selected line syllables: ${estimateSyllables(target)}\nTip: choruses often feel tighter when line syllables stay within a 2-count range.`);
  if (tool === "cliches") return showTextPanel(currentSong.memory.clichesFound.length ? `Cliches found:\n${currentSong.memory.clichesFound.join("\n")}` : "No built-in cliche phrases found.");
  if (tool === "structure") return showTextPanel(formatStructure());
}

async function runAiTool(task) {
  const contextTask = WHOLE_CONTEXT_TASKS.includes(task);
  const replaceWholeSong = WHOLE_REPLACE_TASKS.includes(task);
  const original = contextTask ? currentSong.text : getTargetText();
  if (!original && !contextTask) {
    showTextPanel("Select or click a line before using this tool.");
    return;
  }

  const confirmText = task === "initial_audit"
    ? "Run initial song analysis now? TestLyric will map structure, hook strength, weak spots, rhyme palette, and editing priorities. Nothing changes unless you approve a proposal."
    : "TestLyric will ask AI for a proposal only. Your lyrics will not change unless you approve the result. Continue?";
  const approved = confirm(confirmText);
  if (!approved) return;

  setAiWaiting(true, task);
  setSaveState(task === "initial_audit" ? "Analyzing song..." : "Asking AI...");
  const prompt = buildAiPrompt(task, original);
  let response;
  try {
    response = await requestAi(prompt, task);
  } catch (error) {
    response = localFallback(task, original);
    showTextPanel(`AI provider was unavailable, so TestLyric used local fallback suggestions.\n\n${error.message}`);
  } finally {
    setAiWaiting(false, task);
  }

  const reviewOriginal = replaceWholeSong ? currentSong.text : (getTargetText() || original);
  createProposal(task, reviewOriginal, response, replaceWholeSong);
  if (task === "initial_audit") setInitialAnalysisComplete();
  setSaveState(task === "initial_audit" ? "Initial analysis ready" : "AI suggestion ready");
}

function buildAiPrompt(task, target) {
  const contextTask = WHOLE_CONTEXT_TASKS.includes(task);
  const context = contextTask ? currentSong.text : target;
  const auditInstructions = task === "initial_audit" ? "\nFor initial_audit, act as a practical song editor. Analyze the whole song before line editing. In explanation, include: structure map, missing or underfilled sections, likely hook, strongest lines, weakest lines, rhyme/meter notes, cliche/filler warnings, and 3 editing priorities. If a cleaner section map would help, put it in updatedLyric; otherwise keep updatedLyric identical to the original. Suggested actions should be useful song-editing next steps." : "";
  return `${AI_GUARDRAIL}\n\nTask: ${task}\nSong title: ${currentSong.title}\nGenre: ${el("genreInput").value || "unspecified"}\nMood: ${el("moodInput").value || "unspecified"}\nTheme: ${el("themeInput").value || "unspecified"}\nSong memory: ${JSON.stringify(currentSong.memory)}\nContext type: ${contextTask ? "whole_song" : "selected_lyric"}\nContext:\n${context || "none"}\n\nReturn strict JSON only with these keys:\n{\n  "updatedLyric": "the replacement lyric text, or the exact original lyric if no lyric change is recommended",\n  "keepOriginal": true or false,\n  "explanation": "detailed explanation, reasoning, double meaning, structure critique, or coaching notes",\n  "changeSummary": "short summary of what changed or why no change is needed",\n  "suggestedActions": [{ "label": "short button label", "type": "replace|insert|review", "text": "optional lyric or review note" }]\n}\nDo not put explanations in updatedLyric. If the task is analysis, full_review, initial_audit, or double meanings and no replacement lyric is needed, keep updatedLyric identical to the selected lyric and put all analysis in explanation.${auditInstructions}`;
}

async function requestAi(prompt, task) {
  const provider = el("providerSelect").value;
  const model = el("modelInput").value.trim();
  const original = WHOLE_CONTEXT_TASKS.includes(task) ? currentSong.text : getTargetText();
  const maxTokens = task === "initial_audit" ? 900 : 420;

  if (provider === "local") return localFallback(task, original);
  const key = sessionApiKeys[provider];
  if (!key) throw new Error(`Missing ${provider} API key. Choose Local mock or enter a session-only key.`);

  if (provider === "claude") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: model || "claude-3-5-haiku-latest", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
    });
    return parseClaudeResponse(response, original);
  }

  const baseUrl = provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model || (provider === "deepseek" ? "deepseek-v4-flash" : "gpt-4o-mini"),
      messages: [{ role: "system", content: AI_GUARDRAIL }, { role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  return parseOpenAiResponse(response, original);
}

async function parseOpenAiResponse(response, original) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "AI request failed.");
  return parseAiPayload(data.choices?.[0]?.message?.content?.trim() || "{}", original);
}

async function parseClaudeResponse(response, original) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Claude request failed.");
  return parseAiPayload(data.content?.map((part) => part.text).join("\n").trim() || "{}", original);
}

function parseAiPayload(raw, original = getTargetText()) {
  const cleaned = String(raw).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return normalizeAiResult(JSON.parse(cleaned), original);
  } catch {
    return makeAiResult(original, true, cleaned, "Kept lyric; AI returned explanation text instead of structured JSON.");
  }
}

function normalizeAiResult(value, original) {
  if (typeof value === "string") return makeAiResult(value, false, "Local proposal generated from the selected lyric.", "Suggested an alternate line.");
  return makeAiResult(
    value?.updatedLyric || original,
    Boolean(value?.keepOriginal),
    value?.explanation || "Review the proposal before applying it.",
    value?.changeSummary || (value?.keepOriginal ? "Kept original lyric." : "Proposed an updated lyric."),
    Array.isArray(value?.suggestedActions) ? value.suggestedActions : []
  );
}

function makeAiResult(updatedLyric, keepOriginal, explanation, changeSummary, suggestedActions = []) {
  return { updatedLyric, keepOriginal, explanation, changeSummary, suggestedActions };
}

function localFallback(task, original) {
  const ending = lastWord(original);
  const rhymes = findRhymes(ending).slice(0, 3).join(" / ");
  if (task === "improve_line") return makeAiResult(sharpenLine(original), false, `Tightens the image while keeping the emotional direction. Possible rhyme path: ${rhymes || ending || "open ending"}.`, "Sharpened the selected line.");
  if (task === "next_lines") return makeAiResult(`${original}\nMaybe I only miss the version I designed`, false, `Adds a follow-up line that keeps the emotional subject while opening a new rhyme path. Ending options: ${rhymes || ending}.`, "Added a possible next line.");
  if (task === "wordplay") return makeAiResult(original, true, findWordplay(original).join(" / ") || `Try turning "${ending || "the ending"}" into a second meaning or phrase flip.`, "Kept lyric; provided wordplay notes.");
  if (task === "double_meanings") return makeAiResult(original, true, `Surface reading: the line says what happens literally.\nHidden reading: key words like "${ending || "the ending"}" can also point to emotional status, power, ownership, or movement.`, "Kept lyric; explained double meaning.");
  if (task === "generate_chorus") return makeAiResult("Chorus\nI say I'm fine but the room knows better\nYour name still pulls like a thread in my sweater", false, "Uses the whole song context to generate a compact hook with repeatable emotional language and a tactile image.", "Generated chorus proposal.");
  if (task === "analyze_structure") return makeAiResult(original, true, `Structure review from full song:\n${formatStructure()}`, "Kept lyric; provided structure review.", [{ label: "Open map", type: "review", text: formatStructure() }]);
  if (task === "full_review") return makeAiResult(original, true, `Full-song review:\n${currentSong.memory.summary}\nConfirm the chorus appears, vary repeated images, trim filler, and make the strongest hook phrase repeat intentionally.`, "Kept lyric; provided full-song feedback.", [{ label: "Song memory", type: "review", text: JSON.stringify(currentSong.memory, null, 2) }]);
  if (task === "initial_audit") return makeAiResult(ensureSongSections(currentSong.text), false, buildInitialAnalysis(currentSong.text), "Initial analysis complete. Review the map and editing priorities.", [{ label: "Structure map", type: "review", text: formatStructure() }, { label: "Song memory", type: "review", text: JSON.stringify(currentSong.memory, null, 2) }, { label: "Use mapped sections", type: "replace", text: ensureSongSections(currentSong.text) }]);
  return makeAiResult(`${original}\nAlternative direction: sharpen the image and keep an ending rhyme near ${rhymes || ending}.`, false, "Provides an optional direction without overwriting the original.", "Suggested a sharper direction.");
}

function buildInitialAnalysis(text) {
  const sections = detectSections(text);
  const memory = buildMemory(text, sections);
  const hasChorus = sections.some((section) => ["chorus", "hook", "final_chorus"].includes(section.type));
  const hasVerse = sections.some((section) => section.type === "verse");
  const underfilled = sections.filter((section) => section.lines.filter((line) => line.trim()).length < 2).map((section) => section.heading || section.type);
  const strongCandidate = text.split("\n").map((line) => line.trim()).filter((line) => line && !/^(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro|final chorus)/i.test(line)).sort((a, b) => b.length - a.length)[0] || "Add one memorable hook line.";
  const warnings = [...memory.clichesFound, ...memory.fillerFound.map((word) => `filler: ${word}`)];
  return [
    "Initial song analysis",
    `Structure: ${formatStructure()}`,
    `Lines: ${memory.lineCount}. Sections: ${memory.sectionCount}.`,
    `Likely hook candidate: ${strongCandidate}`,
    `Missing essentials: ${[!hasVerse && "verse", !hasChorus && "chorus/hook"].filter(Boolean).join(", ") || "none obvious"}`,
    `Underfilled sections: ${underfilled.join(", ") || "none obvious"}`,
    `Rhyme palette: ${memory.rhymePalette.join(", ") || "not enough line endings yet"}`,
    `Repeated images: ${memory.repeatedImages.join(", ") || "none yet"}`,
    `Warnings: ${warnings.join(", ") || "none"}`,
    "Editing priorities:",
    "1. Lock the chorus or hook before polishing verses.",
    "2. Fill any thin sections so every part has a job.",
    "3. Tighten repeated or filler words after the story is clear."
  ].join("\n");
}

function sharpenLine(text) {
  if (!text.trim()) return "New line idea";
  return text
    .replace(/\breally\b/gi, "")
    .replace(/\bvery\b/gi, "")
    .replace(/\bjust\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function createProposal(task, original, response, wholeSongRange = false) {
  const parsed = normalizeAiResult(response, original);
  pendingProposal = {
    task,
    original,
    suggestion: cleanSuggestion(parsed.updatedLyric),
    explanation: parsed.explanation,
    changeSummary: parsed.changeSummary,
    keepOriginal: parsed.keepOriginal,
    suggestedActions: parsed.suggestedActions || [],
    range: wholeSongRange ? { start: 0, end: el("editor").value.length, lineStart: 0, lineEnd: el("editor").value.length, lineIndex: 0 } : { ...selectedRange }
  };
  showReview();
}

function showReview() {
  el("emptyReview").classList.add("hidden");
  el("aiReview").classList.remove("hidden");
  el("reviewPrompt").textContent = `Task: ${pendingProposal.task}. ${pendingProposal.changeSummary} Nothing changes until you choose Replace or Insert.`;
  el("diffView").innerHTML = renderDiff(pendingProposal.original, pendingProposal.suggestion);
  el("explanationView").textContent = pendingProposal.explanation || "No explanation returned.";
  renderSuggestedActions();
}

function renderSuggestedActions() {
  const actions = pendingProposal?.suggestedActions || [];
  el("actionView").innerHTML = actions.map((action, index) => `<button data-action-index="${index}">${escapeHtml(action.label || "Review")}</button>`).join("");
  el("actionView").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => runSuggestedAction(actions[Number(button.dataset.actionIndex)]));
  });
}

function runSuggestedAction(action) {
  if (!action) return;
  if (action.type === "insert") {
    createProposal("suggested action", getTargetText(), makeAiResult(action.text || "", false, "One-click action generated from the audit.", action.label || "Suggested action"));
  } else if (action.type === "replace") {
    createProposal("suggested action", currentSong.text, makeAiResult(action.text || currentSong.text, false, "One-click action generated from the audit.", action.label || "Suggested action"), true);
  } else {
    showTextPanel(action.text || action.label || "No action details.");
  }
}

function renderDiff(original, suggestion) {
  return `<div class="version-block original"><span class="version-label">Original</span><div class="version-text">${escapeHtml(original || "-")}</div></div>
<div class="version-block proposal"><span class="version-label">AI version</span><div class="version-text">${escapeHtml(suggestion || "-")}</div></div>`;
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
  dismissProposal(false);
}

async function copyProposal() {
  if (!pendingProposal) return;
  try {
    await navigator.clipboard.writeText(pendingProposal.suggestion);
    showTextPanel("Suggestion copied to clipboard.");
  } catch {
    showTextPanel(pendingProposal.suggestion);
  }
}

function dismissProposal(showNotice = true) {
  pendingProposal = null;
  el("aiReview").classList.add("hidden");
  el("emptyReview").classList.remove("hidden");
  setSaveState("Kept original");
  if (showNotice) setDetailsText("Kept original. No lyric text changed.");
}

function runAction(action) {
  if (action === "show-structure") return showTextPanel(formatStructure());
  if (action === "show-memory") return showTextPanel(JSON.stringify(currentSong.memory, null, 2));
  if (action === "show-versions") return showTextPanel(formatVersions());
  if (action === "restore-version") return restoreLatestVersion();
  if (action === "export") return exportLyrics();
  if (action === "import") return importLyrics();
}

function ensureSongSections(text) {
  const detected = detectSections(text);
  const byType = detected.reduce((map, section) => {
    if (!map[section.type]) map[section.type] = section.text.trim();
    return map;
  }, {});
  const verseText = byType.verse || text.split("\n").filter((line) => line.trim() && !/^(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro|final chorus)/i.test(line.trim())).slice(0, 4).join("\n");
  const template = [
    ["Verse 1", verseText],
    ["Pre-Chorus", byType.pre_chorus || ""],
    ["Chorus", byType.chorus || byType.hook || ""],
    ["Verse 2", ""],
    ["Bridge", byType.bridge || ""],
    ["Final Chorus", byType.final_chorus || byType.chorus || byType.hook || ""]
  ];
  return template.map(([heading, body]) => `${heading}\n${body}`.trimEnd()).join("\n\n");
}

function formatStructure() {
  return currentSong.sections.map((section, index) => `${index + 1}. ${section.heading || section.type}: ${section.lines.filter((line) => line.trim()).length} lines`).join("\n") || "No sections detected yet.";
}

function formatVersions() {
  return currentSong.versions.slice(-12).map((version) => `${new Date(version.at).toLocaleString()} - ${version.reason}`).join("\n") || "No versions saved yet.";
}

function restoreLatestVersion() {
  const previous = currentSong.versions.at(-2);
  if (!previous) return showTextPanel("No previous version to restore.");
  el("editor").value = previous.text;
  currentSong.text = previous.text;
  markInitialAnalysisNeeded("Restored a previous version. Run initial analysis before editing further.");
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
  markInitialAnalysisNeeded("Lyrics imported. Click Initial analysis before editing.");
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
  setSaveState("Unsaved changes...");
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

function markInitialAnalysisNeeded(message = "Run initial analysis before editing this song.") {
  if (!currentSong.text.trim()) return clearInitialAnalysisPrompt();
  currentSong.needsInitialAnalysis = true;
  currentSong.analysisCompletedAt = "";
  renderInitialAnalysisState(message);
}

function clearInitialAnalysisPrompt() {
  currentSong.needsInitialAnalysis = false;
  renderInitialAnalysisState();
}

function setInitialAnalysisComplete() {
  currentSong.needsInitialAnalysis = false;
  currentSong.analysisCompletedAt = new Date().toISOString();
  renderInitialAnalysisState();
  queueSave("initial analysis complete");
}

function renderInitialAnalysisState(message = "Run initial analysis before editing this song.") {
  const prompt = el("analysisPrompt");
  const promptText = el("analysisPromptText");
  const mainButton = el("initialAnalysisBtn");
  const promptButton = el("promptAnalysisBtn");
  const needed = Boolean(currentSong.needsInitialAnalysis);
  prompt.classList.toggle("hidden", !needed);
  mainButton.classList.toggle("needs-attention", needed);
  promptButton.classList.toggle("needs-attention", needed);
  promptText.textContent = message;
}

function looksLikeFullSong(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed === DEFAULT_TEXT.trim()) return false;
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasSectionHeading = lines.some((line) => /^(intro|verse|pre[- ]?chorus|chorus|hook|bridge|outro|final chorus)(\s+\d+)?$/i.test(line));
  return lines.length >= 8 || (hasSectionHeading && lines.length >= 5);
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
  showTextPanel("API keys cleared from this tab memory. They were never saved by TestLyric.");
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
  const willShow = el("tips").hidden;
  el("tips").hidden = !willShow;
  el("learnModeBtn").setAttribute("aria-pressed", String(willShow));
}

function openSettings() {
  el("menu").classList.remove("hidden");
}

function closeSettings() {
  el("menu").classList.add("hidden");
}

function showTextPanel(text) {
  setDetailsText(text);
  openDetails();
}

function setDetailsText(text) {
  lastDetailsText = String(text || "");
  el("details").textContent = lastDetailsText;
  el("detailsPopupText").textContent = lastDetailsText;
}

function openDetails() {
  el("detailsPopupText").textContent = lastDetailsText;
  el("detailsModal").classList.remove("hidden");
}

function closeDetails() {
  el("detailsModal").classList.add("hidden");
}

async function copyDetails() {
  try {
    await navigator.clipboard.writeText(lastDetailsText);
    setSaveState("Details copied");
  } catch {
    setSaveState("Copy unavailable");
  }
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

function getWords(text) {
  return (text.toLowerCase().match(/[a-z']+/g) || []);
}

function countWords(words) {
  return words.reduce((counts, word) => {
    counts[word] = (counts[word] || 0) + 1;
    return counts;
  }, {});
}

function lastWord(text) {
  return (text.toLowerCase().match(/[a-z']+/g) || []).at(-1) || "";
}

function cleanSuggestion(text) {
  return String(text).replace(/^```[a-z]*|```$/g, "").trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function setSaveState(text) {
  el("saveState").textContent = text;
}

function setAiWaiting(waiting, task = "") {
  el("aiStatus").classList.toggle("hidden", !waiting);
  el("aiOverlay").classList.toggle("hidden", !waiting);
  el("aiOverlayText").textContent = waiting && task === "initial_audit"
    ? "Mapping structure, hook strength, weak spots, rhyme palette, and edit priorities."
    : "Your lyrics will not change automatically.";
}

function el(id) {
  return document.getElementById(id);
}

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
  currentSong.needsInitialAnalysis = Boolean(currentSong.needsInitialAnalysis);
  currentSong.analysisCompletedAt = currentSong.analysisCompletedAt || "";
  el("title").value = currentSong.title;
  el("editor").value = currentSong.text || DEFAULT_TEXT;
  el("genreInput").value = currentSong.genre || "";
  el("moodInput").value = currentSong.mood || "";
  el("themeInput").value = currentSong.theme || "";
  updateSelection();
  if (currentSong.needsInitialAnalysis || (!currentSong.analysisCompletedAt && looksLikeFullSong(el("editor").value))) {
    markInitialAnalysisNeeded("Run initial analysis before editing this song.");
  } else {
    renderInitialAnalysisState();
  }
  setSaveState("Saved locally");
}
