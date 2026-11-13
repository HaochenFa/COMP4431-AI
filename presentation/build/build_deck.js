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
const TRANSPORT = JSON.parse(fs.readFileSync(path.join(ROOT, "../data/transport.json"), "utf8"));
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
      [I.path, "AFCD trail data", "152 trail sections, 125 GPX tracks, official times where available and labelled estimates otherwise"],
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
    txt(s, "Hong Kong day hikes. AFCD trails, tracks, closures and photos. HKO weather and sunset. Transport Department bus-stop and route data.", { x: 0.85, y: 4.97, w: 2.75, h: 1.6, fontSize: 13, color: COL.text, objectName: "domain body" });

    const head = (t) => ({ text: t, options: { bold: true, color: COL.text2, fontSize: 12, border: [{ type: "none" }, { type: "none" }, { pt: 1, color: HEX.text2 }, { type: "none" }] } });
    const rowBorder = [{ type: "none" }, { type: "none" }, { pt: 0.75, color: HEX.line }, { type: "none" }];
    const feats = [
      ["Tool-using agent", "A tool-calling loop over 11 tools, on three provider APIs"],
      ["Server-side guardrails", "Checks, figures, daylight margin and refusal evidence enforced in code"],
      ["Retrieval (RAG)", "bge-m3 embeddings over 230 official Chinese description passages"],
      ["Clarifying questions", "ask_user pauses the agent and shows a tap-to-answer form"],
      ["Skills", "Safety guidance always present, plus five on-demand procedures"],
      ["Voice input and output", "iOS speech recognition in, Kokoro-82M server voices out"],
      ["Native iOS app", "152 trails, search, maps, elevation, saved plans and follow-ups"],
      ["Getting there & back", "Nearby bus and minibus stops, route chips and distances"],
      ["Evaluation suite", "43 graded scenarios on frozen data, with a no-tools baseline"],
    ];
    const rows = [[head("Additional feature"), head("How it is implemented")]].concat(
      feats.map(([f, how]) => [
        { text: f, options: { bold: true, border: rowBorder } },
        { text: how, options: { color: COL.text2, border: rowBorder } },
      ])
    );
    s.addTable(rows, {
      x: 4.15, y: 1.6, w: 8.58, colW: [2.6, 5.98], rowH: 0.5, fontSize: 13, color: COL.text, valign: "middle",
      margin: [0, 0.08, 0, 0.08], objectName: "additional features table",
    });
    s.addNotes(
      "[0:45-1:10] The basic requirement is a chatbot for typical questions in one domain. Ours covers day hikes in Hong Kong, in English, on open AFCD and Observatory data. We also show official Transport Department stop and route data on the plan and trail pages. The table lists nine additional features. Next: the agent, its guardrails, retrieval and voice, then the new transport reference feature.\n\nImplementation sources: backend/app/tools/agentic.py; backend/app/agent/harness.py; mobile/src/components/plan/sections.tsx; mobile/src/lib/recent.tsx."
    );
  }

  // ===== 4. Architecture =====
  pres.addSection({ title: "Agent design" });
  {
    const s = content("Agent design", "Agent design", "System architecture", "The iOS client uses a Python server for the agent, browse data and voice");
    const box = (x, y, w, h, head, body, name, inner) => {
      card(s, x, y, w, h, name, inner ? COL.bg : COL.surface);
      txt(s, head, { x: x + 0.22, y: y + 0.16, w: w - 0.44, h: 0.36, fontSize: inner ? 14 : 16, bold: true, color: inner ? COL.text : COL.green, objectName: name + " title" });
      if (body) txt(s, body, { x: x + 0.22, y: y + (inner ? 0.5 : 0.6), w: w - 0.44, h: h - (inner ? 0.58 : 0.72), fontSize: 12, color: COL.text2, objectName: name + " body" });
    };
    box(0.6, 2.0, 3.0, 4.65, "iOS app", null, "app");
    ["Chat and question forms", "Plans, trails and bus stops", "Maps and elevation charts", "Speech input and output"].forEach((t, i) => {
      card(s, 0.82, 2.68 + i * 0.72, 2.56, 0.58, "app item " + i, COL.bg);
      txt(s, t, { x: 0.98, y: 2.68 + i * 0.72, w: 2.3, h: 0.58, fontSize: 12, valign: "middle", objectName: "app item text " + i });
    });
    txt(s, "Expo and React Native", { x: 0.82, y: 5.6, w: 2.56, h: 0.3, fontSize: 11, color: COL.text3, objectName: "app stack" });
    txt(s, "Stop data goes directly to the UI", { x: 0.82, y: 6.0, w: 2.56, h: 0.35, fontSize: 11, color: COL.text2, objectName: "display-only transport" });

    box(4.5, 2.0, 4.3, 4.65, "Agent server (Python, FastAPI)", null, "server");
    box(4.72, 2.62, 3.86, 0.88, "Agent loop", "Calls the model and runs its tools, turn by turn", "loop", true);
    box(4.72, 3.58, 3.86, 0.88, "Guardrails", "Checks every plan and refusal in code", "guardrails", true);
    box(4.72, 4.54, 3.86, 0.88, "Skills and session state", "Safety rules, skills and check history", "skills", true);
    box(4.72, 5.5, 3.86, 0.88, "Browse data and read-aloud", "REST: trails, nearby stops and Kokoro voice", "tts", true);

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
      "[1:10-1:45] The app sends chat over a WebSocket and renders streamed text, progress, question forms, and plan or refusal cards. The agent loop calls the model and runs its tools. Safety guidance is always in the prompt, while five other procedures load on demand. REST endpoints supply trail details, nearby bus stops and the Kokoro read-aloud voice. The bus-stop data goes straight to the UI, outside the agent and its safety ledger. Three API adapters let us switch providers or use a local model.\n\nImplementation sources: backend/app/rest.py; backend/app/tools/data.py:access; backend/app/agent/harness.py; backend/app/llm/registry.py."
    );
  }

  // ===== 5. Tool use and guardrails =====
  {
    const s = content("Agent design", "Agent design", "Tool use and server-side guardrails", "The server requires evidence and validates each structured plan before showing it");
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
        { text: "required trail or date checks are missing", options: { bullet: true, breakLine: true } },
        { text: "a no-go warning, heavy rain or closure rules it out", options: { bullet: true, breakLine: true } },
        { text: "figures disagree or the finish is under 30 minutes before sunset", options: { bullet: true, breakLine: true } },
        { text: "the plan invents a bus, minibus or ferry route number", options: { bullet: true } },
      ],
      { x: 5.6, y: 2.72, w: 3.85, h: 2.45, fontSize: 14, paraSpaceAfter: 8, objectName: "guardrail rules" }
    );
    txt(s, "Errors return to the model for correction. Hike refusals also need matching evidence. Dates beyond the forecast window get a Provisional label.", { x: 5.6, y: 5.3, w: 3.85, h: 1.15, fontSize: 13, color: COL.text2, objectName: "guardrail note" });
    phone(s, "chat_sources.png", 10.3, 1.9, 4.85, "checked sources screenshot");
    s.addNotes(
      `[1:45-2:15] A request goes through clarification, retrieval, verification and a structured answer. The server checks closures, weather, figures and a 30-minute sunset margin. It also blocks invented transport route numbers. The UI's official bus-stop reference data does not let the agent invent a journey. DeepSeek hit the gate in ${D.blocks_cases} scenarios and corrected its output each time. Hike refusals need evidence too, with daylight required for AFTER_DARK. OUT_OF_SCOPE refusals are exempt and cannot name trails. Beyond the nine-day forecast, a plan is Provisional.\n\nImplementation source: backend/app/tools/agentic.py (gate, number_check, safety_check, evidence_check, present_plan, refuse).`
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
        ["Trails", "152 trails, English or Chinese name/place search, filters, list and map views"],
        ["Follow-up", "Recent plans on device, one-tap refinements, light mode and labelled demo scenarios"],
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
      "[2:15-2:40] The official descriptions are Chinese, so multilingual bge-m3 embeddings connect an English request like 'sea views' to a passage the model can translate and cite. iOS speech recognition takes the request, and Kokoro reads the result, with an iOS voice fallback. The app also has bilingual trail-name and landmark search, list and map views, recent plans and one-tap refinements. The interface and demo conversation remain English.\n\nImplementation sources: mobile/src/components/trail/trail-search.tsx; mobile/src/lib/recent.tsx; mobile/src/lib/speech.ts; mobile/src/lib/scenarios.ts."
    );
  }

  // ===== 7. Nearby public transport =====
  {
    const s = content("Features", "Additional features", "Getting there & back", "Plan and trail pages now show nearby bus and green-minibus stops");
    const details = [
      ["Both ends of the hike", "Up to three stops within 5 km of the trail's start and finish, ordered by straight-line distance"],
      ["Stop names and route chips", "Readable stop names, route numbers and separate bus or green-minibus labels"],
      ["Official reference data", `Transport Department GTFS data, bundled for ${Object.keys(TRANSPORT.trails).length} trails with GPX endpoints`],
    ];
    details.forEach(([head, body], i) => {
      const y = 2.05 + i * 1.12;
      numberDot(s, i + 1, 0.6, y);
      txt(s, head, { x: 1.2, y, w: 4.5, h: 0.35, fontSize: 17, bold: true, objectName: `transport feature ${i} title` });
      txt(s, body, { x: 1.2, y: y + 0.42, w: 4.5, h: 0.64, fontSize: 14, color: COL.text2, objectName: `transport feature ${i} body` });
    });

    card(s, 6.15, 1.95, 6.58, 3.55, "transport example");
    txt(s, "Hong Kong Trail Section 8", { x: 6.45, y: 2.18, w: 5.98, h: 0.4, fontSize: 18, bold: true, objectName: "transport example heading" });
    const access = TRANSPORT.trails.hk_8;
    ["start", "finish"].forEach((end, i) => {
      const stop = access[end][0];
      const y = 2.82 + i * 1.08;
      txt(s, end === "start" ? "Nearest to start" : "Nearest to finish", { x: 6.45, y, w: 5.98, h: 0.24, fontSize: 11, bold: true, color: COL.green, objectName: `transport ${end} label` });
      txt(s, stop.name, { x: 6.45, y: y + 0.29, w: 5.98, h: 0.34, fontSize: 16, bold: true, objectName: `transport ${end} name` });
      txt(s, `${stop.distance_m} m away`, { x: 6.45, y: y + 0.7, w: 1.65, h: 0.25, fontSize: 12, color: COL.text2, objectName: `transport ${end} distance` });
      stop.routes.forEach((route, j) => {
        const x = 8.2 + j * 0.75;
        card(s, x, y + 0.66, 0.62, 0.33, `transport ${end} route ${route}`, COL.greenSoft);
        txt(s, route, { x, y: y + 0.66, w: 0.62, h: 0.33, fontSize: 12, bold: true, color: COL.green, align: "center", valign: "middle", objectName: `transport ${end} route ${route} label` });
      });
    });
    txt(s, `Nearest-stop examples from the bundled feed dated ${TRANSPORT.downloaded}`, { x: 6.45, y: 5.12, w: 5.98, h: 0.25, fontSize: 10, color: COL.text3, objectName: "transport example source" });
    card(s, 0.6, 5.82, 12.13, 0.85, "transport scope");
    txt(s, "Current scope", { x: 0.85, y: 6.0, w: 1.7, h: 0.3, fontSize: 14, bold: true, color: COL.green, objectName: "transport scope heading" });
    txt(s, "Directions opens Apple Maps. TrailAI lists nearby stops but does not calculate journeys or timetables.", { x: 2.65, y: 5.99, w: 9.75, h: 0.5, fontSize: 14, color: COL.text2, objectName: "transport scope body" });
    s.addNotes(
      "[2:40-3:00] Getting there and back is now part of both the plan and trail pages. The app lists up to three nearby stops at each end, within five kilometres, with route chips and a bus or green-minibus label. These examples come directly from the bundled Transport Department feed. Distances are straight-line, not walking distances. The Directions button on the plan and map pages opens Apple Maps for transit directions to the start. TrailAI itself does not calculate journeys, timetables or travel time. Stop data never enters the agent's context or safety ledger, and its travel blocks remain approximate. The 27 trails without GPX endpoints have no access data.\n\nImplementation sources: backend/app/transport.py; scripts/build_transport.py; data/transport.json (downloaded 2026-11-11); backend/app/rest.py; mobile/src/components/plan/sections.tsx:AccessSection; mobile/src/app/plan/[id].tsx; mobile/src/app/trail/[id].tsx; mobile/src/app/map.tsx."
    );
  }

  // ===== 8. Live demo =====
  pres.addSection({ title: "Demonstration" });
  {
    const s = content("Demonstration", "Live demonstration", "Demo scenarios", "iOS Simulator with Claude Sonnet 5.5, live feeds and labelled scenario overrides");
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
      "Answer any missing details, such as fitness level and start time",
      "Follow the tool calls: search, retrieval, closures, forecast, sunset",
      "Hear the plan read aloud in a Kokoro voice as it arrives",
      "Open the plan: safety checks, elevation, nearby bus stops and sources",
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
      "[3:00-5:35 LIVE DEMO] Before the talk: start the backend with LLM_PROFILE=claude-sonnet and wait until localhost:8000/tts/voices reports ready (the Kokoro voice loads in the background). In the app, open Settings: Live data scenario, Read plans aloud on, voice Heart. Route the laptop's sound to the room speakers, then start a new conversation. Preview the live conditions: an unsafe forecast should produce a refusal. For a controlled planning example with unavailable feeds, choose Clear skies and explicitly point out the Demo label. The local dataset and cached feeds do not remove a cloud model's network requirement.\n\n" +
        "Scenario 1 (about 1:40). Tap the microphone and say: 'Find me a half-day hike with sea views on Hong Kong Island this Saturday.' If speech recognition is unreliable in the room, type the same request. Answer whatever details are missing (for example Regular fitness and around 9:00). While the agent works, point at the search, retrieval, closure, forecast and sunset checks. Let the spoken summary finish, then open the plan. Show the safety checks, elevation, and Getting there & back with the nearby stops and route chips. Explain that those distances are straight-line and the stop list does not calculate a journey. Open the sources, including the Chinese AFCD passage behind 'sea views'.\n\n" +
        "Scenario 2 (about 0:50). Open Settings and choose Typhoon T8; the home screen shows the warning. Ask: 'Can I hike Dragon's Back tomorrow morning?' The agent checks the same sources and returns a no-go card with the reason and a later date, which is also read aloud. Switch the scenario back to Live data afterwards.\n\n" +
        "If the live demo fails, jump to the hidden backup slide at the end, which has recordings of both scenarios."
    );
  }

  // ===== 9. Evaluation =====
  pres.addSection({ title: "Evaluation" });
  {
    const s = content("Evaluation", "Evaluation", "Evaluation on 43 test scenarios", "Recorded runs from 5 Nov 2026, using frozen feeds and rule-based grading of each plan or refusal");
    const cats = [["go", "Go"], ["closure", "Closed trail"], ["weather", "Weather"], ["ability", "Ability"], ["scenery", "Scenery"], ["multi_turn", "Multi-turn"], ["out_of_scope", "Off-topic"]];
    // pptxgenjs 3.x writes a numeric 0 as a blank workbook cell. The string "0"
    // keeps the same numeric chart XML and preserves the editable source value.
    const series = (st, label) => ({ name: label, labels: cats.map((c) => c[1]), values: cats.map(([k]) => pct(st.by_cat[k][0], st.by_cat[k][1]) || "0") });
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
      `[5:35-6:10] We wrote 43 test scenarios in seven categories. Each runs the real agent on frozen feeds, a script answers question forms, and rules grade the result. These are the recorded 5 November runs, not a new evaluation of the current UI. Sonnet with tools passed ${S.n}, DeepSeek passed ${D.pass}, and both were safe on all scenarios under the suite's checks. Sonnet without tools passed ${B.pass}, with ${B.n - B.safe} unsafe answers. The display-only bus-stop feature has separate offline tests and is outside this model comparison.\n\nSources: presentation/build/stats.json, reproduced by stats.py from backend/eval/results/or-sonnet-final-*.jsonl, or-deepseek-final-*.jsonl and baseline-or-sonnet-*.jsonl; backend/tests/test_transport.py and test_rest.py.`
    );
  }

  // ===== 10. Challenges =====
  {
    const s = content("Evaluation", "Development", "Technical challenges and solutions", "Top row: safety and correctness. Bottom row: retrieval, model portability and evaluation.");
    const items = [
      [I.hash, "Hallucinated figures", "LLMs state distances, times and sunsets that sound plausible but are wrong. A server-side check compares every figure with the tool results."],
      [I.shield, "Failing safe on missing data", "An unknown trail ID or missing forecast inside the nine-day window returns an error. Dates beyond that window get provisional plans."],
      [I.rain, "Unstructured weather text", "HKO forecasts describe heavy rain in several ways, including \"showers will be heavy at times\". Regex patterns cover common phrasings."],
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

  // ===== 11. Limitations =====
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
      [I.bus, "No in-app journey routing", "Stops and route numbers are visible. Directions opens Apple Maps. The agent's travel blocks remain approximate"],
      [I.cloud, "Regional, nine-day forecasts", "No trail-level forecast. Later dates are provisional, and cached feeds may be stale"],
      [I.cpu, "Slow on local models", "qwen3:8b runs offline but takes 7 to 10 seconds per model call"],
      [I.users, "No user study yet", "The evaluation uses scripted answers; we have not yet tested the app with real hikers"],
    ], "limitations");
    col(6.9, "Future work", COL.green, [
      [I.arrow, "Journey planning", "Add directions and departure times, expose them through tools, and extend the guardrails"],
      [I.bell, "Alerts for saved plans", "Notify the user when a new warning or closure affects a planned hike"],
      [I.translate, "Traditional Chinese interface", "Expand beyond bilingual trail search to a localised interface and validated Chinese conversations"],
      [I.users2, "User study", "Measure task success, trust and usability (SUS) with hikers of different experience"],
    ], "future");
    s.addNotes("[6:35-6:50] Nearby stops, route numbers and an Apple Maps hand-off are implemented. Integrated journey routing, timetables and walking directions remain future work. Forecasts are regional and limited to nine days, and cached feeds can be stale. We also want faster local inference, saved-plan alerts, a Traditional Chinese interface beyond the existing bilingual search, and a user study.\n\nImplementation sources: backend/app/transport.py; backend/app/cache.py; mobile/src/components/trail/trail-search.tsx; mobile/src/lib/scenarios.ts; mobile/src/app/plan/[id].tsx.");
  }

  // ===== 12. Summary =====
  pres.addSection({ title: "Summary" });
  {
    const s = content("Summary", "Conclusion", "Summary", "Voice-guided hike planning, trail browsing and nearby transport references in one iOS app");
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
    s.addNotes("[6:50-7:00] TrailAI combines voice-guided planning, trail browsing and nearby transport references. The agent uses official data, the server enforces plan checks, and the recorded evaluation measures the effect. Thank you, we're happy to take questions.");
  }

  // ===== Backup (hidden) =====
  pres.addSection({ title: "Backup" });
  {
    const s = content("Backup", "Backup", "Recorded demonstration", "Earlier planning and refusal recordings, made before the nearby-stops feature");
    s.hidden = !process.env.SHOW_HIDDEN; // SHOW_HIDDEN=1 only for render checks
    const vh = 4.75, vw = vh * PHONE_AR;
    s.addMedia({ type: "video", path: media("demo_plan.mp4"), cover: "data:" + b64(media("demo_plan_poster.png")), x: 0.6, y: 1.95, w: vw, h: vh, objectName: "scenario 1 recording" });
    txt(s, "Scenario 1", { x: 3.05, y: 2.05, w: 3.3, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 1 heading" });
    txt(s, "A half-day hike with sea views on Hong Kong Island. The agent asks two questions, checks five sources and presents Hong Kong Trail Section 8. 76 seconds, sped up while the agent works.", { x: 3.05, y: 2.5, w: 3.3, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 1 caption" });
    s.addMedia({ type: "video", path: media("demo_refuse.mp4"), cover: "data:" + b64(media("demo_refuse_poster.png")), x: 6.9, y: 1.95, w: vw, h: vh, objectName: "scenario 2 recording" });
    txt(s, "Scenario 2", { x: 9.35, y: 2.05, w: 3.38, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 2 heading" });
    txt(s, "Typhoon Signal No. 8 is set as the demo scenario. The agent declines Dragon's Back, shows the evidence and suggests a later date. 31 seconds.", { x: 9.35, y: 2.5, w: 3.38, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 2 caption" });
    s.addNotes("Backup only. Both recordings were made with Claude Sonnet 5.5 on the iOS Simulator. They show the core planning and refusal flows and predate Getting there & back. Use slide 7 or the live app for that feature. Click a video to play it.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
