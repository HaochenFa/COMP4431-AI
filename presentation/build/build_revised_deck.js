// TrailAI revised feature-focused deck: writes ../TrailAI_Revised.pptx.
//
//   cd presentation/build && node build_revised_deck.js
//   OUT=/tmp/qa.pptx SHOW_HIDDEN=1 node build_revised_deck.js    # a copy with the backup slide shown, for render checks
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
const OUT = process.env.OUT || path.join(ROOT, "TrailAI_Revised.pptx");
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
const FOOTER = { text: "TrailAI    COMP4431 Group Project", options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: COL.text3, margin: 0 } };

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

  // Notes separate the spoken script from implementation references and demo setup.
  function notes(s, timing, spoken, sources = '', extra = '') {
    s.addNotes(`[${timing}]\n${spoken}${extra ? '\n\nPresenter notes\n' + extra : ''}${sources ? '\n\nSources\n' + sources : ''}`);
  }
  function lineItem(s, n, head, body, x, y, w, bodySize = 16) {
    numberDot(s, n, x, y, 0.38);
    txt(s, head, {x: x + 0.58, y, w: w - 0.58, h: 0.35, fontSize: 19, bold: true});
    txt(s, body, {x: x + 0.58, y: y + 0.43, w: w - 0.58, h: 0.76, fontSize: bodySize, color: COL.text2});
  }
  function label(s, text, x, y, w) {
    txt(s, text, {x, y, w, h: 0.28, fontSize: 11, color: COL.text3});
  }

  // 1. Cover (10 s)
  pres.addSection({title: 'Introduction'});
  {
    const s = pres.addSlide({masterName: 'TITLE', sectionTitle: 'Introduction'});
    s.addText('TrailAI', {placeholder: 'title'});
    s.addText('A chatbot for planning day hikes in Hong Kong', {placeholder: 'body'});
    txt(s, 'COMP4431 Artificial Intelligence, Group Project 2026/27', {x: 0.7, y: 5.3, w: 6.3, h: 0.35, fontSize: 15, color: COL.text2});
    txt(s, TEAM.flatMap(([name, id], i) => [
      {text: `${name} (`},
      {text: id || '[student ID]', options: id ? {} : {color: COL.caution}},
      {text: ')', options: {breakLine: i < TEAM.length - 1}},
    ]), {x: 0.7, y: 5.72, w: 6.3, h: 0.7, fontSize: 15, color: COL.text2});
    phone(s, 'plan_1.png', 7.95, 0.7, 6.1, 'A TrailAI hike plan');
    phone(s, 'chat_plan_card.png', 10.45, 1.5, 5.3, 'The plan in chat');
    notes(s, '0:00-0:10', 'Our project is TrailAI. It helps people plan day hikes in Hong Kong, using official trail data, weather forecasts and closure notices.', 'README.md; backend/app/agent/harness.py.');
  }

  // 2. The problem (20 s)
  {
    const s = content('Introduction', 'The problem', 'What we need to know before planning a hike', 'A suitable trail also depends on the weather, closures and the time available');
    const rows = [
      [I.path, 'Trail difficulty and duration', 'The route should suit the hiker’s experience and time.'],
      [I.closed, 'Trail closures', 'AFCD notices identify closures and diversions.'],
      [I.storm, 'Weather conditions', 'HKO forecasts and warnings help assess the conditions.'],
      [I.sunset, 'Available daylight', 'The hike should finish with enough time before sunset.'],
    ];
    rows.forEach(([icon, head, body], i) => {
      const y = 2.05 + i * 1.1;
      iconCircle(s, icon, 0.6, y, 0.62, head);
      txt(s, head, {x: 1.48, y, w: 5.0, h: 0.35, fontSize: 19, bold: true});
      txt(s, body, {x: 1.48, y: y + 0.43, w: 5.0, h: 0.64, fontSize: 16, color: COL.text2});
    });
    card(s, 7.0, 2.0, 5.73, 4.65, 'No-tools baseline');
    txt(s, 'Accuracy without access to tools', {x: 7.35, y: 2.3, w: 5.03, h: 0.85, fontSize: 22, bold: true});
    txt(s, `${B.figures_right} / ${B.figures_stated}`, {x: 7.35, y: 3.38, w: 5.03, h: 0.95, fontSize: 46, bold: true, color: COL.caution});
    txt(s, 'Only 26 of the 90 figures given by the model matched the official data.', {x: 7.35, y: 4.52, w: 4.85, h: 0.85, fontSize: 19, color: COL.text2});
    label(s, 'Claude Sonnet 5.5 without tools, 43 scenarios, 5 Nov 2026', 7.35, 6.1, 5.03);
    notes(s, '0:10-0:30', "When planning a hike, we need to know whether the trail suits the person, whether it is open, and whether the weather and daylight allow enough time. In our baseline test, only 26 of the 90 figures given by Sonnet matched the official data. TrailAI therefore retrieves this information through tools.", 'presentation/build/stats.json; backend/eval/baseline.py; backend/app/tools/hiking.py.');
  }

  // 3. Basic and additional features (20 s)
  pres.addSection({title: 'Features'});
  {
    const s = content('Features', 'Features', 'What TrailAI can do', 'The chatbot answers hiking questions in English and helps users plan a suitable trip');
    card(s, 0.6, 1.95, 3.55, 4.72, 'Basic features');
    txt(s, 'Basic features', {x: 0.9, y: 2.25, w: 2.95, h: 0.4, fontSize: 20, bold: true, color: COL.green});
    txt(s, 'Users can ask about trails, get recommendations and plan a day hike.\n\nIf the hike is unsuitable, TrailAI explains why.', {x: 0.9, y: 2.98, w: 2.95, h: 2.6, fontSize: 19});
    label(s, 'Domain: day hikes in Hong Kong', 0.9, 6.08, 2.95);
    const head = t => ({text: t, options: {bold: true, color: COL.green}});
    const rows = [
      [head('Additional features'), head('How they support the chatbot')],
      ['Agent workflow', 'The agent asks questions and uses tools to plan the hike.'],
      ['Safety checks', 'The server validates the data and timing in each plan.'],
      ['Trail knowledge search', 'English requests can search Chinese trail descriptions.'],
      ['Voice', 'Users can speak their requests and hear the responses.'],
      ['Native iOS interface', 'Users can explore routes, adjust plans and revisit them.'],
    ];
    s.addTable(rows, {x: 4.55, y: 1.95, w: 8.18, colW: [2.8, 5.38], rowH: 0.73,
      fontFace: 'Arial', fontSize: 16, color: COL.text, valign: 'middle', margin: [0.06, 0.1, 0.06, 0.1],
      border: [{type: 'none'}, {type: 'none'}, {pt: 0.65, color: HEX.line}, {type: 'none'}],
      objectName: 'Basic and additional feature overview'});
    notes(s, '0:30-0:50', "TrailAI handles typical hiking questions in English and helps users choose a trail and plan their day. Beyond those basic functions, we added an agent workflow, safety checks, retrieval, voice interaction and a native iOS interface. The next few slides explain how we implemented them.", 'docs/GroupProject.pdf, pages 1-3; README.md; backend/app/tools/agentic.py.', 'Supporting capabilities appear with their feature: interchangeable providers and local models on slide 4, official data and citations on slides 5-6, and nearby stops, appearance settings and demo scenarios on slides 8-9. Evaluation is evidence of performance, covered separately on slide 10.');
  }

  // 4. Agent, questions, skills and adapters (25 s)
  {
    const s = content('Features', 'Agent workflow', 'How a request becomes a plan', 'The agent gathers the information it needs before preparing a recommendation');
    phone(s, 'chat_questions_answered.png', 0.6, 1.92, 4.73, 'Tap-to-answer question cards');
    lineItem(s, 1, 'Clarifying the request', 'Question cards collect details such as fitness, date and start time. The agent pauses until the user answers.', 3.22, 2.05, 9.1);
    lineItem(s, 2, 'Using tools and skills', 'The agent can use 11 tools through a Python loop. It follows safety guidance and loads other planning procedures when needed.', 3.22, 3.35, 9.1);
    lineItem(s, 3, 'Presenting the recommendation', 'The app displays the result as a plan or a refusal, with supporting sources and options to continue the conversation.', 3.22, 4.65, 9.1);
    label(s, 'The Expo app connects to a FastAPI server, which supports hosted models and local models through Ollama.', 3.8, 6.28, 8.52);
    notes(s, '0:50-1:15', "A request often leaves out something important, such as the date or the person’s fitness level. The agent asks for those details using question cards, then calls tools through a Python loop. We also provide written planning procedures that it can load when needed. The app presents the result with its sources and options for follow-up questions.", 'backend/app/agent/harness.py; backend/app/agent/session.py; backend/app/tools/agentic.py; backend/app/llm/registry.py; mobile/src/lib/agent.tsx; mobile/src/components/chat/question-form.tsx.', 'The three adapters implement Anthropic Messages, OpenAI Chat Completions and OpenAI Responses. WebSocket events carry text, activity, question forms and result cards. Local models can take longer and need retries for unusable turns.');
  }

  // 5. Safety checks (35 s)
  {
    const s = content('Features', 'Safety checks', 'How TrailAI checks a proposed hike', 'The server verifies the supporting data before showing a plan or explaining a refusal');
    lineItem(s, 1, 'Checking current conditions', 'The agent must check closures and weather, and obtain sunset times before presenting a plan.', 0.6, 2.08, 8.85);
    lineItem(s, 2, 'Validating the plan', 'The server verifies the figures and schedule, including a finish at least 30 minutes before sunset.', 0.6, 3.45, 8.85);
    lineItem(s, 3, 'Explaining why a hike is unsuitable', 'If a closure or dangerous weather rules out a hike, the response explains the evidence and suggests an alternative when possible.', 0.6, 4.82, 8.85);
    phone(s, 'refusal_evidence.png', 10.15, 1.92, 4.73, 'Typhoon scenario with a supported refusal');
    label(s, 'When a plan fails these checks, the server tells the model what needs correcting.', 1.18, 6.28, 8.4);
    notes(s, '1:15-1:50', "We enforce several checks in the server. Before a plan can appear, the agent must check closures, weather and sunset times. The server then verifies the figures and ensures the hike finishes at least thirty minutes before sunset. If a check fails, the model receives an error and can correct its response. When the hike is unsuitable, it explains why and suggests an alternative where possible. Some decisions, including fitness and heat exposure, still require model judgement.", 'backend/app/tools/agentic.py: gate, number_check, safety_check, evidence_check; backend/app/skills/hike-safety.md.', 'The plan checker also rejects invented transport route numbers. AFTER_DARK refusals require daylight data. OUT_OF_SCOPE refusals are exempt from hiking checks and cannot name trails. Dates beyond the forecast window receive a Provisional label. These checks are not a guarantee of hiking safety.');
  }

  // 6. Retrieval (30 s)
  {
    const s = content('Features', 'Trail knowledge search', 'Finding trails that match a user’s interests', 'An English request can match an official trail description written in Chinese');
    card(s, 0.6, 2.02, 8.9, 0.85, 'Scenery query', COL.greenSoft);
    txt(s, '“I’d like a half-day hike with sea views.”', {x: 0.9, y: 2.22, w: 8.3, h: 0.44, fontSize: 22, bold: true, color: COL.green});
    const steps = [
      ['Suitable trails', 'The agent filters trails by region, duration and difficulty.'],
      ['Trail descriptions', 'bge-m3 embeddings find passages that match the request.'],
      ['Supporting sources', 'The response includes a translation and a source citation.'],
    ];
    steps.forEach(([head, body], i) => {
      const x = 0.6 + i * 3.04;
      card(s, x, 3.18, 2.82, 1.58, 'Retrieval step ' + (i+1));
      txt(s, head, {x: x+0.22, y: 3.43, w: 2.38, h: 0.37, fontSize: 18, bold: true});
      txt(s, body, {x: x+0.22, y: 3.94, w: 2.38, h: 0.65, fontSize: 15, color: COL.text2});
    });
    txt(s, '“The Dragon’s Back viewpoint overlooks Shek O, Stanley and Tai Tam Bay.”', {x: 0.8, y: 5.2, w: 8.5, h: 0.75, fontSize: 21});
    label(s, 'Translated excerpt from the AFCD description of Hong Kong Trail Section 8', 0.8, 6.04, 8.5);
    label(s, 'Distance and walking time come from the trail dataset.', 0.8, 6.38, 8.5);
    phone(s, 'plan_5_sources.png', 10.15, 1.92, 4.73, 'Cited official passages in the plan');
    notes(s, '1:50-2:20', "A user might ask for sea views without knowing which trail to choose. We filter the trails by their requirements, then use multilingual embeddings to search the official Chinese descriptions. The model translates the relevant passage and includes a citation, as shown here. This is retrieval-augmented generation. It helps explain why a trail matches the request, while distance and walking time come from the structured trail data.", 'scripts/build_knowledge.py; data/knowledge.json; backend/app/llm/embeddings.py; backend/app/tools/hiking.py:search_knowledge; data/trails.json:hk_8.', 'The index contains 127 trail descriptions split into 230 passages. The translated sentence corresponds to: 途中經過龍脊觀景台，可飽覽石澳、赤柱及大潭灣的景色。 The agent is instructed to pass candidate trail IDs to search_knowledge. Retrieval cannot supply descriptions that are absent from the official dataset.');
  }

  // 7. Voice (25 s)
  {
    const s = content('Features', 'Voice', 'Speaking to TrailAI', 'Users can speak a request and hear a short summary of the result');
    phone(s, 'plan_2.png', 0.6, 1.92, 4.73, 'Read-aloud control on a plan page');
    card(s, 3.35, 2.02, 9.38, 1.65, 'Speech input');
    iconCircle(s, I.mic, 3.65, 2.3, 0.58, 'Speech recognition');
    txt(s, 'Speech recognition', {x: 4.5, y: 2.28, w: 7.85, h: 0.4, fontSize: 22, bold: true});
    txt(s, 'As the user speaks, iOS speech recognition displays a transcript. The app sends it to the agent when recording ends.', {x: 4.5, y: 2.91, w: 7.65, h: 0.6, fontSize: 17, color: COL.text2});
    card(s, 3.35, 3.95, 9.38, 1.65, 'Speech output');
    iconCircle(s, I.phone, 3.65, 4.23, 0.58, 'Read aloud');
    txt(s, 'Reading the response aloud', {x: 4.5, y: 4.21, w: 7.85, h: 0.4, fontSize: 22, bold: true});
    txt(s, 'Kokoro-82M reads a short summary of the recommendation, with dates, times and units adapted for speech.', {x: 4.5, y: 4.84, w: 7.65, h: 0.6, fontSize: 17, color: COL.text2});
    txt(s, 'Users can choose from four Kokoro voices. If the service is unavailable, the app falls back to an installed iOS voice.', {x: 3.65, y: 6.01, w: 8.75, h: 0.6, fontSize: 15, color: COL.text2});
    notes(s, '2:20-2:45', "Users can speak their request instead of typing. iOS speech recognition displays the transcript, which we send to the agent when recording finishes. For the response, Kokoro reads a short summary of the plan or refusal. We adapt dates and units for speech and provide an iOS voice as a fallback if Kokoro is unavailable.", 'mobile/src/lib/voice.ts; mobile/src/lib/speech.ts; backend/app/tts.py; backend/app/rest.py:build_tts_router.', 'Recognition uses en-GB. The four UI choices are Heart, Emma, Michael and George. Kokoro runs locally after its model files are downloaded. Speech recognition and a hosted planning model may still require network access. Text input remains available.');
  }

  // 8. Native interface, with transport as a supporting detail (25 s)
  {
    const s = content('Features', 'Interface', 'Exploring and adjusting a hike', 'Users can review the route, ask for changes and return to their recent plans');
    phone(s, 'trails_map.png', 0.6, 1.95, 4.6, 'Trail browsing on the map');
    phone(s, 'plan_3.png', 3.02, 1.95, 4.6, 'Elevation, route and follow-up actions');
    lineItem(s, 1, 'Browsing the trails', 'Users can search 152 trails by English or Chinese names and view the results in a list or on a map.', 5.8, 2.05, 6.93, 15);
    lineItem(s, 2, 'Understanding the route', 'Maps and elevation profiles show the route and its climbs, alongside official photos and trail information.', 5.8, 3.22, 6.93, 15);
    lineItem(s, 3, 'Adjusting a plan', 'Users can ask for a shorter hike or an earlier finish, then reopen recent plans saved on their device.', 5.8, 4.39, 6.93, 15);
    txt(s, 'Other conveniences', {x: 6.38, y: 5.75, w: 5.95, h: 0.3, fontSize: 14, bold: true, color: COL.green});
    txt(s, 'The app also lists nearby bus stops, opens Apple Maps for directions and offers light and dark themes.', {x: 6.38, y: 6.15, w: 5.95, h: 0.48, fontSize: 14, color: COL.text2});
    notes(s, '2:45-3:10', "Users can browse the trails before starting a conversation or open the route from a recommendation. The map and elevation profile help them understand what the hike involves. They can then ask for something shorter or easier and revisit their recent plans. We also include nearby bus stops and a link to Apple Maps for directions.", 'mobile/src/app/(tabs)/trails/index.tsx; mobile/src/components/trail/trail-search.tsx; mobile/src/components/trail/elevation-chart.tsx; mobile/src/app/plan/[id].tsx; mobile/src/lib/recent.tsx; mobile/src/components/plan/sections.tsx.', 'The app uses Expo and React Native, native tabs, SF Symbols and Liquid Glass controls. GPX coverage is 125 trails, so elevation data is not available for all 152. Recent storage keeps up to 10 outcomes. Transport Department data supplies up to three stops within 5 km of each GPX endpoint, using straight-line distances. This does not calculate a journey or timetable.');
  }

  // 9. Live demo (2 min 15 s)
  pres.addSection({title: 'Demonstration'});
  {
    const s = content('Demonstration', 'Live demonstration', 'Demonstrating planning and safety checks', 'We will plan a hike by voice, then show how the response changes during a typhoon scenario');
    const scenario = (x, num, title, prompt, points) => {
      card(s, x, 2.02, 5.91, 4.6, 'Demo scenario ' + num);
      numberDot(s, num, x + 0.3, 2.32, 0.44);
      txt(s, title, {x: x + 0.95, y: 2.32, w: 4.55, h: 0.4, fontSize: 21, bold: true});
      txt(s, prompt, {x: x + 0.3, y: 3.1, w: 5.31, h: 1.1, fontSize: 22, color: num === 1 ? COL.green : COL.caution});
      points.forEach((t, i) => txt(s, t, {x: x + 0.3, y: 4.6 + i * 0.57, w: 5.31, h: 0.5, fontSize: 17, color: COL.text2}));
    };
    scenario(0.6, 1, 'Planning a half-day hike', '“Find me a half-day hike with sea views on Hong Kong Island.”', ['We speak a request and answer the questions.', 'The app reads the plan and shows the route.', 'We review the checks and supporting sources.']);
    scenario(6.82, 2, 'A simulated typhoon warning', '“Can I hike Dragon’s Back tomorrow morning?”', ['We enable the labelled T8 demo scenario.', 'The agent explains why the hike is unsuitable.', 'We review its suggested alternative.']);
    notes(s, '3:10-5:25 LIVE DEMO', 'Let us try this in the app. First, we will plan a half-day hike by voice. Then we will switch on the typhoon scenario and ask about Dragon\'s Back.', 'mobile/src/lib/scenarios.ts; backend/app/agent/session.py; backend/app/tools/hiking.py.', 'Before the talk: start the backend with LLM_PROFILE=claude-sonnet. Wait for /tts/voices to report ready. Enable read-aloud, choose Heart, and check room audio. Rehearse in light mode if it is clearer on the projector.\n\nScenario 1, about 90 seconds: use Live data if conditions support a planning example. If feeds are unavailable or conditions are unsafe, use Clear skies and explicitly show the Demo label. Start a new chat and say the prompt, adding this Saturday. Answer missing details, such as Regular fitness and 9:00. While the agent runs, explain the activity line. Let the spoken summary finish, open the plan, then show its checks, route/elevation and cited scenery passage. Keep scrolling brief.\n\nScenario 2, about 45 seconds: choose Typhoon T8 in Settings and point out the Demo label. Ask about Dragon\'s Back tomorrow morning. Show the refusal, evidence and later-date alternative. Other supported scenarios include red rainstorm, thunderstorm and a Dragon\'s Back closure. Restore Live data afterwards.\n\nLive latency varies. Rehearse both scenarios. If the app or network fails, use the hidden recording slide 14 and say these are recorded examples. Cached data does not make a hosted model work offline.');
  }
  // ===== 10. Evaluation (35 s) =====
  pres.addSection({ title: "Evaluation" });
  {
    const s = content("Evaluation", "Evaluation", "What the tests showed", "We tested 43 scenarios using fixed data and automated checks on 5 Nov 2026");
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
    txt(s, "Passing requires the expected outcome and constraints. Safety is assessed against each test case.", { x: 0.6, y: 6.55, w: 7.7, h: 0.3, fontSize: 11, color: COL.text3, objectName: "grading note" });
    const stat = (y, big, color, head, body, name) => {
      txt(s, big, { x: 8.75, y, w: 1.75, h: 0.8, fontSize: 30, bold: true, color, valign: "middle", objectName: name });
      txt(s, head, { x: 10.55, y: y + 0.02, w: 2.18, h: 0.34, fontSize: 13, bold: true, objectName: name + " head" });
      txt(s, body, { x: 10.55, y: y + 0.36, w: 2.18, h: 0.7, fontSize: 12, color: COL.text2, objectName: name + " body" });
    };
    stat(2.0, `${S.pass}/${S.n}`, COL.green, "Sonnet 5.5, tools", `All ${S.safe} passed the safety checks`, "stat sonnet");
    stat(3.15, `${D.pass}/${D.n}`, COL.blue, "DeepSeek, tools", `All ${D.safe} met safety criteria. The model corrected ${D.blocks_cases} blocked outputs.`, "stat deepseek");
    stat(4.3, `${B.pass}/${B.n}`, COL.danger, "Sonnet 5.5, no tools", `${B.n - B.safe} answers failed the safety checks.`, "stat baseline");
    stat(5.45, `${Math.round(S.median_seconds)} s`, COL.text, "Median per scenario", `Sonnet made a median of ${S.median_steps} model calls.`, "stat time");
    notes(s, '5:25-6:00', "We evaluated the agent on 43 scenarios using fixed weather and closure data. Sonnet passed all 43 with tools, compared with 28 without them. The version without tools also gave seven answers that failed our safety checks. DeepSeek passed 38 scenarios, although all of its results met those safety checks. This suggests that the tools help, but the evaluation uses scripted conversations, so we still need to test the app with hikers.", 'presentation/build/stats.json; backend/eval/grade.py; backend/eval/fixtures.py; backend/eval/results/or-sonnet-final-*.jsonl, or-deepseek-final-*.jsonl and baseline-or-sonnet-*.jsonl.', 'The stats file reproduces the 5 November 2026 runs. Safe means no produced plan selects a trail marked closed or unsafe for that case. A model can pass this check but fail the required outcome. DeepSeek corrected blocked outputs in four cases. Sonnet median latency was 20.9 seconds per scenario with six model calls. The UI and nearby-stop feature are outside this model comparison.');
  }

  // 11. Development challenges (20 s)
  {
    const s = content('Evaluation', 'Development', 'Implementation challenges', 'We addressed differences between model APIs, noisy elevation data and audio playback on iOS');
    const header = t => ({text: t, options: {bold: true, color: COL.green}});
    const rows = [
      [header('Challenge'), header('How we addressed it')],
      ['Different model APIs', 'Adapters preserve each provider’s tool calls and reasoning history. The agent loop stays the same.'],
      ['Noisy GPX heights', 'We filter invalid heights and smooth small fluctuations when calculating total climb.'],
      ['Streaming audio on iOS', 'We support HTTP byte-range requests for playback and fall back to an iOS voice if needed.'],
    ];
    s.addTable(rows, {x: 0.6, y: 2.0, w: 12.13, colW: [3.7, 8.43], rowH: 0.9,
      fontFace: 'Arial', fontSize: 18, color: COL.text, valign: 'middle', margin: [0.08, 0.15, 0.08, 0.15],
      border: [{type: 'none'}, {type: 'none'}, {pt: 0.75, color: HEX.line}, {type: 'none'}], objectName: 'Challenges and solutions'});
    txt(s, 'Feed snapshots help when the network fails. A missing forecast inside the nine-day window still blocks a plan.', {x: 0.8, y: 6.0, w: 11.73, h: 0.65, fontSize: 17, color: COL.text2});
    notes(s, '6:00-6:20', "Several integration details needed attention. We wrote adapters to preserve the conversation format each model expects. We also handled noise in the GPX heights when calculating climb. For audio, we added the byte-range support required by iOS playback and a device-voice fallback.", 'backend/app/llm/anthropic_messages.py; backend/app/llm/openai_chat.py; backend/app/llm/openai_responses.py; backend/app/tools/data.py:profiles; backend/app/rest.py:_byte_range; mobile/src/lib/speech.ts; backend/app/cache.py.');
  }

  // 12. Limitations and future work (15 s)
  {
    const s = content('Evaluation', 'Discussion', 'Limitations and future work', null);
    const column = (x, heading, color, rows) => {
      txt(s, heading, {x, y: 1.85, w: 5.65, h: 0.4, fontSize: 21, bold: true, color});
      rows.forEach(([head, body], i) => {
        const y = 2.53 + i * 0.94;
        txt(s, head, {x, y, w: 5.65, h: 0.3, fontSize: 18, bold: true});
        txt(s, body, {x, y: y + 0.38, w: 5.65, h: 0.48, fontSize: 15, color: COL.text2});
      });
    };
    column(0.6, 'Current limitations', COL.caution, [
      ['Regional forecasts', 'Weather forecasts cover nine days, so later plans remain provisional.'],
      ['Estimated travel times', 'The app shows nearby stops but relies on Apple Maps for directions.'],
      ['Slower local models', 'Planning can take longer when the agent makes several local model calls.'],
      ['Evaluation with simulated users', 'We have not yet tested usability with hikers.'],
    ]);
    column(7.05, 'Next steps', COL.green, [
      ['Alerts for saved plans', 'We would notify users of new warnings or closures before their trip.'],
      ['Journey planning', 'We would add tools for transport routes and timetables.'],
      ['Faster local inference', 'We would reduce repeated processing to shorten response times.'],
      ['A study with hikers', 'We would assess whether hikers find the app useful and easy to use.'],
    ]);
    label(s, 'The interface is English. Traditional Chinese support would extend the existing bilingual trail search.', 0.6, 6.6, 12.13);
    notes(s, '6:20-6:35', "The app still relies on regional forecasts and approximate travel times, and local models can be slow. We would next add journey planning and alerts for saved hikes, then evaluate the app with hikers.", 'backend/app/tools/hiking.py:get_weather; backend/app/transport.py; mobile/src/app/plan/[id].tsx; backend/eval/driver.py; mobile/src/components/trail/trail-search.tsx.', 'Cached forecasts may be stale. Current safeguards do not replace judgement about local conditions. The English interface can search Chinese names, but full Traditional Chinese UI and validated conversations remain future work.');
  }

  // 13. Closing (5 s)
  pres.addSection({title: 'Summary'});
  {
    const s = content('Summary', 'TrailAI', 'Thank you', null);
    txt(s, 'Questions?', {x: 0.6, y: 2.05, w: 12.13, h: 0.9, fontSize: 44, bold: true, color: COL.green});
    const items = [
      [I.path, 'Official trail data', 'Users can check the sources behind a recommendation.'],
      [I.shield, 'Server-side checks', 'The server validates the data and timing in each plan.'],
      [I.mic, 'Voice, maps and follow-ups', 'Users can explore the route and ask for changes.'],
    ];
    items.forEach(([icon, head, body], i) => {
      const x = 0.6 + i * 4.15;
      iconCircle(s, icon, x, 3.65, 0.65, head);
      txt(s, head, {x, y: 4.65, w: 3.78, h: 0.7, fontSize: 21, bold: true});
      txt(s, body, {x, y: 5.6, w: 3.78, h: 0.8, fontSize: 17, color: COL.text2});
    });
    notes(s, '6:35-6:40', "Thank you for listening. We are happy to take questions.", 'README.md.', 'The planned talk is 6 minutes 40 seconds, including 2 minutes 15 seconds for the live demo. This leaves 20 seconds inside the tentative seven-minute limit. Rehearsal and actual model latency determine the final pace.');
  }
  // ===== Backup (hidden) =====
  pres.addSection({ title: "Backup" });
  {
    const s = content("Backup", "Backup", "Recorded demonstration", "Recorded examples to use if the live demonstration is unavailable");
    s.hidden = !process.env.SHOW_HIDDEN; // SHOW_HIDDEN=1 only for render checks
    const vh = 4.75, vw = vh * PHONE_AR;
    s.addMedia({ type: "video", path: media("demo_plan.mp4"), cover: "data:" + b64(media("demo_plan_poster.png")), x: 0.6, y: 1.95, w: vw, h: vh, objectName: "scenario 1 recording" });
    txt(s, "Scenario 1", { x: 3.05, y: 2.05, w: 3.3, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 1 heading" });
    txt(s, "A half-day hike with sea views on Hong Kong Island. The agent asks two questions, checks five sources and presents Hong Kong Trail Section 8. 76 seconds, sped up while the agent works.", { x: 3.05, y: 2.5, w: 3.3, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 1 caption" });
    s.addMedia({ type: "video", path: media("demo_refuse.mp4"), cover: "data:" + b64(media("demo_refuse_poster.png")), x: 6.9, y: 1.95, w: vw, h: vh, objectName: "scenario 2 recording" });
    txt(s, "Scenario 2", { x: 9.35, y: 2.05, w: 3.38, h: 0.36, fontSize: 16, bold: true, color: COL.green, objectName: "recording 2 heading" });
    txt(s, "Typhoon Signal No. 8 is set as the demo scenario. The agent declines Dragon's Back, shows the evidence and suggests a later date. 31 seconds.", { x: 9.35, y: 2.5, w: 3.38, h: 2.2, fontSize: 13, color: COL.text2, objectName: "recording 2 caption" });
    s.addNotes("Backup only. Both recordings were made with Claude Sonnet 5.5 on the iOS Simulator. They show the core planning and refusal flows and predate Getting there & back. Nearby stops are a supporting part of the interface on slide 8. Click a video to play it.");
  }

  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
