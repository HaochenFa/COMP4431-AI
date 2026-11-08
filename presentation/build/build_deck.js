// TrailAI group-project deck (COMP4431): writes ../TrailAI.pptx.
//
//   cd presentation/build && npm install && npm run build
//   OUT=/tmp/qa.pptx SHOW_HIDDEN=1 npm run build    # a copy with the backup slide shown, for render checks
//
// Eval figures come from stats.json (python3 stats.py after a new eval run); screenshots and
// recordings from ../media/framed. apply_theme.js is from Anthropic's pptx skill (Apache-2.0).
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Pi = require("react-icons/pi");
const { applyTheme } = require("./apply_theme.js");

const ROOT = path.resolve(__dirname, "..");
const MEDIA = path.join(ROOT, "media/framed");
const OUT = process.env.OUT || path.join(ROOT, "TrailAI.pptx");
const STATS = JSON.parse(fs.readFileSync(path.join(__dirname, "stats.json"), "utf8"));
// Name and student ID; a null ID shows as an orange placeholder on the title slide.
const TEAM = [
  ["FA Haochen", "24113347D"],
  ["Thierry Orlando GARTH", null],
];

// Light theme from the app's "Day trail" tokens: white page, pale green-grey surfaces, forest-green ink.
const HEX = {
  bg: "FFFFFF", surface: "F3F5F4", line: "D5DCD8", grid: "E3E8E5",
  text: "16201A", text2: "4F5A53", text3: "848E88",
  green: "2B751C", greenSoft: "E4F1DC", blue: "2F6497", gray: "A7B0AB",
  caution: "A84E00", danger: "C8322A",
};
const THEME = {
  name: "TrailAI Day",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: HEX.text, lt1: HEX.bg, dk2: HEX.text2, lt2: HEX.surface,
    accent1: HEX.green, accent2: HEX.blue, accent3: HEX.caution, accent4: HEX.danger,
    accent5: HEX.greenSoft, accent6: HEX.text3, hlink: HEX.green, folHlink: HEX.text2,
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pres.title = "TrailAI: an LLM agent for planning hikes in Hong Kong";
pres.subject = "COMP4431 group project: domain-specific chatbot";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const COL = {
  text: C.text1, text2: C.text2, bg: C.background1, surface: C.background2,
  green: C.accent1, blue: C.accent2, caution: C.accent3, danger: C.accent4, greenSoft: C.accent5, text3: C.accent6,
};

// ---------- assets ----------
const PHONE_AR = 628 / 1332;
const b64 = (file) => "image/png;base64," + fs.readFileSync(file).toString("base64");
const media = (name) => path.join(MEDIA, name);

async function iconPng(Comp, color, px = 256) {
  if (!Comp) throw new Error("missing icon");
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px }));
  const buf = await sharp(Buffer.from(svg)).resize(px, px).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// ---------- layouts ----------
const FOOTER = { text: "TrailAI  |  COMP4431 Group Project", options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: COL.text3, margin: 0 } };

pres.defineSlideMaster({
  title: "TITLE",
  background: { color: COL.bg },
  objects: [
    { rect: { x: 7.45, y: 0, w: 5.883, h: 7.5, fill: { color: COL.surface }, line: { type: "none" } } },
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.2, w: 6.3, h: 1.0, fontSize: 54, bold: true, color: COL.text, align: "left", valign: "bottom", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.4, w: 6.2, h: 1.3, fontSize: 20, color: COL.text2, align: "left", valign: "top", margin: 0 }, text: "" } },
  ],
});

pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: COL.bg },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.42, w: 12.1, h: 0.3, fontSize: 12, bold: true, color: COL.green, charSpacing: 1.5, align: "left", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.74, w: 12.1, h: 0.62, fontSize: 28, bold: true, color: COL.text, align: "left", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 1.4, w: 12.1, h: 0.4, fontSize: 16, color: COL.text2, align: "left", valign: "top", margin: 0 }, text: "" } },
    { text: FOOTER },
  ],
  slideNumber: { x: 12.1, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: COL.text3, align: "right" },
});

// ---------- helpers ----------
function content(section, kicker, title, subtitle) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
  s.addText(kicker.toUpperCase(), { placeholder: "kicker" });
  s.addText(title, { placeholder: "title" });
  if (subtitle) s.addText(subtitle, { placeholder: "body" });
  return s;
}

function phone(s, file, x, y, h, name) {
  s.addImage({ data: b64(media(file)), x, y, h, w: h * PHONE_AR, objectName: name, altText: name });
  return h * PHONE_AR;
}

function card(s, x, y, w, h, name, fill = COL.surface) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: fill }, line: { type: "none" }, objectName: name });
}

function iconCircle(s, icon, x, y, d, name) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: COL.greenSoft }, line: { type: "none" }, objectName: name + " circle" });
  const pad = d * 0.24;
  s.addImage({ data: icon, x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad, objectName: name + " icon", altText: name });
}

function txt(s, text, o) {
  s.addText(text, { isTextBox: true, margin: 0, color: COL.text, fontSize: 14, valign: "top", ...o });
}

// `name` in backticks becomes a bold green run (tool names).
function runs(str, base = {}) {
  return str.split(/(`[^`]+`)/).filter(Boolean).map((part) =>
    part.startsWith("`") ? { text: part.slice(1, -1), options: { ...base, bold: true, color: COL.green } } : { text: part, options: { ...base } }
  );
}

function numberDot(s, n, x, y, d = 0.4) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: COL.green }, line: { type: "none" }, objectName: `step ${n} dot` });
  txt(s, String(n), { x, y, w: d, h: d, fontSize: 14, bold: true, color: COL.bg, align: "center", valign: "middle", objectName: `step ${n} number` });
}

(async () => {
  const G = HEX.green;
  const I = {
    path: await iconPng(Pi.PiPathBold, G), closed: await iconPng(Pi.PiProhibitBold, G),
    storm: await iconPng(Pi.PiCloudLightningBold, G), sunset: await iconPng(Pi.PiSunHorizonBold, G),
    hash: await iconPng(Pi.PiHashBold, G), shield: await iconPng(Pi.PiShieldCheckBold, G),
    rain: await iconPng(Pi.PiCloudRainBold, G), translate: await iconPng(Pi.PiTranslateBold, G),
    plugs: await iconPng(Pi.PiPlugsConnectedBold, G), flask: await iconPng(Pi.PiFlaskBold, G),
    bus: await iconPng(Pi.PiBusBold, HEX.caution), cloud: await iconPng(Pi.PiCloudSunBold, HEX.caution),
    cpu: await iconPng(Pi.PiCpuBold, HEX.caution), users: await iconPng(Pi.PiUsersThreeBold, HEX.caution),
    arrow: await iconPng(Pi.PiArrowRightBold, G), bell: await iconPng(Pi.PiBellRingingBold, G),
    users2: await iconPng(Pi.PiUsersThreeBold, G),
    search: await iconPng(Pi.PiMagnifyingGlassBold, G), mic: await iconPng(Pi.PiMicrophoneBold, G),
    phone: await iconPng(Pi.PiDeviceMobileBold, G),
  };
  const S = STATS.sonnet, D = STATS.deepseek, B = STATS.baseline;
  const pct = (a, b) => Math.round((100 * a) / b);

  // ===== 1. Title =====
  pres.addSection({ title: "Introduction" });
  {
    const s = pres.addSlide({ masterName: "TITLE", sectionTitle: "Introduction" });
    s.addText("TrailAI", { placeholder: "title" });
    s.addText("An LLM agent that plans day hikes in Hong Kong using official government data", { placeholder: "body" });
    txt(s, "COMP4431 Artificial Intelligence, Group Project 2026/27", { x: 0.7, y: 5.3, w: 6.3, h: 0.35, fontSize: 15, color: COL.text2, objectName: "course" });
    txt(s, TEAM.flatMap(([name, id], i) => [
      { text: `${name} (` },
      { text: id || "[student ID]", options: id ? {} : { color: COL.caution } },
      { text: ")", options: { breakLine: i < TEAM.length - 1 } },
    ]), { x: 0.7, y: 5.72, w: 6.3, h: 0.7, fontSize: 15, color: COL.text2, objectName: "team" });
    phone(s, "plan_1.png", 7.95, 0.7, 6.1, "plan page screenshot");
    phone(s, "chat_plan_card.png", 10.45, 1.5, 5.3, "chat screenshot");
    s.addNotes(
      "[0:00-0:15] Good morning. Our project is TrailAI, a chatbot that plans day hikes in Hong Kong. It is an LLM agent: it answers by calling tools over official government data, and the server checks every answer."
    );
  }

  // ===== 2. Motivation =====
  {
    const s = content("Introduction", "Motivation", "Planning a hike depends on data that changes every day", "A safe plan needs four official sources, and a language model on its own has none of them");
    const rows = [
      [I.path, "AFCD trail data", "152 official trail sections with distance, walking time, difficulty and GPX tracks"],
      [I.closed, "AFCD closure notices", "Sections closed because of landslides or maintenance work"],
      [I.storm, "HKO forecast and warnings", "Nine-day forecast, typhoon signals, rainstorm and thunderstorm warnings"],
      [I.sunset, "HKO sunrise and sunset times", "These set the latest time a hiker should finish"],
    ];
    rows.forEach(([icon, head, body], i) => {
      const y = 2.1 + i * 1.15;
      iconCircle(s, icon, 0.6, y, 0.7, head);
      txt(s, head, { x: 1.55, y: y - 0.02, w: 4.9, h: 0.36, fontSize: 17, bold: true, objectName: head + " title" });
      txt(s, body, { x: 1.55, y: y + 0.36, w: 4.9, h: 0.6, fontSize: 14, color: COL.text2, objectName: head + " body" });
    });
    card(s, 7.0, 2.05, 5.73, 4.6, "baseline card");
    txt(s, "Baseline: Claude Sonnet 5.5 without tools, on our 43 test scenarios", { x: 7.35, y: 2.3, w: 5.05, h: 0.6, fontSize: 15, bold: true, objectName: "baseline heading" });
    const stats = [
      [`${B.figures_right} / ${B.figures_stated}`, COL.caution, "distance, time and sunset figures it stated matched the official data"],
      [`${B.n - B.safe} / ${B.n}`, COL.danger, "answers recommended an unsafe hike: a closed trail, one beyond the user's ability, or one finishing after dark"],
      [`${B.invented_trails}`, COL.caution, "trails named that do not exist in the official AFCD list"],
    ];
    stats.forEach(([big, color, label], i) => {
      const y = 3.05 + i * 1.18;
      txt(s, big, { x: 7.35, y, w: 1.95, h: 0.9, fontSize: 36, bold: true, color, valign: "middle", objectName: `baseline stat ${i}` });
      txt(s, label, { x: 9.4, y, w: 3.05, h: 0.9, fontSize: 13, color: COL.text, valign: "middle", objectName: `baseline stat ${i} label` });
    });
    s.addNotes(
      `[0:15-0:45] A safe hike plan needs four official sources: AFCD trail data, closure notices, the Observatory's forecast and warnings, and sunset times. They change daily, so a model can't know them from training. We tested Claude Sonnet 5.5 without tools on our 43 scenarios: only ${B.figures_right} of ${B.figures_stated} figures were right, ${B.n - B.safe} answers recommended an unsafe hike, and it invented ${B.invented_trails} trails. So TrailAI looks these facts up with tools.`
    );
  }

  // ===== 3. Features =====
  pres.addSection({ title: "Features" });
  {
    const s = content("Features", "Features", "Implemented features", null);
    card(s, 0.6, 1.6, 3.2, 2.55, "basic feature card");
    txt(s, "Basic feature", { x: 0.85, y: 1.8, w: 2.75, h: 0.35, fontSize: 16, bold: true, color: COL.green, objectName: "basic heading" });
    txt(s, "An English chatbot for Hong Kong hiking. It understands requests, asks follow-up questions, and answers with trail suggestions, safety advice and day plans.", { x: 0.85, y: 2.22, w: 2.75, h: 1.8, fontSize: 13, color: COL.text, objectName: "basic body" });
    card(s, 0.6, 4.35, 3.2, 2.3, "domain card");
    txt(s, "Domain and data", { x: 0.85, y: 4.55, w: 2.75, h: 0.35, fontSize: 16, bold: true, color: COL.green, objectName: "domain heading" });
    txt(s, "Day hikes in Hong Kong. Open data from the AFCD (trails, GPX tracks, closures, photos) and the Hong Kong Observatory (forecast, warnings, sunset).", { x: 0.85, y: 4.97, w: 2.75, h: 1.6, fontSize: 13, color: COL.text, objectName: "domain body" });

    const head = (t) => ({ text: t, options: { bold: true, color: COL.text2, fontSize: 12, border: [{ type: "none" }, { type: "none" }, { pt: 1, color: HEX.text2 }, { type: "none" }] } });
    const rowBorder = [{ type: "none" }, { type: "none" }, { pt: 0.75, color: HEX.line }, { type: "none" }];
    const feats = [
      ["Tool-using agent", "A tool-calling loop over 11 tools, on three provider APIs"],
      ["Server-side guardrails", "Every plan and refusal is checked in code before the app shows it"],
      ["Retrieval (RAG)", "bge-m3 embeddings over 230 official Chinese description passages"],
      ["Clarifying questions", "ask_user pauses the agent and shows a tap-to-answer form"],
      ["Skills", "Six Markdown procedures that the agent loads when it needs them"],
      ["Voice input and output", "iOS speech recognition in, Kokoro-82M server voices out"],
      ["Native iOS app", "Plan pages, maps, GPX elevation charts and 152 trail pages"],
      ["Evaluation suite", "43 graded scenarios on frozen data, with a no-tools baseline"],
    ];
    const rows = [[head("Additional feature"), head("How it is implemented")]].concat(
      feats.map(([f, how]) => [
        { text: f, options: { bold: true, border: rowBorder } },
        { text: how, options: { color: COL.text2, border: rowBorder } },
      ])
    );
    s.addTable(rows, {
      x: 4.15, y: 1.6, w: 8.58, colW: [2.6, 5.98], rowH: 0.56, fontSize: 13, color: COL.text, valign: "middle",
      margin: [0, 0.08, 0, 0.08], objectName: "additional features table",
    });
    s.addNotes(
      "[0:45-1:10] The basic requirement is a chatbot for typical questions in one domain. Ours covers day hikes in Hong Kong, in English, on open AFCD and Observatory data. On top of that we built eight additional features. The next three slides explain how they work, starting with the core: the agent and its guardrails."
    );
  }

  // ===== 4. Architecture =====
  pres.addSection({ title: "Agent design" });
  {
    const s = content("Agent design", "Agent design", "System architecture", "The iOS app is a client; the agent runs on a Python server");
    const box = (x, y, w, h, head, body, name, inner) => {
      card(s, x, y, w, h, name, inner ? COL.bg : COL.surface);
      txt(s, head, { x: x + 0.22, y: y + 0.16, w: w - 0.44, h: 0.36, fontSize: inner ? 14 : 16, bold: true, color: inner ? COL.text : COL.green, objectName: name + " title" });
      if (body) txt(s, body, { x: x + 0.22, y: y + (inner ? 0.5 : 0.6), w: w - 0.44, h: h - (inner ? 0.58 : 0.72), fontSize: 12, color: COL.text2, objectName: name + " body" });
    };
    box(0.6, 2.0, 3.0, 4.65, "iOS app", null, "app");
    ["Chat and question forms", "Plan and trail pages", "Maps and elevation charts", "Speech input and output"].forEach((t, i) => {
      card(s, 0.82, 2.68 + i * 0.72, 2.56, 0.58, "app item " + i, COL.bg);
      txt(s, t, { x: 0.98, y: 2.68 + i * 0.72, w: 2.3, h: 0.58, fontSize: 12, valign: "middle", objectName: "app item text " + i });
    });
    txt(s, "Expo and React Native", { x: 0.82, y: 5.6, w: 2.56, h: 0.3, fontSize: 11, color: COL.text3, objectName: "app stack" });

    box(4.5, 2.0, 4.3, 4.65, "Agent server (Python, FastAPI)", null, "server");
    box(4.72, 2.62, 3.86, 0.88, "Agent loop", "Calls the model and runs its tools, turn by turn", "loop", true);
    box(4.72, 3.58, 3.86, 0.88, "Guardrails", "Checks every plan and refusal in code", "guardrails", true);
    box(4.72, 4.54, 3.86, 0.88, "Skills and session state", "Six skills on demand; history; checks run", "skills", true);
    box(4.72, 5.5, 3.86, 0.88, "Read-aloud voice", "Kokoro-82M text-to-speech, served at /tts", "tts", true);

    box(9.7, 2.0, 3.03, 2.2, "LLM provider adapters", "Anthropic Messages, OpenAI Chat Completions and OpenAI Responses. Tested with Claude Sonnet 5.5, DeepSeek V4.1 Flash, Grok 4.6 and local qwen3:8b", "adapters");
    box(9.7, 4.45, 3.03, 2.2, "Tools and data", "11 tools over AFCD trails, GPX tracks and closures, and HKO forecasts, warnings and sunset times. Cached, with offline snapshots", "tools");

    const arrow = (x1, y1, x2, y2, name) => s.addShape(pres.shapes.LINE, { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color: COL.green, width: 1.75, beginArrowType: "triangle", endArrowType: "triangle" }, objectName: name });
    arrow(3.66, 4.2, 4.44, 4.2, "app to server arrow");
    txt(s, "WebSocket and HTTP", { x: 3.55, y: 4.32, w: 1.0, h: 0.4, fontSize: 10, color: COL.text2, align: "center", objectName: "websocket label" });
    arrow(8.86, 3.1, 9.64, 3.1, "server to model arrow");
    txt(s, "API", { x: 8.75, y: 3.22, w: 1.0, h: 0.25, fontSize: 10, color: COL.text2, align: "center", objectName: "api label" });
    arrow(8.86, 5.55, 9.64, 5.55, "server to tools arrow");
    txt(s, "tool calls", { x: 8.75, y: 5.67, w: 1.0, h: 0.25, fontSize: 10, color: COL.text2, align: "center", objectName: "tool calls label" });
    s.addNotes(
      "[1:10-1:45] The app is only a client. It sends messages to a Python server over a WebSocket and renders what comes back: streamed text, the agent's progress, question forms, and plan or refusal cards. The agent loop calls the model, runs the tools it asks for, and repeats until the model answers. Skills are short written procedures, such as how to write a plan, loaded only when needed. The server also hosts the read-aloud voice. Adapters for three APIs let us switch between Claude, GPT, DeepSeek, Grok or a local model with one setting."
    );
  }

  // ===== 5. Tool use and guardrails =====
  {
    const s = content("Agent design", "Agent design", "Tool use and server-side guardrails", "A typical request goes through four steps; the server enforces the third");
    const steps = [
      ["Clarify", "`ask_user` shows a form when the fitness level, date or start time is missing"],
      ["Retrieve", "`search_trails` filters the official trail list; `search_knowledge` ranks trail descriptions by meaning"],
      ["Verify", "`check_closures`, `get_weather` and `get_daylight` for the chosen trails and date"],
      ["Answer", "`present_plan` or `refuse`, structured outputs that the app shows as cards"],
    ];
    steps.forEach(([head, body], i) => {
      const y = 2.0 + i * 1.18;
      numberDot(s, i + 1, 0.6, y);
      txt(s, head, { x: 1.2, y: y + 0.02, w: 3.7, h: 0.34, fontSize: 16, bold: true, objectName: `${head} title` });
      txt(s, runs(body), { x: 1.2, y: y + 0.38, w: 3.75, h: 0.72, fontSize: 13, color: COL.text2, objectName: `${head} body` });
    });
    card(s, 5.3, 2.0, 4.4, 4.65, "guardrail card");
    txt(s, "The server rejects a plan if", { x: 5.6, y: 2.22, w: 3.85, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "guardrail heading" });
    txt(
      s,
      [
        { text: "a required check has not been run for that trail and date;", options: { bullet: true, breakLine: true } },
        { text: "the checks rule it out: a typhoon signal, a rainstorm warning, a heavy-rain forecast or a closed trail;", options: { bullet: true, breakLine: true } },
        { text: "a distance, time or sunset figure differs from the tool results.", options: { bullet: true } },
      ],
      { x: 5.6, y: 2.72, w: 3.85, h: 2.45, fontSize: 14, paraSpaceAfter: 8, objectName: "guardrail rules" }
    );
    txt(s, "The error goes back to the model as a tool result, so it can correct the plan. Refusals are checked in the same way.", { x: 5.6, y: 5.3, w: 3.85, h: 1.15, fontSize: 13, color: COL.text2, objectName: "guardrail note" });
    phone(s, "chat_sources.png", 10.3, 1.9, 4.85, "checked sources screenshot");
    s.addNotes(
      `[1:45-2:15] A request goes through four steps: clarify, retrieve candidate trails, verify closures, weather and sunset, then present a plan or refuse. We don't rely on the prompt for this. The server blocks present_plan until the checks have run, if they rule the hike out, or if any figure differs from the tools. The model gets the error and must fix its plan: DeepSeek hit this in ${D.blocks_cases} scenarios and corrected it every time. On the right, the sources the user can open.`
    );
  }

  // ===== 6. Retrieval, voice and the app =====
  {
    const s = content("Agent design", "Additional features", "Retrieval, voice and the app", "How the other features are built");
    const cols = [
      [I.search, "Retrieval (RAG)", [
        ["Index", "127 official trail descriptions, all in Chinese, split at sentence ends into 230 passages"],
        ["Embed", "bge-m3, a multilingual embedding model, runs locally on Ollama"],
        ["Search", "`search_knowledge` ranks passages by cosine similarity, only for trails that fit"],
        ["Use", "The model translates and cites a passage; figures still come only from the trail data"],
      ]],
      [I.mic, "Voice input and output", [
        ["Listen", "iOS speech recognition with a live transcript; sends when you stop"],
        ["Script", "A short spoken summary: go or no-go, distance, time, finish against sunset"],
        ["Speak", "Kokoro-82M on the server, four English voices; the app streams the WAV from `/tts`"],
        ["Fallback", "If the server voice isn't ready, the best iOS voice reads the plan instead"],
      ]],
      [I.phone, "Native iOS app", [
        ["Stack", "Expo SDK 57 and React Native, with native tabs, Liquid Glass controls and SF Symbols"],
        ["Plan page", "AFCD photo, figures, safety checks, sunset timeline, elevation chart, sources"],
        ["Trails", "152 trail pages with search, list and map views"],
        ["Demo-ready", "Light mode for projectors; Settings can simulate a typhoon, rainstorm or closure"],
      ]],
    ];
    const w = 3.83, gap = 0.3, y0 = 1.95, h = 4.75;
    cols.forEach(([icon, head, steps], i) => {
      const x = 0.6 + i * (w + gap);
      card(s, x, y0, w, h, head + " card");
      iconCircle(s, icon, x + 0.25, y0 + 0.22, 0.56, head);
      txt(s, head, { x: x + 0.98, y: y0 + 0.22, w: w - 1.2, h: 0.56, fontSize: 16, bold: true, valign: "middle", objectName: head + " title" });
      steps.forEach(([label, body], j) => {
        const y = y0 + 0.98 + j * 0.92;
        txt(s, label, { x: x + 0.25, y, w: w - 0.5, h: 0.26, fontSize: 12, bold: true, color: COL.green, objectName: `${head} ${label} label` });
        txt(s, runs(body), { x: x + 0.25, y: y + 0.26, w: w - 0.5, h: 0.62, fontSize: 12, color: COL.text2, objectName: `${head} ${label} body` });
      });
    });
    s.addNotes(
      "[2:15-2:45] The other features in brief. For retrieval, the official trail descriptions exist only in Chinese, so we split them into passages and embed them with bge-m3, a multilingual model. An English request like 'sea views' then finds the right Chinese passage, which the model translates and cites. For voice, iOS speech recognition takes the request, and the server reads the plan back with Kokoro, a small open text-to-speech model, so it works offline. The app is native iOS, built with Expo."
    );
  }

  // ===== 6. Live demo =====
  pres.addSection({ title: "Demonstration" });
  {
    const s = content("Demonstration", "Live demonstration", "Demo scenarios", "Run live on the iOS Simulator with Claude Sonnet 5.5 and live HKO and AFCD data");
    const block = (y0, head, items, name) => {
      txt(s, head, { x: 0.6, y: y0, w: 7.7, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: name + " heading" });
      items.forEach((t, i) => {
        const y = y0 + 0.48 + i * 0.46;
        numberDot(s, i + 1, 0.6, y, 0.34);
        txt(s, t, { x: 1.12, y: y - 0.02, w: 7.2, h: 0.4, fontSize: 14, valign: "middle", objectName: `${name} step ${i + 1}` });
      });
    };
    block(2.0, "Scenario 1: planning a half-day hike, asked by voice", [
      "Ask by voice for a half-day hike with sea views on Hong Kong Island",
      "Answer the two follow-up questions: fitness level and start time",
      "Follow the tool calls: search, retrieval, closures, forecast, sunset",
      "Hear the plan read aloud in a Kokoro voice as it arrives",
      "Open the plan: figures, safety checks, timeline, elevation, sources",
    ], "scenario 1");
    block(4.9, "Scenario 2: a typhoon signal", [
      "In Settings, switch the demo scenario to Typhoon Signal No. 8",
      "Ask: \"Can I hike Dragon's Back tomorrow morning?\"",
      "The agent declines, shows the evidence and suggests a later date",
    ], "scenario 2");
    phone(s, "chat_questions_answered.png", 8.75, 1.95, 4.4, "scenario 1 screenshot");
    phone(s, "home_t8.png", 10.93, 1.95, 4.4, "scenario 2 screenshot");
    txt(s, "Follow-up questions", { x: 8.75, y: 6.42, w: 2.07, h: 0.3, fontSize: 11, color: COL.text2, align: "center", objectName: "scenario 1 caption" });
    txt(s, "T8 scenario active", { x: 10.93, y: 6.42, w: 2.07, h: 0.3, fontSize: 11, color: COL.text2, align: "center", objectName: "scenario 2 caption" });
    s.addNotes(
      "[2:45-5:35 LIVE DEMO] Before the talk: start the backend with LLM_PROFILE=claude-sonnet and wait until localhost:8000/tts/voices reports ready (the Kokoro voice loads in the background). In the app, open Settings: Live data scenario, Read plans aloud on, voice Heart. Route the laptop's sound to the room speakers, then start a new conversation.\n\n" +
        "Scenario 1 (about 1:55). Tap the microphone and say: 'Find me a half-day hike with sea views on Hong Kong Island this Saturday.' If speech recognition is unreliable in the room, type the same request. Answer the two question cards (Regular, around 9:00). While the agent works, point at the activity line: it is searching trails, retrieving descriptions, and checking closures, the forecast and sunset. When the plan card arrives, the app reads the summary aloud in the Kokoro voice (about 15 seconds): let it finish. Then open the plan page and scroll through it: the official distance and time, the safety checks the server enforced, the timeline against sunset, the elevation chart, and the sources, including the Chinese AFCD passage behind 'sea views'.\n\n" +
        "Scenario 2 (about 0:50). Open Settings and choose Typhoon T8; the home screen shows the warning. Ask: 'Can I hike Dragon's Back tomorrow morning?' The agent checks the same sources and returns a no-go card with the reason and a later date, which is also read aloud. Switch the scenario back to Live data afterwards.\n\n" +
        "If the live demo fails, jump to the hidden backup slide at the end, which has recordings of both scenarios."
    );
  }

  // ===== 7. Evaluation =====
  pres.addSection({ title: "Evaluation" });
  {
    const s = content("Evaluation", "Evaluation", "Evaluation on 43 test scenarios", "Each scenario runs the full agent on frozen weather and closure data; rules grade the final plan or refusal");
    const cats = [["go", "Go"], ["closure", "Closed trail"], ["weather", "Weather"], ["ability", "Ability"], ["scenery", "Scenery"], ["multi_turn", "Multi-turn"], ["out_of_scope", "Off-topic"]];
    const series = (st, label) => ({ name: label, labels: cats.map((c) => c[1]), values: cats.map(([k]) => pct(st.by_cat[k][0], st.by_cat[k][1])) });
    s.addChart(
      pres.charts.BAR,
      [series(S, "Claude Sonnet 5.5 with tools"), series(D, "DeepSeek V4.1 Flash with tools"), series(B, "Claude Sonnet 5.5 without tools")],
      {
        x: 0.6, y: 1.95, w: 7.7, h: 4.55, barDir: "col", barGrouping: "clustered", barGapWidthPct: 60,
        chartColors: [HEX.green, HEX.blue, HEX.gray],
        showLegend: true, legendPos: "t", legendFontSize: 11, legendColor: HEX.text2, legendFontFace: "+mn-lt",
        showValue: false,
        valAxisMaxVal: 100, valAxisMinVal: 0, valAxisMajorUnit: 25, valAxisLabelFormatCode: '0"%"',
        valAxisLabelColor: HEX.text2, valAxisLabelFontSize: 11, valAxisLabelFontFace: "+mn-lt", valAxisLineShow: false,
        catAxisLabelColor: HEX.text2, catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", catAxisLineShow: false,
        valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" },
        showTitle: true, title: "Scenarios passed, by category", titleColor: HEX.text, titleFontSize: 13, titleFontFace: "+mn-lt",
        objectName: "pass rate chart", altText: "Pass rate by category for three configurations",
      }
    );
    txt(s, "Pass: right outcome and the user's constraints met. Safe: no plan for a closed or unsuitable trail.", { x: 0.6, y: 6.55, w: 7.7, h: 0.3, fontSize: 11, color: COL.text3, objectName: "grading note" });
    const stat = (y, big, color, head, body, name) => {
      txt(s, big, { x: 8.75, y, w: 1.75, h: 0.8, fontSize: 30, bold: true, color, valign: "middle", objectName: name });
      txt(s, head, { x: 10.55, y: y + 0.02, w: 2.18, h: 0.34, fontSize: 13, bold: true, objectName: name + " head" });
      txt(s, body, { x: 10.55, y: y + 0.36, w: 2.18, h: 0.7, fontSize: 12, color: COL.text2, objectName: name + " body" });
    };
    stat(2.0, `${S.pass}/${S.n}`, COL.green, "Sonnet 5.5, tools", `Passed; all ${S.safe} safe`, "stat sonnet");
    stat(3.15, `${D.pass}/${D.n}`, COL.blue, "DeepSeek, tools", `All ${D.safe} safe; ${D.blocks_cases} plans rejected, then corrected`, "stat deepseek");
    stat(4.3, `${B.pass}/${B.n}`, COL.danger, "Sonnet 5.5, no tools", `${B.n - B.safe} unsafe answers; none of the ${B.by_cat.closure[1]} closed-trail cases passed`, "stat baseline");
    stat(5.45, `${Math.round(S.median_seconds)} s`, COL.text, "Median per scenario", `Sonnet with tools, ${S.median_steps} model calls`, "stat time");
    s.addNotes(
      `[5:35-6:10] We wrote 43 test scenarios in seven categories, such as a closed trail, bad weather or a request beyond the user's ability. Each runs through the real agent on frozen weather and closure data, a script answers the question forms, and rules, not an LLM judge, grade the result. With tools, Claude Sonnet 5.5 passed all ${S.n}. The much cheaper DeepSeek passed ${D.pass}, and all its plans were safe. Without tools, the same Sonnet passed only ${B.pass}, with ${B.n - B.safe} unsafe answers.`
    );
  }

  // ===== 8. Challenges =====
  {
    const s = content("Evaluation", "Development", "Technical challenges and solutions", "Top row: safety and correctness. Bottom row: retrieval, model portability and evaluation.");
    const items = [
      [I.hash, "Hallucinated figures", "LLMs state distances, times and sunsets that sound plausible but are wrong. A server-side check compares every figure with the tool results."],
      [I.shield, "Failing safe on missing data", "A missing forecast or an unknown trail ID returns an error, never a default value, so no safety check can pass without real data."],
      [I.rain, "Unstructured weather text", "HKO forecasts are free text, and heavy rain has many phrasings, e.g. \"showers will be heavy at times\". A regex matches them all, not one keyword."],
      [I.translate, "Cross-lingual retrieval", "Official trail descriptions exist only in Chinese. Multilingual bge-m3 embeddings let English queries like \"sea views\" retrieve them."],
      [I.plugs, "Heterogeneous LLM APIs", "Each provider encodes tool calls and reasoning differently, and some reject altered history. Turns are stored verbatim and replayed natively."],
      [I.flask, "Reproducible evaluation", "Live weather would change results daily. The 43 scenarios run on fixed weather and closure fixtures, graded by rules, not an LLM judge."],
    ];
    const w = 3.83, h = 2.2, gapX = 0.3, gapY = 0.25;
    items.forEach(([icon, head, body], i) => {
      const x = 0.6 + (i % 3) * (w + gapX), y = 1.95 + Math.floor(i / 3) * (h + gapY);
      card(s, x, y, w, h, head + " card");
      iconCircle(s, icon, x + 0.25, y + 0.25, 0.56, head);
      txt(s, head, { x: x + 0.98, y: y + 0.2, w: w - 1.2, h: 0.66, fontSize: 15, bold: true, valign: "middle", objectName: head + " title" });
      txt(s, body, { x: x + 0.25, y: y + 1.02, w: w - 0.5, h: 1.15, fontSize: 13, color: COL.text2, objectName: head + " body" });
    });
    s.addNotes(
      "[6:10-6:35] The top row is safety. LLMs hallucinate figures, so the server verifies every number against the tool results. Missing data fails safe: an absent forecast is an error, not good weather. And HKO forecasts are unstructured text, so heavy rain is matched by pattern, not by one keyword. The bottom row: cross-lingual retrieval, portability across LLM APIs, and reproducible evaluation."
    );
  }

  // ===== 9. Limitations =====
  {
    const s = content("Evaluation", "Discussion", "Limitations and future work", null);
    const col = (x, head, color, items, name) => {
      txt(s, head, { x, y: 1.6, w: 5.8, h: 0.4, fontSize: 18, bold: true, color, objectName: name + " heading" });
      items.forEach(([icon, t, b], i) => {
        const y = 2.2 + i * 1.18;
        iconCircle(s, icon, x, y, 0.56, `${name} ${i}`);
        txt(s, t, { x: x + 0.75, y: y - 0.02, w: 5.0, h: 0.34, fontSize: 15, bold: true, objectName: `${name} ${i} title` });
        txt(s, b, { x: x + 0.75, y: y + 0.32, w: 5.0, h: 0.7, fontSize: 13, color: COL.text2, objectName: `${name} ${i} body` });
      });
    };
    col(0.6, "Limitations", COL.caution, [
      [I.bus, "No public transport routing", "Travel is shown as an approximate time block, and the agent does not state bus routes"],
      [I.cloud, "Regional, nine-day forecasts", "HKO forecasts cover regions rather than trails; plans for later dates are marked provisional"],
      [I.cpu, "Slow on local models", "qwen3:8b runs offline but takes 7 to 10 seconds per model call"],
      [I.users, "No user study yet", "The evaluation uses scripted answers; we have not yet tested the app with real hikers"],
    ], "limitations");
    col(6.9, "Future work", COL.green, [
      [I.arrow, "Public transport directions", "Google Directions on the server, checked by the same guardrails"],
      [I.bell, "Alerts for saved plans", "Notify the user when a new warning or closure affects a planned hike"],
      [I.translate, "Traditional Chinese", "Interface and replies in Chinese as well as English"],
      [I.users2, "User study", "Measure task success, trust and usability (SUS) with hikers of different experience"],
    ], "future");
    s.addNotes("[6:35-6:50] Limitations: no public transport routing, regional nine-day forecasts, slow local models, and no study with real users yet. Next: transport directions under the same guardrails, alerts for saved plans, Chinese, and a user study.");
  }

  // ===== 10. Summary =====
  pres.addSection({ title: "Summary" });
  {
    const s = content("Summary", "Conclusion", "Summary", null);
    const items = [
      ["Tool use", "The agent answers with 11 tools over official AFCD and HKO data, rather than from the model's memory."],
      ["Guardrails", "The server rejects any plan whose checks are missing, rule the hike out, or disagree with the tool data."],
      ["Evaluation", `Claude Sonnet 5.5 passed ${S.pass} of ${S.n} test scenarios with tools, and ${B.pass} without them.`],
    ];
    const w = 3.83, gap = 0.3;
    items.forEach(([head, body], i) => {
      const x = 0.6 + i * (w + gap);
      card(s, x, 1.75, w, 2.2, `summary ${i}`);
      txt(s, head, { x: x + 0.3, y: 2.0, w: w - 0.6, h: 0.45, fontSize: 20, bold: true, color: COL.green, objectName: `summary ${i} heading` });
      txt(s, body, { x: x + 0.3, y: 2.6, w: w - 0.6, h: 1.6, fontSize: 15, color: COL.text, objectName: `summary ${i} body` });
    });
    txt(s, "Thank you. We are happy to take questions.", { x: 0.6, y: 4.75, w: 12.13, h: 0.7, fontSize: 28, bold: true, align: "center", valign: "middle", objectName: "closing line" });
    s.addNotes("[6:50-7:00] To summarise: tools over official data, a server that checks every plan, and an evaluation that shows the effect. Thank you, we're happy to take questions.");
  }

  // ===== Backup (hidden) =====
  pres.addSection({ title: "Backup" });
  {
    const s = content("Backup", "Backup", "Recorded demonstration", "Hidden slide: use only if the live demo fails");
    s.hidden = !process.env.SHOW_HIDDEN; // SHOW_HIDDEN=1 only for render checks
    const vh = 4.75, vw = vh * PHONE_AR;
    s.addMedia({ type: "video", path: media("demo_plan.mp4"), cover: "data:" + b64(media("demo_plan_poster.png")), x: 0.6, y: 1.95, w: vw, h: vh, objectName: "scenario 1 recording" });
    txt(s, "Scenario 1", { x: 3.05, y: 2.05, w: 3.3, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 1 heading" });
    txt(s, "A half-day hike with sea views on Hong Kong Island. The agent asks two questions, checks five sources and presents Hong Kong Trail Section 8. 76 seconds, sped up while the agent works.", { x: 3.05, y: 2.5, w: 3.3, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 1 caption" });
    s.addMedia({ type: "video", path: media("demo_refuse.mp4"), cover: "data:" + b64(media("demo_refuse_poster.png")), x: 6.9, y: 1.95, w: vw, h: vh, objectName: "scenario 2 recording" });
    txt(s, "Scenario 2", { x: 9.35, y: 2.05, w: 3.38, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 2 heading" });
    txt(s, "Typhoon Signal No. 8 is set as the demo scenario. The agent declines Dragon's Back, shows the evidence and suggests a later date. 31 seconds.", { x: 9.35, y: 2.5, w: 3.38, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 2 caption" });
    s.addNotes("Backup only. Both recordings were made with Claude Sonnet 5.5 on the iOS Simulator. Click a video to play it.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
