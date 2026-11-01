const OBSIDIAN = require("obsidian");
const {
  Component,
  ItemView,
  Menu,
  FuzzySuggestModal,
  MarkdownPreviewRenderer,
  Modal,
  Notice,
  Platform,
  Plugin,
  TFile,
  requestUrl,
  moment,
  normalizePath,
  setIcon,
} = OBSIDIAN;

const VIEW_TYPE = "life-os-home";

const DEFAULT_FOLDERS = Object.freeze({
  daily: "01 Journal/Daily",
  weekly: "01 Journal/Weekly",
  quarterly: "01 Journal/Quarterly",
  retreats: "02 Retreats",
  projects: "04 Projects",
});

const TASK_STATUS_TYPES = Object.freeze({
  " ": "open",
  "/": "open",
  x: "closed",
  X: "closed",
  "-": "closed",
});

// Dates on screen are day-month-year (11-10-2026); files, properties, and task lines stay ISO.
function dmy(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || "");
}

function normalizeFolder(value, fallback) {
  const normalized = String(value || fallback)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized || fallback;
}

function ratingState(value) {
  if (value === undefined || value === null || value === "") {
    return { state: "missing", value: null };
  }
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 10
  ) {
    return { state: "recorded", value };
  }
  return { state: "invalid", value: null };
}

function habitState(value) {
  if (value === undefined || value === null || value === "") {
    return "missing";
  }
  if (value === true) {
    return "done";
  }
  if (value === false) {
    return "unchecked";
  }
  return "invalid";
}

const CAPTURE_ACTIONS = [
  {
    icon: "notebook-pen",
    label: "Journal",
    description: "Append a journal entry to today.",
    command: "quickadd:choice:lifeos-journal",
  },
  {
    icon: "trophy",
    label: "Log a win",
    description: "Record something worth remembering.",
    command: "quickadd:choice:lifeos-win",
  },
  {
    icon: "heart",
    label: "Gratitude",
    description: "Capture what you appreciate.",
    command: "quickadd:choice:lifeos-gratitude",
  },
  {
    icon: "check-square",
    label: "Add a task",
    description: "Send a task to the master inbox.",
    command: "quickadd:choice:lifeos-task",
  },
];

const CAPTURE_MENU_ACTIONS = [
  ...CAPTURE_ACTIONS,
  {
    icon: "lightbulb",
    label: "Project idea",
    description: "Add an idea to the Projects board.",
    command: "quickadd:choice:lifeos-project-idea",
  },
  {
    icon: "pen-line",
    label: "Post idea",
    description: "Add an idea to the Posts board.",
    command: "quickadd:choice:lifeos-post-idea",
  },
  {
    icon: "video",
    label: "Video idea",
    description: "Add an idea to the Video board.",
    command: "quickadd:choice:lifeos-video-idea",
  },
  {
    icon: "star",
    label: "Review idea",
    description: "Add an idea to the Reviews board.",
    command: "quickadd:choice:lifeos-review-idea",
  },
  {
    icon: "folder-plus",
    label: "New project",
    description: "Create a canonical project note from its template.",
    command: "quickadd:choice:lifeos-new-project",
  },
  {
    icon: "graduation-cap",
    label: "New course",
    description: "Create a course note (exam, term, lectures) from its template.",
    command: "quickadd:choice:lifeos-new-course",
  },
  {
    icon: "user-plus",
    label: "New person",
    description: "Create a private relationship note from its template.",
    command: "quickadd:choice:lifeos-new-person",
  },
  {
    icon: "file-plus-2",
    label: "New post",
    description: "Create a post draft from its template.",
    command: "quickadd:choice:lifeos-new-post",
  },
  {
    icon: "file-video-2",
    label: "New video script",
    description: "Create a video script from its template.",
    command: "quickadd:choice:lifeos-new-video",
  },
  {
    icon: "file-pen-line",
    label: "New review",
    description: "Create a review draft from its template.",
    command: "quickadd:choice:lifeos-new-review",
  },
  {
    icon: "book-plus",
    label: "New book note",
    description: "Create a book note in the local library.",
    command: "quickadd:choice:lifeos-new-book",
  },
];

const PERIOD_ACTIONS = [
  {
    icon: "calendar-days",
    label: "Today",
    description: "Open or create today’s note.",
    command: "quickadd:choice:lifeos-daily",
  },
  {
    icon: "calendar-range",
    label: "This week",
    description: "Open or create this week’s review.",
    command: "quickadd:choice:lifeos-weekly",
  },
  {
    icon: "compass",
    label: "This quarter",
    description: "Open the current quarterly note.",
    command: "quickadd:choice:lifeos-quarterly",
  },
  {
    icon: "tent-tree",
    label: "Retreat",
    description: "Open the current personal retreat.",
    command: "quickadd:choice:lifeos-retreat",
  },
];

// The Markdown dashboards were retired on 25-10-2026; a link to one in an old note opens the tab that shows the same.
const RETIRED_DASHBOARDS = { "00 Dashboards/Dashboard.md": "home", "00 Dashboards/Task Dashboard.md": "home", "00 Dashboards/Projects Dashboard.md": "projects", "00 Dashboards/Habit Canvas.md": "review", "00 Dashboards/Daily Questions.md": "review", "00 Dashboards/Boards.md": "library" };

const NAV_ITEMS = [
  { id: "home", icon: "home", label: "Home" },
  { id: "today", icon: "sun", label: "Today" },
  { id: "plan", icon: "calendar-range", label: "Plan" },
  { id: "focus", icon: "crosshair", label: "Focus" },
  { id: "review", icon: "line-chart", label: "Review" },
  { id: "projects", icon: "folder-kanban", label: "Projects" },
  { id: "people", icon: "users", label: "People" },
  { id: "create", icon: "pen-tool", label: "Create" },
  { id: "library", icon: "library", label: "Library" },
  { id: "brain", icon: "brain", label: "Brain" },
  { id: "ai", icon: "sparkles", label: "AI" },
];

const MODULES = {
  today: {
    eyebrow: "Daily operating system",
    title: "Today",
    description:
      "Choose what matters, capture what happens, and close the day honestly.",
    actions: [
      PERIOD_ACTIONS[0],
      ...CAPTURE_ACTIONS,
    ],
  },
  plan: {
    eyebrow: "Connected time horizons",
    title: "Plan",
    description:
      "Keep today, this week, and this quarter connected to the same direction.",
    actions: [
      ...PERIOD_ACTIONS,
      {
        icon: "clock-3",
        label: "Ideal week",
        description: "Check whether the plan has a place in time.",
        path: "03 Planning/Ideal Week.md",
      },
    ],
  },
  focus: {
    eyebrow: "Attention, not noise",
    title: "Focus",
    description:
      "See the commitments competing for attention and return to the work that matters.",
    actions: [],
  },
  review: {
    eyebrow: "Evidence over memory",
    title: "Review",
    description:
      "Look back across days and quarters before deciding what should change next.",
    actions: [
      PERIOD_ACTIONS[1],
      PERIOD_ACTIONS[2],
      PERIOD_ACTIONS[3],
    ],
  },
  projects: {
    eyebrow: "Outcomes with context",
    title: "Projects",
    description:
      "Keep outcomes, next actions, people, notes, and quarter commitments together.",
    actions: [
      {
        icon: "columns-3",
        label: "Projects board",
        description: "Move ideas and projects through the pipeline.",
        path: "04 Projects/Projects Board.md",
      },
      {
        icon: "lightbulb",
        label: "Capture an idea",
        description: "Add a project idea to the board.",
        command: "quickadd:choice:lifeos-project-idea",
      },
      {
        icon: "folder-plus",
        label: "New project",
        description: "Create a project note with the canonical template.",
        command: "quickadd:choice:lifeos-new-project",
      },
      {
        icon: "calendar-range",
        label: "Quarter plan",
        description: "Check which projects serve this quarter.",
        command: "quickadd:choice:lifeos-quarterly",
      },
    ],
  },
  people: {
    eyebrow: "Relationships with memory",
    title: "People",
    description:
      "Bring follow-ups, meeting context, and discussion items back to the relationship.",
    actions: [
      {
        icon: "user-plus",
        label: "New person",
        description: "Create a private person note from its template.",
        command: "quickadd:choice:lifeos-new-person",
      },
      {
        icon: "search",
        label: "Search people",
        description: "Search the vault for a person or meeting context.",
        command: "global-search:open",
      },
    ],
  },
  create: {
    eyebrow: "Ideas into finished work",
    title: "Create",
    description:
      "Move ideas into posts, video scripts, and reviews without losing sources.",
    actions: [
      ...CAPTURE_MENU_ACTIONS.filter((action) =>
        [
          "quickadd:choice:lifeos-post-idea",
          "quickadd:choice:lifeos-video-idea",
          "quickadd:choice:lifeos-review-idea",
          "quickadd:choice:lifeos-new-post",
          "quickadd:choice:lifeos-new-video",
          "quickadd:choice:lifeos-new-review",
        ].includes(action.command)
      ),
    ],
  },
  library: {
    eyebrow: "Knowledge in context",
    title: "Library",
    description:
      "Keep books, sources, and ideas close to the work they inform.",
    actions: [
      {
        icon: "book-plus",
        label: "New book note",
        description: "Create a canonical book note.",
        command: "quickadd:choice:lifeos-new-book",
      },
      {
        icon: "search",
        label: "Search the library",
        description: "Search books, sources, and connected notes.",
        command: "global-search:open",
      },
    ],
  },
  ai: {
    eyebrow: "Managed intelligence",
    title: "AI",
    description:
      "Ask, review, and draft with the vault as context while every change stays visible.",
    actions: [
      {
        icon: "sparkles",
        label: "Open assistant",
        description: "Use the complete prompt library.",
        path: "00 Dashboards/Assistant.md",
      },
      {
        icon: "shield-check",
        label: "Setup and permissions",
        description: "Review AI, MCP, and backup readiness.",
        path: "00 Dashboards/Setup.md",
      },
    ],
  },
};

const COLLECTIONS = {
  focus: {
    kind: "focus",
    title: "Active commitments",
    description: "Projects currently asking for attention.",
    types: ["project"],
    icon: "crosshair",
    empty: "No active projects yet.",
  },
  projects: {
    kind: "projects",
    title: "Project pulse",
    description: "Active project notes from your canonical project folder.",
    types: ["project"],
    icon: "folder-kanban",
    empty: "No active project notes yet.",
  },
  people: {
    kind: "people",
    title: "People directory",
    description: "Relationship notes, kept local and opened in place.",
    types: ["person"],
    icon: "users",
    empty: "No people notes yet.",
  },
  library: {
    kind: "library",
    title: "Library shelf",
    description: "Typed library notes, including finished books and sources. Samples excluded.",
    types: ["book"],
    icon: "library",
    empty: "No typed library notes yet. Add a book or source with a type property.",
  },
};


// ---------- layout: tabs and widgets, stored in a vault note ----------
const LAYOUT_PATH = "Meta/EX3C Agenda Layout.md";
// The name shown in the app (rail, header, tab title). You can change it in Configure; it is saved in the layout note.
const DEFAULT_APP_NAME = "EX3C AgendA";
// Sizes for the whole app view (Configure › Size on this device)
const APP_SCALES = [0.8, 0.9, 1, 1.1, 1.25];
// Your own widgets: every .js file in this folder is a DataviewJS view that shows up in the Widgets panel.
const USER_WIDGET_DIR = "Meta/widgets";
// The built-in widgets (planner, project steps, capture, ...) are part of the plugin: BUILTIN_VIEWS at the end
// of this file, generated from views/*.js. Meta/views/<name>.js in the vault is either a stub that runs the
// built-in code (so notes can keep calling dv.view) or the person's own copy, which then runs instead.
const VIEW_DIR = "Meta/views";
const STUB_MARK = "ex3c-builtin-widget";
// Names in the Edit widget code list; a widget missing here shows its file name.
const WIDGET_LABELS = Object.freeze({
  birthdays: "Birthdays", boards: "Board lanes", calendars: "Calendar links", capture: "Quick capture box",
  checklists: "Checklists", course: "Course note", courses: "Courses", dailyquestions: "Daily questions chart",
  habits: "Habit streaks", idealweek: "Ideal Week grid", modules: "Optional modules", planner: "Planner",
  "project-steps": "Project steps", "projects-board": "Projects board", purchases: "Purchases", quicklinks: "Quick links",
  setup: "Setup status", "setup-checks": "Setup checks", triage: "Inbox to sort", week: "Week table",
  wheel: "Wheel of life", worknote: "Work schedule note", workschedule: "Work schedule",
});
const LAYOUT_JSON_RE = /```json\n([\s\S]*?)\n```/;
const PALETTE_VIEW = "life-os-widgets";
const LAYOUT_NOTE_HEADER = `---
tags:
  - life-os
---
# EX3C AgendA layout
EX3C AgendA builds its tabs from the json block below: each tab has an id, a label, and its widgets in order. Edit it with Configure in EX3C AgendA (drag and drop), or by hand here. Widgets not in any tab wait in the Widgets panel.

`;
const WIDGETS = [
 {
  "id": "home.hero",
  "label": "Header: Open today, Ask EX3C AgendA",
  "desc": "Date, Local-first and AI status chips, two buttons.",
  "from": "Home"
 },
 {
  "id": "home.setup",
  "label": "Finish your EX3C AgendA setup",
  "desc": "Banner until Setup's status property says done.",
  "from": "Home"
 },
 {
  "id": "home.now",
  "label": "Now: top 3 that need attention",
  "desc": "Up to 3 overdue, due today, scheduled today, or high-priority tasks.",
  "from": "Home"
 },
 {
  "id": "home.brain",
  "label": "Your connected notes",
  "desc": "Brain preview of up to 300 notes.",
  "from": "Home"
 },
 {
  "id": "home.capture",
  "label": "Capture buttons",
  "desc": "Journal, Log a win, Gratitude, Add a task.",
  "from": "Home"
 },
 {
  "id": "home.signals",
  "label": "Recorded signals",
  "desc": "Scored days and mean effort over 30 days.",
  "from": "Home"
 },
 {
  "id": "today.glance",
  "label": "Today at a glance",
  "desc": "Daily questions and Habits cards for today, Open daily note, Daily questions.",
  "from": "Today"
 },
 {
  "id": "today.attention",
  "label": "Needs attention",
  "desc": "Up to 5 attention tasks.",
  "from": "Today"
 },
 {
  "id": "today.actions",
  "label": "Check-in shortcuts",
  "desc": "Today, Journal, Log a win, Gratitude, Add a task.",
  "from": "Today"
 },
 {
  "id": "plan.horizons",
  "label": "Connected horizons",
  "desc": "Today, this week, this quarter, retreat: open the note or create it.",
  "from": "Plan"
 },
 {
  "id": "plan.actions",
  "label": "Planning shortcuts",
  "desc": "Today, This week, This quarter, Retreat, Ideal week.",
  "from": "Plan"
 },
 {
  "id": "focus.groups",
  "label": "Where your attention goes",
  "desc": "Group buttons and workload bar.",
  "from": "Focus"
 },
 {
  "id": "focus.feed",
  "label": "Commitment feed",
  "desc": "Open tasks in the chosen group.",
  "from": "Focus"
 },
 {
  "id": "focus.commitments",
  "label": "Active commitments",
  "desc": "Active project notes.",
  "from": "Focus"
 },
 {
  "id": "review.effort",
  "label": "Daily effort",
  "desc": "Effort bars for 7, 30, or 90 days, with a values table.",
  "from": "Review"
 },
 {
  "id": "review.areas",
  "label": "Life areas",
  "desc": "Bars from the latest scored retreat.",
  "from": "Review"
 },
 {
  "id": "review.habits",
  "label": "Habit rhythm",
  "desc": "Done, unchecked, or no record per habit per day.",
  "from": "Review"
 },
 {
  "id": "review.week",
  "label": "Seven-day signal",
  "desc": "How much was recorded on each of the last 7 days.",
  "from": "Review"
 },
 {
  "id": "review.calendar",
  "label": "Month calendar",
  "desc": "Six-week grid; highlighted days have a daily note. Moved here from Plan on 2026-10-05.",
  "from": "Review"
 },
 {
  "id": "review.actions",
  "label": "Review shortcuts",
  "desc": "This week, This quarter, Retreat.",
  "from": "Review"
 },
 {
  "id": "projects.pulse",
  "label": "Project pulse",
  "desc": "Active project notes with tagged task counts.",
  "from": "Projects"
 },
 {
  "id": "projects.actions",
  "label": "Project shortcuts",
  "desc": "Projects board, Capture an idea, New project, Quarter plan.",
  "from": "Projects"
 },
 {
  "id": "people.directory",
  "label": "People directory",
  "desc": "Person notes with tagged task counts.",
  "from": "People"
 },
 {
  "id": "people.discuss",
  "label": "Open conversations",
  "desc": "#discuss tasks per person.",
  "from": "People"
 },
 {
  "id": "people.actions",
  "label": "People shortcuts",
  "desc": "New person, Search people.",
  "from": "People"
 },
 {
  "id": "create.studio",
  "label": "Creative studio",
  "desc": "One card per pipeline with its note count.",
  "from": "Create"
 },
 {
  "id": "create.lanes",
  "label": "Board lanes",
  "desc": "The selected board's lanes, card counts, and 3 open cards per lane.",
  "from": "Create"
 },
 {
  "id": "create.actions",
  "label": "Writing shortcuts",
  "desc": "3 idea captures, 3 new drafts.",
  "from": "Create"
 },
 {
  "id": "library.shelf",
  "label": "Library shelf",
  "desc": "Every folder in 07 Library as a book on a shelf; open one to see its notes and PDFs.",
  "from": "Library"
 },
 {
  "id": "library.actions",
  "label": "Library shortcuts",
  "desc": "New book note, Search the library.",
  "from": "Library"
 },
 {
  "id": "brain.graph",
  "label": "Your connected brain",
  "desc": "Rotatable graph with search, region filters, and Standard graph.",
  "from": "Brain"
 },
 {
  "id": "ai.control",
  "label": "AI control center",
  "desc": "Four status checks: Agent Client, MCP bridge, Prompt library, Permission policy.",
  "from": "AI"
 },
 {
  "id": "ai.diagram",
  "label": "How the parts connect",
  "desc": "Static diagram of the integration paths.",
  "from": "AI"
 },
 {
  "id": "ai.system",
  "label": "Live system",
  "desc": "Six counters: today, this week, projects, people, creative notes, AI tools.",
  "from": "AI"
 },
 {
  "id": "ai.actions",
  "label": "AI shortcuts",
  "desc": "Open assistant, Setup and permissions.",
  "from": "AI"
 },
 {
  "id": "ai.principle",
  "label": "AI-managed, human-authorized",
  "desc": "Policy text. No vault data.",
  "from": "AI"
 },
 {
  "id": "capture.ideas",
  "label": "Ideas",
  "desc": "Project, post, video, review idea.",
  "from": "Capture window"
 },
 {
  "id": "capture.create",
  "label": "Create notes",
  "desc": "Project, person, post, video script, review, book.",
  "from": "Capture window"
 },
 {
  "id": "proto.planner",
  "label": "Planner",
  "desc": "Next steps, one-click scheduling, week capacity, today by the clock.",
  "from": "Home"
 },
 {
  "id": "proto.sequence",
  "label": "Project steps",
  "desc": "Pick projects; see each as Gantt charts (one per heading) or as numbered steps with the next step and time left.",
  "from": "Projects"
 },
 {
  "id": "proto.capture",
  "label": "Quick capture box",
  "desc": "Type a task the way you say it; dates, times, length, priority and project become task fields.",
  "from": "Home"
 },
 {
  "id": "proto.projectboard",
  "label": "Projects board",
  "desc": "Every project note as a card in the column of its status (Idea, Active, Paused, Done); drag or pick a status to change it; + Idea makes a new project note.",
  "from": "Projects"
 },
 {
  "id": "proto.workschedule",
  "label": "Work schedule",
  "desc": "Your working hours per weekday and your commute: blocks in the planner that tasks are planned around, also written to 10 Areas/Work/Work schedule for Day Planner.",
  "from": "Work"
 },
 {
  "id": "proto.birthdays",
  "label": "Birthdays",
  "desc": "Coming birthdays from the birthday property of your people notes, with the age they turn; Present adds a task a week before.",
  "from": "People"
 },
 {
  "id": "proto.triage",
  "label": "Inbox to sort",
  "desc": "Every task waiting in the inbox with three buttons: Today (⏳ today), Soon (moves it under ## Soon, to plan within a month), Eventually (moves it under ## Eventually).",
  "from": "Home"
 },
 {
  "id": "proto.checklists",
  "label": "Checklists",
  "desc": "Reusable checklists (packing list, routines): progress, tick items, Reset to untick them for next time.",
  "from": "Home"
 },
 {
  "id": "proto.courses",
  "label": "Courses",
  "desc": "Each course: exam countdown, next deadline, progress, this week's study time; then study deadlines in the next four weeks.",
  "from": "Study"
 },
 {
  "id": "proto.modules",
  "label": "Optional modules",
  "desc": "Remove parts of the standard vault you do not use (wiki, retreats, writing, prompts and AI, examples); shows the list and moves it to .trash.",
  "from": "Setup"
 },
 {
  "id": "proto.purchases",
  "label": "Purchases",
  "desc": "Every priced task across projects, grouped by shop.",
  "from": "Projects"
 }
];
const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));
const DEFAULT_LAYOUT = {"tabs": [{"id": "home", "label": "Home", "widgets": ["proto.capture", "proto.triage", "home.setup", "today.attention", "proto.planner", "proto.checklists"]}, {"id": "today", "label": "Check-in", "icon": "moon", "widgets": ["today.glance", "today.actions"]}, {"id": "projects", "label": "Projects", "widgets": ["proto.projectboard", "proto.sequence", "proto.purchases", "projects.actions"]}, {"id": "work", "label": "Work", "area": "work", "widgets": ["today.attention", "proto.workschedule", "proto.planner", "proto.sequence", "projects.pulse"]}, {"id": "study", "label": "Study", "area": "study", "widgets": ["proto.courses", "today.attention", "proto.planner", "proto.sequence"]}, {"id": "personal", "label": "Personal", "area": "personal", "widgets": ["today.attention", "proto.planner", "proto.sequence", "proto.purchases"]}, {"id": "people", "label": "People", "widgets": ["people.directory", "proto.birthdays", "people.discuss", "people.actions"]}, {"id": "library", "label": "Library", "widgets": ["library.shelf", "library.actions"]}, {"id": "review", "label": "Review", "widgets": ["review.week", "review.effort", "review.habits", "review.areas", "review.calendar", "plan.horizons", "review.actions"]}, {"id": "ai", "label": "AI", "widgets": ["ai.control", "ai.diagram", "ai.system", "ai.actions", "ai.principle"]}]};
// Widgets every layout saved before 21-10-2026 already knew about (the default of that time, minus the capture box,
// which never reached saved layouts). A widget added to the default later is put on the saved layout's matching tab once.
const LEGACY_KNOWN = ["ai.actions", "ai.control", "ai.diagram", "ai.principle", "ai.system", "brain.graph", "focus.actions", "focus.commitments", "focus.feed", "focus.groups", "home.brain", "home.capture", "home.hero", "home.horizons", "home.now", "home.setup", "home.signals", "library.actions", "library.shelf", "people.actions", "people.directory", "people.discuss", "plan.actions", "plan.horizons", "projects.actions", "projects.pulse", "proto.checklists", "proto.courses", "proto.planner", "proto.projectboard", "proto.purchases", "proto.sequence", "review.actions", "review.areas", "review.calendar", "review.effort", "review.habits", "review.week", "today.actions", "today.attention", "today.glance"];
const SIDE_WIDGETS = new Set(["home.brain"]);
// Areas: a tab can be tied to one. A task belongs to an area by its #<area> tag (#work, #study, ...),
// otherwise by the area property of the note it lives in (for example a project note's area: study).
// The list comes from the area notes (type: area, read by loadAreas): each note holds its area key, colour and
// enabled switch. These three stand in until the notes are read, and for a vault without area notes.
const DEFAULT_AREAS = ["work", "study", "personal"];
let AREAS = [...DEFAULT_AREAS]; // the enabled area keys
let AREA_COLORS = {}; // key -> colour, from the area notes
const AREA_ROOT = "10 Areas";
// Work and Study are standard areas: the Work schedule (#work) and courses (10 Areas/Study) are built on them, so they
// keep their name, tag and folder; like every area they can be switched off.
const LOCKED_AREAS = ["work", "study"];
const AREA_ICONS = { work: "briefcase", study: "graduation-cap", personal: "user" };
const AREA_WIDGETS = ["today.attention", "proto.planner", "proto.sequence"];
const areaSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
// The AI module counts as on while either of these exists (the Optional modules widget removes and restores them).
const AI_MODULE_PATHS = ["Prompts", "00 Dashboards/Assistant.md"];
// Optional modules the workflow canvas shows: each counts as removed when none of its paths are left.
const MAP_MODULE_PATHS = { ai: AI_MODULE_PATHS, retreats: ["02 Retreats"], writing: ["06 Writing"] };
const WORKFLOW_CANVAS = "Guide/Workflow Map.canvas";
let AREA_TAG_RE = /(^|\s)#(work|study|personal)(?=\s|$)/i; // rebuilt from the enabled areas
// Folders that hold no real tasks for the feed (templates, docs, prompts, settings, the knowledge layer).
const TASK_EXCLUDED = ["Templates/", "scripts/", "wiki/", "Guide/", "Prompts/", "Meta/", ".trash/"];
const TAB_ICONS = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.icon]));
// Workflows: every widget belongs to one, shown as a colour on the widget, in the Widgets panel and on tabs.
// The colours are CSS variables (--wf-<id>) so a theme can change them.
const WORKFLOWS = [
  { id: "capture", label: "Capture" },
  { id: "daily", label: "Daily check-in" },
  { id: "plan", label: "Planning" },
  { id: "tasks", label: "Tasks and focus" },
  { id: "projects", label: "Projects and study" },
  { id: "review", label: "Review" },
  { id: "people", label: "People" },
  { id: "writing", label: "Writing and library" },
  { id: "system", label: "System and AI" },
  { id: "yours", label: "Your widgets" },
];
function workflowOf(id) {
  if (id.startsWith("user:")) return "yours";
  if (/^(proto\.(capture|triage)|capture\.|home\.capture)/.test(id)) return "capture";
  if (/^today\./.test(id) || /^home\.(signals|now)$/.test(id) || id === "proto.checklists") return "daily";
  if (/^(plan\.|proto\.(planner|workschedule)|home\.horizons)/.test(id)) return "plan";
  if (/^focus\./.test(id)) return "tasks";
  if (/^(projects\.|proto\.(sequence|purchases|courses|projectboard))/.test(id)) return "projects";
  if (/^review\./.test(id)) return "review";
  if (/^people\./.test(id) || id === "proto.birthdays") return "people";
  if (/^(create|library)\./.test(id)) return "writing";
  return "system";
}
// The workflow a tab mostly holds (ties go to the first widget's).
function tabWorkflow(tab) {
  const n = {};
  for (const w of tab.widgets) n[workflowOf(w)] = (n[workflowOf(w)] || 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a] || tab.widgets.findIndex((w) => workflowOf(w) === a) - tab.widgets.findIndex((w) => workflowOf(w) === b))[0] || "system";
}
// Icons to choose from for a page (Lucide names, as Obsidian ships them).
const PAGE_ICONS = ["home", "sun", "sunrise", "calendar-range", "calendar-days", "crosshair", "target", "line-chart", "folder-kanban", "graduation-cap", "book-open", "briefcase", "user", "users", "heart", "pen-tool", "library", "brain", "sparkles", "layout-grid", "list-checks", "inbox", "rocket", "flask-conical", "dumbbell", "wallet", "shopping-cart", "music", "gamepad-2", "plane", "leaf", "coffee", "lightbulb", "compass", "map", "flag", "star", "zap", "shield", "settings"];

// Themes: a preset accent for the whole app, and an accent per area so Work, Study and Personal feel different.
// No red: red means overdue everywhere, so no page may be red.
const THEME_PRESETS = { default: "#bb876e", ocean: "#3d8bd4", sky: "#4fb3d9", teal: "#2a9d8f", forest: "#4f9a6b", lime: "#8bb83a", yellow: "#d9b02a", amber: "#e3913a", ember: "#e0714f", pink: "#d35f99", violet: "#8f6bdc", indigo: "#5c6bc0", mono: "#9aa0a6" };
// Light colours (yellow, lime, sky) need dark text on their buttons.
const textOn = (hex) => { const n = parseInt(String(hex).slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 165 ? "#1e1e1e" : "#ffffff"; };
const DEFAULT_AREA_COLORS = { work: "#4a7fd4", study: "#8f6bdc", personal: "#4bb38a" };
const HEX = /^#[0-9a-f]{6}$/i;
function normalizeTheme(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const preset = THEME_PRESETS[t.preset] ? t.preset : "default";
  const areas = {};
  // area colours live in the area notes now; colours saved here before are still read for notes without one
  for (const [a, c] of Object.entries(t.areas && typeof t.areas === "object" ? t.areas : {})) if (HEX.test(c)) areas[a] = c;
  for (const a of DEFAULT_AREAS) areas[a] ??= DEFAULT_AREA_COLORS[a];
  return { preset, areas, areaTint: t.areaTint !== false };
}
function themeAccent(theme, area) {
  // a switched-off area has no colour: its pages and notes take the theme
  const own = area && AREAS.includes(area) ? AREA_COLORS[area] || theme.areas[area] : null;
  return own || THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
}
// A tab's one colour, used everywhere it shows (rail, page, Configure): its own colour, else its area's, else the theme.
function tabAccent(theme, tab) {
  return tab && HEX.test(tab.color || "") ? tab.color : themeAccent(theme, tab?.area);
}

function normalizeLayout(raw) {
  const source = raw && Array.isArray(raw.tabs) ? raw : DEFAULT_LAYOUT;
  const ids = new Set();
  const tabs = [];
  for (const tab of source.tabs) {
    if (!tab || typeof tab !== "object") continue;
    let id = String(tab.id || tab.label || "tab").toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "tab";
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    // The same widget may sit on several tabs (an area tab and a shared tab), but only once per tab.
    // home.horizons was the same widget as plan.horizons under a second name
    const widgets = [...new Set((Array.isArray(tab.widgets) ? tab.widgets : []).map(String).map((w) => ({ "home.horizons": "plan.horizons", "capture.quick": "home.capture" })[w] || w).filter((w) => WIDGET_BY_ID.has(w)))];
    // any area key is kept, also one whose note is missing or switched off, so the tab comes back with it
    const area = areaSlug(tab.area) || null;
    const color = HEX.test(String(tab.color || "")) ? String(tab.color) : null;
    tabs.push({ id, label: String(tab.label || id), ...(tab.icon ? { icon: String(tab.icon) } : {}), ...(area ? { area } : {}), ...(color ? { color } : {}), widgets });
  }
  const appName = typeof source.appName === "string" ? source.appName.trim().slice(0, 40) : "";
  const modules = source.modules && typeof source.modules === "object" && !Array.isArray(source.modules) ? source.modules : null;
  const known = Array.isArray(source.known) ? source.known.map(String) : null;
  return { tabs, theme: normalizeTheme(source.theme), ...(appName ? { appName } : {}), ...(modules ? { modules } : {}), ...(known ? { known } : {}) };
}

function makeDraggable(component, plugin, el, payload) {
  el.setAttribute("draggable", "true");
  component.registerDomEvent(el, "dragstart", (event) => {
    plugin.drag = payload;
    try { event.dataTransfer.setData("text/plain", payload.id); event.dataTransfer.effectAllowed = "move"; } catch (error) { /* ignore */ }
    el.addClass("is-dragging");
  });
  component.registerDomEvent(el, "dragend", () => { plugin.drag = null; el.removeClass("is-dragging"); });
}

function makeDropTarget(component, plugin, el, onDrop, kinds = ["widget"]) {
  component.registerDomEvent(el, "dragover", (event) => {
    if (plugin.drag && kinds.includes(plugin.drag.kind)) { event.preventDefault(); el.addClass("is-drop-over"); }
  });
  component.registerDomEvent(el, "dragleave", () => el.removeClass("is-drop-over"));
  component.registerDomEvent(el, "drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    el.removeClass("is-drop-over");
    const drag = plugin.drag;
    plugin.drag = null;
    if (drag && kinds.includes(drag.kind)) onDrop(drag);
  });
}

// The quick capture box (the capture widget) in a modal, for the phone's floating +.
class LifeOSQuickCaptureModal extends Modal {
  constructor(app, view) {
    super(app);
    this.view = view;
  }

  onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("life-os-quick-capture-modal");
    this.titleEl.setText("Quick capture");
    const api = this.app.plugins?.plugins?.dataview?.api;
    if (!api?.executeJs) {
      root.createDiv({ cls: "life-os-live-empty", text: "Quick capture needs the Dataview plugin with JavaScript queries on." });
      return;
    }
    this.component = new Component();
    this.component.load();
    const host = root.createDiv({ cls: "life-os-dataview-widget" });
    const plugin = this.view.plugin;
    const area = this.view.tabArea?.() ?? null;
    Promise.resolve(api.executeJs(`await dv.app.plugins.plugins[${JSON.stringify(plugin.manifest.id)}].runWidget("capture", dv, { area: ${JSON.stringify(area)} });`, host, this.component, LAYOUT_PATH))
      .then(() => window.setTimeout(() => host.querySelector("input, textarea")?.focus(), 50))
      .catch((error) => host.createDiv({ cls: "life-os-live-empty", text: `Could not open quick capture: ${error.message}` }));
    const more = root.createEl("button", { cls: "life-os-quick-capture-more", text: "Journal, idea or new note…" });
    more.type = "button";
    more.addEventListener("click", () => { this.close(); plugin.openCapture(); });
  }

  onClose() {
    this.component?.unload();
    this.contentEl.empty();
  }
}

class LifeOSCaptureModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("life-os-capture-modal");
    root.createEl("h2", { text: "Capture" });
    root.createEl("p", {
      text: "Choose what this is. EX3C AgendA will route it to the right place.",
    });

    const groups = [
      { title: "Quick capture", actions: CAPTURE_MENU_ACTIONS.slice(0, 4) },
      { title: "Ideas", actions: CAPTURE_MENU_ACTIONS.slice(4, 8) },
      { title: "Create notes", actions: CAPTURE_MENU_ACTIONS.slice(8) },
    ];
    for (const group of groups) {
      const section = root.createDiv({ cls: "life-os-capture-section" });
      section.createEl("h3", { text: group.title });
      const grid = section.createDiv({ cls: "life-os-capture-grid" });
      for (const action of group.actions) {
        const button = grid.createEl("button", {
          cls: "life-os-capture-choice",
        });
        button.type = "button";
        const icon = button.createSpan();
        setIcon(icon, action.icon);
        const copy = button.createSpan();
        copy.createEl("strong", { text: action.label });
        copy.createEl("small", { text: action.description });
        button.addEventListener("click", () => {
          this.close();
          this.plugin.runCommand(action.command, action.label);
        });
      }
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class LifeOSHomeView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeScreen = "home";
    this.taskSnapshot = null;
    this.refreshSequence = 0;
    this.refreshTimer = null;
    this.analyticsDays = 30;
    this.includeExamples = false;
    this.showVisuals = true;
    this.visualOptions = {};
    this.itemLimit = 6;
    this.focusGroup = "all";
    this.libraryStatus = "all";
    this.compactLayout = false;
    this.widgetComponents = [];
    this.renamingTab = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  appName() {
    return this.plugin?.layout?.appName || DEFAULT_APP_NAME;
  }

  getDisplayText() {
    return this.appName();
  }

  getIcon() {
    return "calendar-check-2";
  }

  async onOpen() {
    const refresh = () => this.queueRefresh();
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("modify", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    await this.refreshLiveData();
  }

  async onClose() {
    this.refreshSequence += 1;
    this.closeBrain();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.contentEl.empty();
  }

  queueRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshLiveData();
    }, 120);
  }

  async refreshLiveData() {
    const sequence = ++this.refreshSequence;
    this.render();
    const taskSnapshot = await this.loadTaskSnapshot();
    if (sequence !== this.refreshSequence) {
      return;
    }
    this.taskSnapshot = taskSnapshot;
    this.render();
  }

  get layout() {
    return this.plugin.layout;
  }

  currentTab() {
    const tabs = this.layout.tabs;
    const shown = (tab) => this.plugin.tabShown(tab);
    return tabs.find((tab) => tab.id === this.activeScreen && shown(tab)) || tabs.find(shown) || tabs[0] || null;
  }

  render(force = false) {
    const tab = this.currentTab();
    if (tab) this.activeScreen = tab.id;
    // Keep a live Brain graph across redraws of a tab that still shows it, so its rotation, zoom,
    // selection, and listeners survive data refreshes; its element is moved into the new page.
    this.keptBrain = this.embeddedBrain && tab?.widgets.includes("brain.graph") ? this.embeddedBrain : null;
    this.closeBrain(this.keptBrain);
    this.closeWidgetComponents();
    const root = this.contentEl;
    // A data refresh redraws the same tab: keep the reader where they were while widgets load again.
    const sameTab = this.lastRenderedTab === tab?.id;
    this.lastRenderedTab = tab?.id;
    const keepScroll = sameTab ? root.scrollTop : 0, keepHeight = sameTab ? root.scrollHeight : 0;
    root.empty();
    root.addClass("life-os-home");
    // Size on this device (Configure › Size): kept in this device's local storage, so a phone can be smaller than a desktop
    root.style.zoom = String(this.plugin.appScale());
    // theme: the tab's area colour, or the preset accent; also handed to widgets as Obsidian's accent
    const theme = this.layout.theme || normalizeTheme(null);
    const accent = tabAccent(theme, tab);
    const css = root.style;
    if (css) {
      css.setProperty("--life-os-accent", accent);
      css.setProperty("--life-os-accent-soft", `color-mix(in srgb, ${accent} 70%, white)`);
      css.setProperty("--interactive-accent", accent);
      css.setProperty("--text-on-accent", HEX.test(accent) ? textOn(accent) : "");
      css.setProperty("--text-accent", `color-mix(in srgb, ${accent} 80%, var(--text-normal))`);
      if (tab?.area && theme.areaTint) root.setAttribute("data-area", tab.area); else root.removeAttribute("data-area");
    }
    this.pageAccent = accent;
    this.plugin.applyAccent?.();
    if (this.plugin.editing) root.addClass("is-editing");
    else root.removeClass?.("is-editing");

    const frame = root.createDiv({ cls: this.compactLayout ? "life-os-app-frame is-compact" : "life-os-app-frame" });
    if (keepScroll) {
      frame.style.minHeight = `${keepHeight}px`;
      root.scrollTop = keepScroll;
      window.requestAnimationFrame(() => { root.scrollTop = keepScroll; });
      window.setTimeout(() => { if (frame.isConnected) { const at = root.scrollTop; frame.style.minHeight = ""; root.scrollTop = at; } }, 1500);
    }
    this.renderRail(frame);

    const main = frame.createEl("main", { cls: "life-os-main" });
    this.renderTopbar(main);
    if (this.plugin.editing) this.renderEditBar(main);
    if (!this.plugin.editing && tab && tab.widgets.length === 1 && tab.widgets[0] === "brain.graph") {
      // A tab that holds only the Brain graph gets the whole page, edge to edge, as before.
      this.renderBrainEmbedded(main);
      return;
    }

    const shell = main.createDiv({ cls: "life-os-shell" });
    if (!tab) {
      shell.createDiv({ cls: "life-os-live-empty", text: "No tabs yet. Press Configure, then + Tab." });
      return;
    }
    this.renderTabHeader(shell, tab);
    if (!tab.widgets.length) {
      shell.createDiv({ cls: "life-os-live-empty", text: this.plugin.editing ? "This tab is empty. Drag widgets here from the Widgets panel on the right." : "This tab is empty. Press Configure to add widgets." });
    }
    // A "side" widget (the Brain preview) sits in a narrow column beside the widget before it.
    for (let index = 0; index < tab.widgets.length; index++) {
      const next = tab.widgets[index + 1];
      if (next && SIDE_WIDGETS.has(next) && !SIDE_WIDGETS.has(tab.widgets[index])) {
        const row = shell.createDiv({ cls: "life-os-home-overview life-os-widget-row" });
        this.renderSlot(row, tab, tab.widgets[index], index);
        this.renderSlot(row, tab, next, index + 1);
        index++;
      } else {
        this.renderSlot(shell, tab, tab.widgets[index], index);
      }
    }
    // Phones: a floating + on every tab opens the quick capture box (idea from Operon, 28-10-2026)
    if (!this.plugin.editing && (Platform.isPhone || (root.clientWidth || 1000) < 600)) {
      const dock = root.createDiv({ cls: "life-os-fab-dock" });
      const fab = dock.createEl("button", { cls: "life-os-fab", attr: { "aria-label": "Quick capture", title: "Quick capture" } });
      fab.type = "button";
      setIcon(fab, "plus");
      this.registerDomEvent(fab, "click", () => new LifeOSQuickCaptureModal(this.app, this).open());
    }
    if (this.plugin.editing) {
      const end = shell.createDiv({ cls: "life-os-drop-end", text: "Drop a widget here to put it at the end of this tab" });
      makeDropTarget(this, this.plugin, end, (drag) => void this.plugin.moveWidget(drag.id, tab.id, null, drag.fromTab));
    }
  }

  renderTabHeader(shell, tab) {
    if (tab.id === "home") return;
    const module = MODULES[tab.id];
    const header = shell.createEl("header", { cls: "life-os-module-header" });
    if (module) header.createSpan({ cls: "life-os-eyebrow", text: module.eyebrow });
    header.createEl("h1", { text: tab.label });
    if (module) header.createEl("p", { text: module.description });
    if (tab.area) header.createEl("p", { cls: "life-os-area-note", text: `Showing ${this.plugin.areaName(tab.area)} only: tasks tagged #${tab.area}, and notes whose area property is ${tab.area}.` });
  }

  renderSlot(shell, tab, id, index) {
    const meta = WIDGET_BY_ID.get(id);
    const slot = shell.createDiv({ cls: "life-os-widget-slot", attr: { "data-widget": id, "data-workflow": workflowOf(id) } });
    if (this.plugin.editing) {
      slot.addClass("is-editing");
      const bar = slot.createDiv({ cls: "life-os-slot-bar", attr: { title: "Drag to move this widget" } });
      const handle = bar.createSpan({ cls: "life-os-slot-handle" });
      setIcon(handle, "grip-vertical");
      bar.createSpan({ cls: "life-os-slot-title", text: meta?.label || id });
      const controls = bar.createDiv({ cls: "life-os-slot-controls" });
      const control = (iconName, label, onClick) => {
        const button = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label, title: label } });
        button.type = "button";
        setIcon(button, iconName);
        this.registerDomEvent(button, "click", (event) => { event.stopPropagation(); onClick(); });
      };
      if (index > 0) control("arrow-up", "Earlier", () => void this.plugin.moveWidget(id, tab.id, tab.widgets[index - 1], tab.id));
      if (index < tab.widgets.length - 1) control("arrow-down", "Later", () => void this.plugin.moveWidget(id, tab.id, tab.widgets[index + 2] ?? null, tab.id));
      const move = controls.createEl("select", { cls: "dropdown", attr: { "aria-label": "Move to tab" } });
      move.createEl("option", { text: "Move to…", attr: { value: "" } });
      for (const other of this.layout.tabs) if (other !== tab) move.createEl("option", { text: other.label, attr: { value: other.id } });
      this.registerDomEvent(move, "change", () => { if (move.value) void this.plugin.moveWidget(id, move.value, null, tab.id); });
      control("x", "Remove from this tab", () => void this.plugin.removeWidget(id, tab.id));
      makeDraggable(this, this.plugin, bar, { kind: "widget", id, fromTab: tab.id });
      makeDropTarget(this, this.plugin, slot, (drag) => void this.plugin.moveWidget(drag.id, tab.id, id, drag.fromTab));
    }
    const body = slot.createDiv({ cls: "life-os-widget-body" });
    try {
      this.renderWidget(id, body);
    } catch (error) {
      console.error(`EX3C AgendA widget ${id}`, error);
      body.createDiv({ cls: "life-os-live-empty", text: `${meta?.label || id} could not be drawn: ${error.message}` });
    }
  }

  renderEditBar(main) {
    const bar = main.createDiv({ cls: "life-os-edit-bar" });
    const head = bar.createDiv({ cls: "life-os-edit-head" });
    head.createEl("strong", { text: "Editing layout" });
    head.createSpan({ text: "Drag a widget by its title bar to reorder it, onto a tab to move it there, or into the Widgets panel to take it off. Drag the tabs below to reorder them. Every change is saved to Meta/EX3C Agenda Layout.md." });
    const tabs = bar.createDiv({ cls: "life-os-edit-tabs" });
    for (const tab of this.layout.tabs) {
      const chip = tabs.createDiv({ cls: tab.id === this.activeScreen ? "life-os-edit-tab is-active" : "life-os-edit-tab", attr: { style: `--tab-accent:${tabAccent(this.layout.theme || normalizeTheme(null), tab)}` } });
      if (this.renamingTab === tab.id) {
        const input = chip.createEl("input", { attr: { type: "text", value: tab.label, "aria-label": "Tab name" } });
        let finished = false;
        const finish = (save) => {
          if (finished) return;
          finished = true;
          this.renamingTab = null;
          const value = input.value.trim();
          if (save && value && value !== tab.label) void this.plugin.renameTab(tab.id, value);
          else this.render(true);
        };
        this.registerDomEvent(input, "keydown", (event) => { if (event.key === "Enter") finish(true); if (event.key === "Escape") finish(false); });
        this.registerDomEvent(input, "blur", () => finish(true));
        window.setTimeout(() => { input.focus(); input.select(); }, 0);
        continue;
      }
      const off = !this.plugin.tabShown(tab);
      chip.createSpan({ text: `${tab.label} (${tab.widgets.length})${off ? ", off" : ""}` });
      if (off) { chip.addClass("is-off"); chip.setAttribute("title", tab.area ? `The ${this.plugin.areaName(tab.area)} area is switched off: switch it on under Areas to see this tab.` : "Hidden while the AI module is removed (Optional modules on Setup)."); }
      this.registerDomEvent(chip, "click", () => { if (off) return; this.activeScreen = tab.id; this.render(true); this.plugin.refreshPalettes(); });
      const rename = chip.createSpan({ cls: "life-os-edit-tab-action", attr: { "aria-label": "Rename", title: "Rename" } });
      setIcon(rename, "pencil");
      this.registerDomEvent(rename, "click", (event) => { event.stopPropagation(); this.renamingTab = tab.id; this.render(true); });
      const remove = chip.createSpan({ cls: "life-os-edit-tab-action", attr: { "aria-label": "Delete tab", title: "Delete tab (its widgets go back to the Widgets panel)" } });
      setIcon(remove, "x");
      this.registerDomEvent(remove, "click", (event) => {
        event.stopPropagation();
        if (window.confirm(`Delete the tab "${tab.label}"? Its widgets go back to the Widgets panel.`)) void this.plugin.deleteTab(tab.id);
      });
      makeDraggable(this, this.plugin, chip, { kind: "tab", id: tab.id });
      makeDropTarget(this, this.plugin, chip, (drag) => {
        if (drag.kind === "widget") void this.plugin.moveWidget(drag.id, tab.id, null, drag.fromTab);
        else if (drag.id !== tab.id) void this.plugin.moveTab(drag.id, tab.id);
      }, ["widget", "tab"]);
    }
    const current = this.currentTab();
    if (current) {
      const areaRow = bar.createDiv({ cls: "life-os-edit-area" });
      const label = areaRow.createEl("label", { text: `Area for “${current.label}”: ` });
      const select = label.createEl("select", { cls: "dropdown", attr: { "aria-label": "Area for this tab" } });
      for (const value of ["", ...new Set([...AREAS, ...(current.area ? [current.area] : [])])]) select.createEl("option", { text: value ? this.plugin.areaName(value) : "Everything", attr: { value } });
      select.value = current.area || "";
      this.registerDomEvent(select, "change", () => void this.plugin.setTabArea(current.id, select.value || null));
      areaRow.createSpan({ text: "A tab with an area shows only that area's tasks, projects, and plans." });
      // the tab's colour: an area tab shares its area's colour (notes with that area use it too); any other tab
      // uses the theme unless you give it its own
      const colorRow = bar.createDiv({ cls: "life-os-edit-theme life-os-edit-color" });
      const themeNow = this.layout.theme || normalizeTheme(null);
      colorRow.createSpan({ text: `Colour for “${current.label}”:` });
      if (current.area) {
        const name = this.plugin.areaName(current.area), now = this.plugin.areaColor(current.area);
        const lab = colorRow.createEl("label", { text: `${name} area colour ` });
        const input = lab.createEl("input", { attr: { type: "color", value: now, "aria-label": `${name} colour` } });
        this.registerDomEvent(input, "change", () => void this.plugin.setAreaColor(current.area, input.value));
        this.colourDots(colorRow, now, (hex) => this.plugin.setAreaColor(current.area, hex));
        colorRow.createSpan({ cls: "life-os-edit-note", text: `Shared by every ${name} page and note; kept in the area note.` });
      } else {
        const useTheme = colorRow.createEl("button", { cls: current.color ? "life-os-swatch" : "life-os-swatch is-active", attr: { style: `--sw:${themeAccent(themeNow, null)}` } });
        useTheme.type = "button";
        useTheme.createSpan({ text: "Theme colour" });
        this.registerDomEvent(useTheme, "click", () => void this.plugin.setTabColor(current.id, null));
        const lab = colorRow.createEl("label", { text: "Own colour " });
        const input = lab.createEl("input", { attr: { type: "color", value: tabAccent(themeNow, current), "aria-label": "Own colour for this tab" } });
        this.registerDomEvent(input, "change", () => void this.plugin.setTabColor(current.id, input.value));
        this.colourDots(colorRow, current.color, (hex) => this.plugin.setTabColor(current.id, hex));
      }
      const iconRow = bar.createDiv({ cls: "life-os-edit-icons" });
      iconRow.createSpan({ text: `Icon for “${current.label}”:` });
      const currentIcon = current.icon || TAB_ICONS[current.id] || AREA_ICONS[current.area] || "layout-grid";
      for (const name of PAGE_ICONS) {
        const pick = iconRow.createEl("button", { cls: name === currentIcon ? "clickable-icon is-active" : "clickable-icon", attr: { "aria-label": name, title: name } });
        pick.type = "button";
        setIcon(pick, name);
        this.registerDomEvent(pick, "click", () => void this.plugin.setTabIcon(current.id, name));
      }
    }
    // Standard pages belong to the built-in workflows: one you deleted can always be added back here.
    const missing = DEFAULT_LAYOUT.tabs.filter((std) => !this.layout.tabs.some((tab) => tab.id === std.id) && (std.id !== "ai" || this.plugin.aiOn()));
    if (missing.length) {
      const stdRow = bar.createDiv({ cls: "life-os-edit-standard" });
      stdRow.createSpan({ text: "Standard pages you removed:" });
      for (const std of missing) {
        const b = stdRow.createEl("button", { attr: { style: `--tab-accent:${tabAccent(this.layout.theme || normalizeTheme(null), std)}`, title: `Add ${std.label} back with its standard widgets` } });
        b.type = "button";
        const ic = b.createSpan(); setIcon(ic, std.icon || TAB_ICONS[std.id] || AREA_ICONS[std.area] || "layout-grid");
        b.createSpan({ text: ` + ${std.label}` });
        this.registerDomEvent(b, "click", () => void this.plugin.restoreTab(std.id));
      }
    }
    const sizeRow = bar.createDiv({ cls: "life-os-edit-theme" });
    sizeRow.createSpan({ text: "Size on this device:" });
    for (const v of APP_SCALES) {
      const b = sizeRow.createEl("button", { cls: this.plugin.appScale() === v ? "mod-cta" : "", text: `${Math.round(v * 100)}%` });
      b.type = "button";
      this.registerDomEvent(b, "click", () => this.plugin.setAppScale(v));
    }
    sizeRow.createSpan({ text: "Each phone and computer keeps its own size." });
    const nameRow = bar.createDiv({ cls: "life-os-edit-theme" });
    const nameLabel = nameRow.createEl("label", { text: "App name: " });
    const nameInput = nameLabel.createEl("input", { attr: { type: "text", value: this.appName(), maxlength: "40", placeholder: DEFAULT_APP_NAME, "aria-label": "App name" } });
    const saveName = () => { const v = nameInput.value.trim(); if (v !== this.appName()) void this.plugin.setAppName(v); };
    this.registerDomEvent(nameInput, "keydown", (event) => { if (event.key === "Enter") saveName(); });
    this.registerDomEvent(nameInput, "change", saveName);
    nameRow.createSpan({ text: "Shown in the rail, the header and the tab title. Empty restores the default." });
    const theme = this.layout.theme || normalizeTheme(null);
    const themeRow = bar.createDiv({ cls: "life-os-edit-theme" });
    themeRow.createSpan({ text: "Theme (pages without an area or their own colour):" });
    for (const [name, color] of Object.entries(THEME_PRESETS)) {
      const sw = themeRow.createEl("button", { cls: theme.preset === name ? "life-os-swatch is-active" : "life-os-swatch", attr: { title: name, "aria-label": `Theme ${name}`, style: `--sw:${color}` } });
      sw.type = "button";
      sw.createSpan({ text: name });
      this.registerDomEvent(sw, "click", () => void this.plugin.setTheme({ preset: name }));
    }
    this.renderAreaManager(bar);
    const areaColors = bar.createDiv({ cls: "life-os-edit-theme" });
    const tint = areaColors.createEl("label", { text: "Tint area pages " });
    const tintBox = tint.createEl("input", { attr: { type: "checkbox" } });
    tintBox.checked = theme.areaTint;
    this.registerDomEvent(tintBox, "change", () => void this.plugin.setTheme({ areaTint: tintBox.checked }));
    const resetColors = areaColors.createEl("button", { text: "Default colours" });
    resetColors.type = "button";
    resetColors.title = "Theme back to default and the tint on. Area colours stay: change them under Areas.";
    this.registerDomEvent(resetColors, "click", () => void this.plugin.setTheme({ preset: "default", areaTint: true }));
    const actions = bar.createDiv({ cls: "life-os-edit-actions" });
    const button = (label, onClick, cta = false) => {
      const b = actions.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
      b.type = "button";
      this.registerDomEvent(b, "click", onClick);
    };
    button("+ Tab", async () => {
      const id = await this.plugin.addTab("New tab");
      this.activeScreen = id;
      this.renamingTab = id;
      this.render(true);
    });
    button("Widgets panel", () => void this.plugin.openPalette());
    button("Open layout note", async () => { await this.plugin.saveLayout(); void this.openPath(LAYOUT_PATH); });
    button("Reset to defaults", () => {
      if (window.confirm("Replace your layout with the default EX3C AgendA tabs?")) void this.plugin.resetLayout();
    });
    button("Done", () => void this.plugin.setEditing(false), true);
  }

  closeWidgetComponents() {
    for (const component of this.widgetComponents) this.removeChild(component);
    this.widgetComponents = [];
  }

  tabWith(widgetId) {
    return this.layout.tabs.find((tab) => tab.widgets.includes(widgetId)) || null;
  }

  goToWidget(widgetId) {
    const tab = this.tabWith(widgetId);
    if (!tab) {
      new Notice("That widget is not on any tab. Press Configure to add it.");
      return;
    }
    this.activeScreen = tab.id;
    this.render(true);
  }

  renderWidget(id, parent) {
    if (!this.plugin.widgetShown(id)) return;
    const run = (action) => (action.command ? this.runCommand(action.command, action.label) : this.openPath(action.path));
    switch (id) {
      case "home.hero": return this.renderHero(parent);
      case "home.setup": return this.renderSetupBanner(parent);
      case "home.now": {
        const now = parent.createEl("section", { cls: "life-os-home-now" });
        now.createEl("h2", { text: "Now" });
        return this.renderTaskLive(now, { limit: 3, attention: true });
      }
      case "home.brain": return this.renderBrainPreview(parent);
      case "home.capture": return this.renderActionSection(parent, "Capture", "Put something into the system without breaking your flow.", CAPTURE_ACTIONS, run);
      case "home.horizons":
      case "plan.horizons": return this.renderPlanLive(parent);
      case "home.signals": return this.renderSignals(parent);
      case "today.glance": return this.renderTodayLive(parent);
      case "today.attention": return this.renderTaskLive(parent, { limit: 5, attention: true });
      case "focus.groups": return this.visualEnabled() ? this.renderFocusGroups(parent) : null;
      case "focus.feed": return this.renderTaskLive(parent, { limit: this.itemLimit, group: this.visualEnabled() ? this.focusGroup : "all" });
      case "focus.commitments": return this.renderCollectionLive(parent, COLLECTIONS.focus);
      case "review.effort": return this.renderAnalytics(parent, "effort");
      case "review.areas": return this.renderAnalytics(parent, "areas");
      case "review.habits": return this.renderAnalytics(parent, "habits");
      case "review.week": return this.renderReviewLive(parent);
      case "review.calendar": return this.renderCalendar(parent);
      case "projects.pulse": return this.renderCollectionLive(parent, COLLECTIONS.projects);
      case "people.directory": return this.renderCollectionLive(parent, COLLECTIONS.people);
      case "people.discuss": return this.renderCollectionLive(parent, { ...COLLECTIONS.people, discussionOnly: true });
      case "create.studio": return this.renderPipelineLive(parent, "studio");
      case "create.lanes": return this.renderPipelineLive(parent, "lanes");
      case "library.shelf": return this.renderBookshelf(parent);
      case "brain.graph": return this.renderBrainEmbedded(parent);
      case "ai.control": return this.renderAiLive(parent, "checks");
      case "ai.diagram": return this.renderAiLive(parent, "diagram");
      case "ai.system": return this.renderSystemSummary(parent);
      case "ai.principle": return this.renderPrinciple(parent);
      case "capture.quick": return this.renderActionSection(parent, "Quick capture", "Journal, wins, gratitude, and tasks.", CAPTURE_MENU_ACTIONS.slice(0, 4), run);
      case "capture.ideas": return this.renderActionSection(parent, "Ideas", "Drop an idea onto a board.", CAPTURE_MENU_ACTIONS.slice(4, 8), run);
      case "capture.create": return this.renderActionSection(parent, "Create notes", "New notes from their templates.", CAPTURE_MENU_ACTIONS.slice(8), run);
      case "proto.planner": return this.renderBuiltinWidget(parent, "planner", `{ folders: [""], area: ${JSON.stringify(this.tabArea())} }`);
      case "proto.sequence": return this.renderBuiltinWidget(parent, "project-steps", `{ allProjects: true, area: ${JSON.stringify(this.tabArea())} }`);
      case "proto.capture": return this.renderBuiltinWidget(parent, "capture", `{ area: ${JSON.stringify(this.tabArea())} }`);
      case "proto.projectboard": return this.renderBuiltinWidget(parent, "projects-board", `{ area: ${JSON.stringify(this.tabArea())} }`);
      case "proto.workschedule": return this.renderBuiltinWidget(parent, "workschedule");
      case "proto.birthdays": return this.renderBuiltinWidget(parent, "birthdays");
      case "proto.triage": return this.renderBuiltinWidget(parent, "triage");
      case "proto.checklists": return this.renderBuiltinWidget(parent, "checklists", `{ folder: "09 Checklists" }`);
      case "proto.courses": return this.renderBuiltinWidget(parent, "courses");
      case "proto.modules": return this.renderBuiltinWidget(parent, "modules");
      case "proto.purchases": return this.renderBuiltinWidget(parent, "purchases", `{ currency: "EUR", area: ${JSON.stringify(this.tabArea())} }`);
      default: {
        if (id.startsWith("user:")) return this.renderDataviewWidget(parent, `await dv.view(${JSON.stringify(`${USER_WIDGET_DIR}/${id.slice(5)}`)}, { area: ${JSON.stringify(this.tabArea())} });`);
        const moduleId = id.endsWith(".actions") ? id.slice(0, -".actions".length) : null;
        if (moduleId && MODULES[moduleId]) {
          if (!MODULES[moduleId].actions.length) return;
          return this.renderActionSection(parent, WIDGET_BY_ID.get(id)?.label || "Shortcuts", "Every control below opens a real note, dashboard, or capture workflow.", MODULES[moduleId].actions, run);
        }
        parent.createDiv({ cls: "life-os-live-empty", text: `Unknown widget: ${id}` });
      }
    }
  }

  renderHero(parent) {
    const hero = parent.createEl("header", { cls: "life-os-hero" });
    const identity = hero.createDiv({ cls: "life-os-identity" });
    const mark = identity.createSpan({ cls: "life-os-mark" });
    setIcon(mark, "calendar-check-2");
    const words = identity.createDiv();
    words.createEl("h1", { text: this.appName() });
    words.createEl("p", { text: "Executive function Operationalized" });
    hero.createDiv({ cls: "life-os-date", text: moment().format("dddd DD-MM-YYYY") });
    const status = hero.createDiv({ cls: "life-os-status-row" });
    this.addStatus(status, "shield-check", "Local-first", true);
    const aiReady = this.pluginLoaded("agent-client") && this.pluginLoaded("obsidian-local-rest-api");
    if (this.plugin.aiOn()) this.addStatus(status, "sparkles", aiReady ? "AI tools loaded" : "AI unavailable", aiReady);
    const heroActions = hero.createDiv({ cls: "life-os-hero-actions" });
    this.addButton(heroActions, { icon: "calendar-days", label: "Open today", description: "Start with the current day.", primary: true, onClick: () => this.runCommand("quickadd:choice:lifeos-daily", "Today’s note") });
    if (this.plugin.aiOn()) this.addButton(heroActions, { icon: "sparkles", label: "Ask EX3C AgendA", description: "Open the governed AI workspace.", onClick: () => this.openPath("00 Dashboards/Assistant.md") });
  }

  renderBrainPreview(parent) {
    if (!this.visualEnabled()) {
      parent.createDiv({ cls: "life-os-live-empty", text: "Brain preview hidden while optional visuals are off." });
      return;
    }
    const card = parent.createEl("section", { cls: "life-os-brain-card" });
    card.createEl("h2", { text: "Your connected notes" });
    const host = card.createDiv({ cls: "life-os-brain-preview" });
    this.previewBrain = new LifeOSBrainRenderer(this.app, host, true);
    this.previewBrain.brainGeometry = this.previewGeometry;
    this.addChild(this.previewBrain);
    this.addButton(card, { icon: "brain", label: "Explore Brain", description: "Open the full graph.", onClick: () => {
      if (this.tabWith("brain.graph")) this.goToWidget("brain.graph");
      else void this.app.workspace.getLeaf("tab").setViewState({ type: "life-os-brain", active: true });
    } });
  }

  renderBrainEmbedded(parent) {
    if (this.keptBrain) {
      parent.appendChild(this.keptBrain.contentEl);
      this.embeddedBrain = this.keptBrain;
      this.keptBrain = null;
      window.requestAnimationFrame(() => this.embeddedBrain?.draw?.());
      return;
    }
    const host = parent.createDiv({ cls: "life-os-brain-embedded" });
    this.embeddedBrain = new LifeOSBrainRenderer(this.app, host);
    this.addChild(this.embeddedBrain);
  }

  renderSignals(parent) {
    const signals = parent.createEl("section", { cls: "life-os-signals" });
    const model = this.getAnalytics();
    signals.createEl("h2", { text: "Recorded signals" });
    signals.createEl("p", { text: `${model.scored} scored days in ${this.analyticsDays} days · ${model.average === null ? "No effort scores yet" : `${model.average.toFixed(1)} / 10 mean daily effort`}. Missing days are not zero.${this.includeExamples ? " Samples included." : " Samples excluded."}` });
    if (this.tabWith("review.effort")) this.addButton(signals, { icon: "chart-line", label: "Explore Review", description: "Effort, habit rhythm, and life areas.", onClick: () => this.goToWidget("review.effort") });
  }

  renderPrinciple(parent) {
    const note = parent.createEl("section", { cls: "life-os-principle" });
    const icon = note.createSpan();
    setIcon(icon, "shield-check");
    const copy = note.createDiv();
    copy.createEl("strong", { text: "AI-managed, human-authorized" });
    copy.createEl("p", { text: "EX3C AgendA can retrieve, summarize, and draft. Review context before sending. Human approval is the operating policy, not a guarantee enforced across every connected tool." });
  }

  // A built-in widget (the plugin's code, or your copy in Meta/views) drawn through Dataview; input is JS source.
  renderBuiltinWidget(parent, name, input = "undefined") {
    return this.renderDataviewWidget(parent, `await dv.app.plugins.plugins[${JSON.stringify(this.plugin.manifest.id)}].runWidget(${JSON.stringify(name)}, dv, ${input});`);
  }

  renderDataviewWidget(parent, code) {
    const api = this.app.plugins?.plugins?.dataview?.api;
    if (!api?.executeJs) {
      parent.createDiv({ cls: "life-os-live-empty", text: "This widget needs the Dataview plugin with JavaScript queries on." });
      return;
    }
    const component = new Component();
    this.addChild(component);
    this.widgetComponents.push(component);
    const host = parent.createDiv({ cls: "life-os-dataview-widget" });
    Promise.resolve(api.executeJs(code, host, component, LAYOUT_PATH)).catch((error) => {
      host.createDiv({ cls: "life-os-live-empty", text: `Could not draw this widget: ${error.message}` });
    });
  }

  closeBrain(keep = null) {
    if (this.embeddedBrain && this.embeddedBrain !== keep) this.removeChild(this.embeddedBrain);
    if (this.previewBrain) {
      this.previewGeometry = this.previewBrain.brainGeometry;
      this.removeChild(this.previewBrain);
    }
    this.previewBrain = null;
    this.embeddedBrain = null;
  }

  isExample(data) {
    const tags = Array.isArray(data.tags) ? data.tags : String(data.tags || "").split(/[\s,]+/);
    return data.example === true || tags.some((tag) => String(tag).replace(/^#/, "") === "example");
  }

  getAnalytics() {
    const config = this.getConfigFrontmatter();
    const paths = this.getConfiguredFolders(config);
    const folder = paths.daily;
    const today = moment().format("YYYY-MM-DD");
    const end = new Date(`${today}T12:00:00Z`);
    const days = Array.from({ length: this.analyticsDays }, (_, i) => {
      const date = new Date(end);
      date.setUTCDate(date.getUTCDate() - this.analyticsDays + 1 + i);
      return { date: date.toISOString().slice(0, 10), data: null, score: null };
    });
    const byDate = new Map(days.map((day) => [day.date, day]));
    const habits = new Set(this.getHabitKeys(config));
    let samples = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${folder}/`)) continue;
      const date = file.path.slice(folder.length + 1).replace(/\.md$/, "");
      const day = byDate.get(date);
      if (!day) continue;
      const data = this.getFrontmatter(file);
      if (this.isExample(data)) {
        samples += 1;
        if (!this.includeExamples) continue;
      }
      day.data = data;
      const scores = Object.entries(data)
        .filter(([key, value]) =>
          key.startsWith(config.dq_prefix || "dq_") &&
          ratingState(value).state === "recorded"
        )
        .map(([, value]) => value);
      day.score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      Object.keys(data).filter((key) => key.startsWith(config.habit_prefix || "habit_")).forEach((key) => habits.add(key));
    }
    const scored = days.filter((day) => day.score !== null);
    const average = scored.length ? scored.reduce((sum, day) => sum + day.score, 0) / scored.length : null;
    const retreatFolder = paths.retreats;
    const retreats = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${retreatFolder}/`))
      .filter((file) => this.includeExamples || !this.isExample(this.getFrontmatter(file)))
      .sort((a, b) => b.path.localeCompare(a.path));
    const retreat = retreats.find((file) => Object.entries(this.getFrontmatter(file)).some(([key, value]) =>
      key.startsWith(config.wheel_prefix || "wheel_") && ratingState(value).state === "recorded"));
    const wheel = retreat ? Object.entries(this.getFrontmatter(retreat)).filter(([key, value]) =>
      key.startsWith(config.wheel_prefix || "wheel_") && ratingState(value).state === "recorded") : [];
    return { days, habits: [...habits], samples, average, scored: scored.length, wheel, retreat };
  }

  renderAnalytics(parent, only = null) {
    const model = this.getAnalytics();
    const section = parent.createEl("section", { cls: "life-os-analytics" });
    const heading = section.createDiv({ cls: "life-os-analytics-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: only ? { effort: "Daily effort", areas: "Life areas", habits: "Habit rhythm" }[only] : "Your life, in view" });
    copy.createEl("p", { text: this.includeExamples
      ? "Sample notes included. These charts may contain demonstration data."
      : "Recorded effort and habits. Blank days mean no data, not zero." });
    const controls = heading.createDiv({ cls: "life-os-chart-controls" });
    for (const count of [7, 30, 90]) {
      const button = controls.createEl("button", {
        text: `${count} days`, attr: { "aria-pressed": String(this.analyticsDays === count) },
      });
      button.type = "button";
      button.addEventListener("click", () => { this.analyticsDays = count; this.render(); });
    }
    const sample = controls.createEl("button", {
      text: this.includeExamples ? "Samples on" : "Include samples",
      attr: { "aria-pressed": String(this.includeExamples) },
    });
    sample.type = "button";
    sample.addEventListener("click", () => { this.includeExamples = !this.includeExamples; this.render(); });

    const grid = section.createDiv({ cls: "life-os-chart-grid" });
    if (!only || only === "effort") {
    const effort = grid.createDiv({ cls: "life-os-chart-card life-os-effort-chart" });
    effort.createEl("h3", { text: "Daily effort" });
    effort.createEl("strong", { cls: "life-os-chart-number", text: model.average === null ? "No scores yet" : `${model.average.toFixed(1)} / 10` });
    effort.createEl("p", { text: `${model.scored} scored days · mean of recorded daily questions` });
    const plot = effort.createDiv({ cls: "life-os-effort-plot", attr: { role: "list", "aria-label": "Daily effort scores" } });
    for (const day of model.days) {
      const label = `${dmy(day.date)}: ${day.score === null ? "No score recorded" : `${day.score.toFixed(1)} out of 10`}`;
      const column = plot.createDiv({ cls: "life-os-effort-column", attr: { role: "listitem", "aria-label": label, title: label } });
      column.createDiv({ cls: day.score === null ? "life-os-effort-bar is-missing" : "life-os-effort-bar",
        attr: { style: `height:${day.score === null ? 2 : day.score * 10}%` } });
      if (day.data) {
        column.setAttribute("role", "button");
        column.setAttribute("tabindex", "0");
        const open = () => void this.openPath(`${this.getConfiguredFolders().daily}/${day.date}.md`);
        this.registerDomEvent(column, "click", open);
        this.registerDomEvent(column, "keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
      }
    }
    const axis = effort.createDiv({ cls: "life-os-chart-axis" });
    axis.createSpan({ text: dmy(model.days[0].date) });
    axis.createSpan({ text: dmy(model.days[model.days.length - 1].date) });
    const details = effort.createEl("details", { cls: "life-os-chart-details" });
    details.createEl("summary", { text: "Read daily values" });
    const table = details.createEl("table", { cls: "life-os-chart-table" });
    const header = table.createEl("thead").createEl("tr");
    header.createEl("th", { text: "Date", attr: { scope: "col" } });
    header.createEl("th", { text: "Effort (1 to 10)", attr: { scope: "col" } });
    const body = table.createEl("tbody");
    for (const day of model.days) {
      const row = body.createEl("tr");
      row.createEl("th", { text: dmy(day.date), attr: { scope: "row" } });
      row.createEl("td", { text: day.score === null ? "Not recorded" : day.score.toFixed(1) });
    }

    }
    if (!only || only === "areas") {
    const wheel = grid.createDiv({ cls: "life-os-chart-card" });
    wheel.createEl("h3", { text: "Life areas" });
    wheel.createEl("p", { text: model.retreat ? `Latest scored retreat: ${this.getFileTitle(model.retreat)}` : "Your next retreat will bring this view to life." });
    for (const [key, value] of model.wheel) {
      const row = wheel.createDiv({ cls: "life-os-wheel-row" });
      row.createSpan({ text: this.formatPropertyLabel(key) });
      const track = row.createDiv({ cls: "life-os-wheel-track", attr: { role: "meter", "aria-label": this.formatPropertyLabel(key), "aria-valuemin": "0", "aria-valuemax": "10", "aria-valuenow": String(value) } });
      track.createDiv({ cls: "life-os-wheel-fill", attr: { style: `width:${value * 10}%` } });
      row.createSpan({ text: `${value}/10` });
    }
    if (!model.wheel.length) wheel.createDiv({ cls: "life-os-live-empty", text: "No life-area scores recorded. Open Retreat from Plan to add your own." });
    if (model.retreat) this.addButton(wheel, { icon: "book-open", label: "Open scored retreat", description: "See the source of these life-area scores.", onClick: () => this.openPath(model.retreat.path) });

    }
    if (!only || only === "habits") {
    const habits = grid.createDiv({ cls: "life-os-chart-card life-os-habit-chart" });
    habits.createEl("h3", { text: "Habit rhythm" });
    habits.createEl("p", { text: "Filled: done · muted: unchecked · outlined: no record. Hover a day for details." });
    const matrix = habits.createDiv({ cls: "life-os-habit-matrix" });
    for (const key of model.habits) {
      const row = matrix.createDiv({ cls: "life-os-habit-row" });
      row.createSpan({ text: this.formatPropertyLabel(key) });
      const cells = row.createDiv({ cls: "life-os-habit-cells" });
      let done = 0, recorded = 0;
      for (const day of model.days) {
        const value = day.data?.[key];
        if (typeof value === "boolean") recorded += 1;
        if (value === true) done += 1;
        const label = `${dmy(day.date)}, ${this.formatPropertyLabel(key)}: ${value === true ? "Done" : value === false ? "Unchecked" : "No record"}`;
        cells.createSpan({ cls: `life-os-habit-cell ${value === true ? "is-done" : value === false ? "is-open" : "is-missing"}`,
          attr: { title: label, "aria-label": label, role: "img" } });
      }
      row.createSpan({ text: recorded ? `${done}/${recorded}` : "No data" });
    }
    if (!model.habits.length) habits.createDiv({ cls: "life-os-live-empty", text: "Add your habits in Configure to begin." });
    }
  }

  renderRail(parent) {
    const rail = parent.createEl("aside", { cls: "life-os-rail", attr: { "aria-label": `${this.appName()} navigation` } });
    const brand = rail.createEl("button", { cls: "life-os-rail-brand", attr: { "aria-label": "Open the first tab" } });
    brand.type = "button";
    const mark = brand.createSpan();
    setIcon(mark, "calendar-check-2");
    brand.createSpan({ text: this.appName(), cls: this.appName().length > 8 ? "is-long" : "" });
    brand.addEventListener("click", () => {
      this.activeScreen = this.layout.tabs[0]?.id ?? null;
      this.render(true);
    });
    const nav = rail.createEl("nav", { cls: "life-os-nav" });
    for (const tab of this.layout.tabs) {
      if (!this.plugin.tabShown(tab)) continue;
      const active = this.activeScreen === tab.id;
      const own = !!(tab.area || tab.color);
      const button = nav.createEl("button", { cls: active ? "life-os-nav-button is-active" : "life-os-nav-button", attr: { "aria-current": active ? "page" : "false", title: tab.label, ...(own ? { "data-own-color": "", ...(tab.area ? { "data-area": tab.area } : {}) } : {}), style: `--tab-accent:${tabAccent(this.layout.theme || normalizeTheme(null), tab)}` } });
      button.type = "button";
      const icon = button.createSpan();
      setIcon(icon, tab.icon || TAB_ICONS[tab.id] || AREA_ICONS[tab.area] || "layout-grid");
      button.createSpan({ text: tab.label });
      button.addEventListener("click", () => {
        this.activeScreen = tab.id;
        this.render(true);
        this.plugin.refreshPalettes();
      });
      if (this.plugin.editing) makeDropTarget(this, this.plugin, button, (drag) => void this.plugin.moveWidget(drag.id, tab.id, null, drag.fromTab));
    }
    // On a narrow screen the tabs are one row that scrolls sideways: fade the edge that has more tabs past it,
    // and bring the open tab into view.
    const edges = () => {
      const more = nav.scrollWidth - nav.clientWidth > 2;
      nav.toggleClass("is-more-left", more && nav.scrollLeft > 2);
      nav.toggleClass("is-more-right", more && nav.scrollLeft < nav.scrollWidth - nav.clientWidth - 2);
    };
    this.registerDomEvent(nav, "scroll", edges, { passive: true });
    window.requestAnimationFrame(() => {
      const on = nav.querySelector(".life-os-nav-button.is-active");
      if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
      edges();
    });
    const local = rail.createDiv({ cls: "life-os-rail-foot" });
    const localIcon = local.createSpan();
    setIcon(localIcon, "hard-drive");
    local.createSpan({ text: "Local vault" });
  }

  renderTopbar(parent) {
    const topbar = parent.createEl("header", { cls: "life-os-topbar" });
    const context = topbar.createDiv({ cls: "life-os-topbar-context" });
    context.createSpan({ text: this.appName() });
    context.createEl("strong", { text: this.getScreenTitle() });

    const actions = topbar.createDiv({ cls: "life-os-topbar-actions" });
    this.addTopbarButton(actions, "search", "Search", () => {
      this.runCommand("global-search:open", "Search");
    });
    this.addTopbarButton(actions, this.plugin.editing ? "check" : "settings-2", this.plugin.editing ? "Done" : "Configure", () => {
      void this.plugin.setEditing(!this.plugin.editing);
    });
    const display = actions.createEl("details", { cls: "life-os-display-options" });
    display.createEl("summary", { text: "View" });
    const options = display.createDiv();
    options.createEl("p", { text: "This view only. No vault settings changed." });
    const density = options.createEl("button", { text: this.compactLayout ? "Use comfortable spacing" : "Use compact spacing" });
    density.type = "button";
    this.registerDomEvent(density, "click", () => { this.compactLayout = !this.compactLayout; this.render(true); });
    const visuals = options.createEl("button", { text: this.showVisuals ? "Hide optional visuals" : "Show optional visuals" });
    visuals.type = "button";
    this.registerDomEvent(visuals, "click", () => { this.showVisuals = !this.showVisuals; this.render(true); });
    {
      const local = options.createEl("button", { text: this.visualOptions[this.activeScreen] === false ? "Show this tab's visuals" : "Hide this tab's visuals" });
      local.type = "button";
      this.registerDomEvent(local, "click", () => { this.visualOptions[this.activeScreen] = this.visualOptions[this.activeScreen] === false; this.render(true); });
    }
    const label = options.createEl("label", { text: "Items per list " });
    const limit = label.createEl("select", { attr: { "aria-label": "Items per list" } });
    for (const count of [3, 6, 12]) limit.createEl("option", { text: String(count), attr: { value: String(count) } });
    limit.value = String(this.itemLimit);
    this.registerDomEvent(limit, "change", () => { this.itemLimit = Number(limit.value); this.render(true); });
    const reset = options.createEl("button", { text: "Restore view defaults" });
    reset.type = "button";
    this.registerDomEvent(reset, "click", () => { this.showVisuals = true; this.visualOptions = {}; this.itemLimit = 6; this.compactLayout = false; this.focusGroup = "all"; this.libraryStatus = "all"; this.libraryType = "all"; this.pipelinePath = null; this.render(true); });
    this.addTopbarButton(actions, "plus", "Capture", () => {
      this.plugin.openCapture();
    }, true);
  }

  visualEnabled() { return this.showVisuals && this.visualOptions[this.activeScreen] !== false; }

  addTopbarButton(parent, iconName, label, onClick, primary = false) {
    const button = parent.createEl("button", {
      attr: { "aria-label": label, title: label },
      cls: primary
        ? "life-os-topbar-button is-primary"
        : "life-os-topbar-button",
    });
    button.type = "button";
    const icon = button.createSpan();
    setIcon(icon, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", onClick);
  }

  getScreenTitle() {
    return this.currentTab()?.label || this.appName();
  }

  renderTodayLive(parent) {
    const data = this.getTodayData();
    const section = parent.createEl("section", { cls: "life-os-today-live" });
    const heading = section.createDiv({ cls: "life-os-today-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: "Today at a glance" });
    copy.createEl("p", {
      text: "A private view of today’s properties. Journal text stays out of this screen.",
    });

    if (!data.exists) {
      heading.createSpan({ cls: "life-os-progress-chip", text: "Not started" });
      const empty = section.createDiv({ cls: "life-os-today-empty" });
      const icon = empty.createSpan();
      setIcon(icon, "sunrise");
      const emptyCopy = empty.createDiv();
      emptyCopy.createEl("strong", { text: "Create today’s note" });
      emptyCopy.createEl("p", {
        text: "EX3C AgendA will use your configured questions and habits.",
      });
      this.addButton(empty, {
        icon: "plus",
        label: "Start today",
        description: "Create or open today’s daily note.",
        primary: true,
        onClick: () =>
          this.runCommand("quickadd:choice:lifeos-daily", "Today’s note"),
      });
      return;
    }

    const completed = data.questionRecorded + data.habitRecorded;
    const total = data.questions.length + data.habits.length;
    if (this.visualEnabled() && total) {
      const meter = section.createEl("progress", { cls: "life-os-checkin-meter", attr: { max: String(total), value: String(completed), "aria-label": `${completed} of ${total} check-in properties recorded, not a completion score` } });
      meter.textContent = `${completed}/${total} recorded`;
    }
    heading.createSpan({
      cls: "life-os-progress-chip is-active",
      text: total ? `${completed} of ${total} checked in` : "Ready",
    });

    const grid = section.createDiv({ cls: "life-os-today-grid" });
    this.renderTodayList(
      grid,
      "Daily questions",
      "Rate effort from 1 to 10.",
      data.questions,
      "line-chart"
    );
    this.renderTodayList(
      grid,
      "Habits",
      "A signal, never a judgment.",
      data.habits,
      "activity"
    );

    const actions = section.createDiv({ cls: "life-os-today-actions" });
    this.addButton(actions, {
      icon: "file-text",
      label: "Open daily note",
      description: "See the complete context for today.",
      onClick: () => this.openPath(data.path),
    });
    this.addButton(actions, {
      icon: "message-circle-question",
      label: "Daily questions",
      description: "Run the guided evening check-in.",
      primary: true,
      onClick: () => void this.runDailyQuestions(data.path),
    });
  }

  // Templater can only run the Daily Questions prompt in an open editor, so today's note is opened first
  // (and created first if it does not exist yet).
  async runDailyQuestions(path) {
    let file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile)) {
      this.runCommand("quickadd:choice:lifeos-daily", "Create today's note");
      for (let i = 0; i < 20 && !(file instanceof TFile); i++) { await new Promise((r) => window.setTimeout(r, 250)); file = path ? this.app.vault.getAbstractFileByPath(path) : null; }
      if (!(file instanceof TFile)) { new Notice("Create today's daily note first (Ctrl/Cmd+Shift+D), then run Daily questions."); return; }
    }
    let leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => l.view?.file?.path === file.path);
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.openFile(file, { state: { mode: "source" } }); }
    else if (leaf.view.getMode?.() !== "source") await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: "source" } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => window.setTimeout(r, 300));
    this.runCommand("templater-obsidian:Templates/Daily Questions Prompt.md", "Daily questions");
  }

  renderTodayList(parent, title, description, rows, iconName) {
    const card = parent.createDiv({ cls: "life-os-today-card" });
    const heading = card.createDiv({ cls: "life-os-today-card-heading" });
    const icon = heading.createSpan();
    setIcon(icon, iconName);
    const copy = heading.createDiv();
    copy.createEl("h3", { text: title });
    copy.createEl("p", { text: description });

    const list = card.createDiv({ cls: "life-os-today-list" });
    for (const row of rows) {
      const item = list.createDiv({ cls: "life-os-today-row" });
      item.createSpan({ text: row.label });
      item.createSpan({
        cls: row.complete
          ? "life-os-today-value is-complete"
          : "life-os-today-value",
        text: row.display,
      });
    }
  }

  getTodayData() {
    const config = this.getConfigFrontmatter();
    const paths = this.getConfiguredFolders(config);
    const todayPath = `${paths.daily}/${moment().format("YYYY-MM-DD")}.md`;
    const todayFile = this.app.vault.getAbstractFileByPath(todayPath);
    const today = this.getFrontmatter(todayFile);
    const questionConfig = Array.isArray(config.questions) ? config.questions : [];
    const habitConfig = Array.isArray(config.habits) ? config.habits : [];

    const questions = questionConfig
      .map((question) => {
        const key = String(question?.key || question || "");
        const result = ratingState(today[key]);
        const recorded = result.state === "recorded";
        return {
          key,
          label:
            String(question?.text || "").trim() || this.formatPropertyLabel(key),
          state: result.state,
          recorded,
          complete: recorded,
          display: recorded
            ? `${result.value}/10`
            : result.state === "invalid"
              ? "Invalid value"
              : "Not rated",
        };
      })
      .filter((question) => question.key);
    const habits = habitConfig
      .map((habit) => String(habit || ""))
      .filter(Boolean)
      .map((key) => {
        const state = habitState(today[key]);
        return {
          key,
          label: this.formatPropertyLabel(key),
          state,
          recorded: state === "done" || state === "unchecked",
          complete: state === "done",
          display:
            state === "done"
              ? "Done"
              : state === "unchecked"
                ? "Unchecked"
                : state === "invalid"
                  ? "Invalid value"
                  : "Not recorded",
        };
      });

    return {
      exists: todayFile instanceof TFile,
      path: todayPath,
      questions,
      habits,
      questionRecorded: questions.filter((question) => question.recorded).length,
      habitRecorded: habits.filter((habit) => habit.recorded).length,
      habitDone: habits.filter((habit) => habit.complete).length,
    };
  }

  formatPropertyLabel(key) {
    return String(key)
      .replace(/^(dq|habit|wheel)_/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  renderPlanLive(parent) {
    const paths = this.getConfiguredFolders();
    const horizons = [
      {
        icon: "sun",
        label: "Today",
        period: moment().format("DD-MM-YYYY"),
        path: `${paths.daily}/${moment().format("YYYY-MM-DD")}.md`,
        command: "quickadd:choice:lifeos-daily",
      },
      {
        icon: "calendar-range",
        label: "This week",
        period: moment().format("[Week] ww"),
        path: `${paths.weekly}/${moment().format("gggg-[W]ww")}.md`,
        command: "quickadd:choice:lifeos-weekly",
      },
      {
        icon: "compass",
        label: "This quarter",
        period: moment().format("YYYY-[Q]Q"),
        path: `${paths.quarterly}/${moment().format("YYYY-[Q]Q")}.md`,
        command: "quickadd:choice:lifeos-quarterly",
      },
      {
        icon: "tent-tree",
        label: "Retreat",
        period: moment().format("YYYY-[Q]Q"),
        path: `${paths.retreats}/${moment().format("YYYY-[Q]Q")} Personal Retreat.md`,
        command: "quickadd:choice:lifeos-retreat",
      },
    ];
    const section = parent.createEl("section", { cls: "life-os-plan-live" });
    this.renderLiveHeading(
      section,
      "Connected horizons",
      "Each layer is ready when its canonical note exists.",
      `${horizons.filter((item) => this.fileExists(item.path)).length} of ${horizons.length} notes created`
    );
    const grid = section.createDiv({ cls: "life-os-horizon-grid" });
    for (const horizon of horizons) {
      const ready = this.fileExists(horizon.path);
      const button = grid.createEl("button", { cls: "life-os-horizon-card" });
      button.type = "button";
      const icon = button.createSpan({ cls: "life-os-horizon-icon" });
      setIcon(icon, horizon.icon);
      const copy = button.createDiv();
      copy.createEl("strong", { text: horizon.label });
      copy.createSpan({ text: horizon.period });
      button.createSpan({
        cls: ready ? "life-os-record-status is-ready" : "life-os-record-status",
        text: ready ? "Open note" : "Create note",
      });
      this.registerDomEvent(button, "click", () => {
        if (ready) {
          void this.openPath(horizon.path);
        } else {
          this.runCommand(horizon.command, horizon.label);
        }
      });
    }
  }

  renderCalendar(parent) {
    const today = moment().format("YYYY-MM-DD");
    const base = new Date(`${today}T12:00:00Z`);
    const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + (this.calendarOffset || 0), 1, 12));
    const section = parent.createEl("section", { cls: "life-os-calendar" });
    const toolbar = section.createDiv({ cls: "life-os-calendar-toolbar" });
    toolbar.createEl("h2", { text: month.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) });
    for (const [label, delta] of [["Previous month", -1], ["This month", 0], ["Next month", 1]]) {
      const button = toolbar.createEl("button", { text: label });
      button.type = "button";
      this.registerDomEvent(button, "click", () => { this.calendarOffset = delta ? (this.calendarOffset || 0) + delta : 0; this.render(); });
    }
    const grid = section.createDiv({ cls: "life-os-calendar-grid" });
    const firstDay = moment.localeData?.().firstDayOfWeek?.() ?? 1;
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "life-os-calendar-weekday", text: new Date(Date.UTC(2026, 0, 4 + (firstDay + i) % 7)).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }) });
    const offset = (month.getUTCDay() - firstDay + 7) % 7;
    const folder = this.getConfiguredFolders().daily;
    for (let i = 0; i < 42; i++) {
      const date = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1 - offset + i, 12));
      const iso = date.toISOString().slice(0, 10);
      const path = `${folder}/${iso}.md`;
      const exists = this.fileExists(path);
      const button = grid.createEl("button", { cls: `life-os-calendar-day${exists ? " is-present" : ""}${date.getUTCMonth() !== month.getUTCMonth() ? " is-outside" : ""}`, text: String(date.getUTCDate()), attr: { "aria-label": `${iso}: ${exists ? "Open daily note" : iso === today ? "Create today's note" : "No daily note"}`, ...(iso === today ? { "aria-current": "date" } : {}) } });
      button.type = "button";
      button.disabled = !exists && iso !== today;
      this.registerDomEvent(button, "click", () => exists ? void this.openPath(path) : this.runCommand("quickadd:choice:lifeos-daily", "Today’s note"));
    }
    section.createEl("p", { cls: "life-os-calendar-help", text: "Highlighted days have notes. Open an existing day, or create today. Other empty days are disabled. No entries are generated automatically." });
  }

  renderReviewLive(parent) {
    const config = this.getConfigFrontmatter();
    const paths = this.getConfiguredFolders(config);
    const questionKeys = this.getQuestionKeys(config);
    const habitKeys = this.getHabitKeys(config);
    const days = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const day = moment().clone().subtract(offset, "days");
      const path = `${paths.daily}/${day.format("YYYY-MM-DD")}.md`;
      const file = this.app.vault.getAbstractFileByPath(path);
      const raw = this.getFrontmatter(file);
      const excluded = !this.includeExamples && this.isExample(raw);
      const data = excluded ? {} : raw;
      const metrics = this.summarizeDailyProperties(data, questionKeys, habitKeys);
      days.push({
        label: day.format("ddd"),
        exists: file instanceof TFile && !excluded,
        recorded: metrics.recorded,
        habitsDone: metrics.habitsDone,
        total: questionKeys.length + habitKeys.length,
      });
    }
    const activeDays = days.filter((day) => day.exists).length;
    const section = parent.createEl("section", { cls: "life-os-review-live" });
    this.renderLiveHeading(
      section,
      "Seven-day signal",
      "Property coverage only. Your journal words remain private.",
      `${activeDays} daily notes`
    );
    const grid = section.createDiv({ cls: "life-os-week-grid" });
    for (const day of days) {
      const card = grid.createDiv({
        cls: day.exists ? "life-os-day-card is-present" : "life-os-day-card",
      });
      card.createEl("strong", { text: day.label });
      card.createSpan({
        text: day.exists ? `${day.recorded}/${day.total} recorded` : "No note",
      });
      const meter = card.createDiv({ cls: "life-os-day-meter" });
      const ratio = day.total ? day.recorded / day.total : 0;
      meter.createDiv({
        cls: "life-os-day-meter-fill",
        attr: { style: `width: ${Math.round(ratio * 100)}%` },
      });
    }
  }

  renderPipelineLive(parent, part = null) {
    const pipelines = [
      { type: "post", label: "Posts", icon: "pen-line", path: "06 Writing/Posts/Posts Board.md" },
      { type: "video-script", label: "Video scripts", icon: "video", path: "06 Writing/Video Scripts/Video Board.md" },
      { type: "review", label: "Reviews", icon: "star", path: "06 Writing/Reviews/Reviews Board.md" },
    ];
    const files = this.app.vault.getMarkdownFiles();
    const section = parent.createEl("section", { cls: "life-os-pipeline-live" });
    if (part !== "lanes") this.renderLiveHeading(
      section,
      "Creative studio",
      "Every pipeline stays backed by its Markdown notes and Kanban board.",
      `${pipelines.reduce((sum, pipeline) => sum + this.countType(files, pipeline.type), 0)} notes`
    );
    const grid = part === "lanes" ? null : section.createDiv({ cls: "life-os-pipeline-grid" });
    if (part === "lanes" && !this.visualEnabled()) section.createDiv({ cls: "life-os-live-empty", text: "Board lanes are hidden while optional visuals are off." });
    for (const pipeline of pipelines) {
      const selected = (this.pipelinePath || pipelines[0].path) === pipeline.path;
      if (grid) {
      const button = grid.createEl("button", { cls: "life-os-pipeline-card" });
      button.type = "button";
      const icon = button.createSpan();
      setIcon(icon, pipeline.icon);
      const copy = button.createDiv();
      copy.createEl("strong", { text: pipeline.label });
      copy.createSpan({ text: `${this.countType(files, pipeline.type)} notes` });
      if (this.visualEnabled()) button.setAttribute("aria-pressed", String(selected));
      this.registerDomEvent(button, "click", () => {
        if (!this.visualEnabled()) { void this.openPath(pipeline.path); return; }
        this.pipelinePath = pipeline.path;
        this.render();
      });
      }
      if (part !== "studio" && this.visualEnabled() && selected) {
        const file = this.app.vault.getAbstractFileByPath(pipeline.path);
        const cache = file instanceof TFile ? this.app.metadataCache.getFileCache(file) : null;
        const lanes = cache?.headings?.filter(heading => heading.level === 2) || [];
        const flow = section.createDiv({ cls: "life-os-workflow-lanes" });
        flow.createEl("h3", { text: pipeline.label });
        this.addButton(flow, { icon: "kanban", label: "Open board", description: "Edit cards in the original board.", onClick: () => this.openPath(pipeline.path) });
        if (!file || !cache || !lanes.length || !Array.isArray(cache.listItems)) {
          flow.createEl("p", { text: "Board lane counts unavailable. Open the board to inspect its workflow." });
          continue;
        }
        if (this.isExample(this.getFrontmatter(file))) {
          flow.createEl("p", { text: "Sample board excluded from workflow counts." });
          continue;
        }
        for (let i = 0; i < lanes.length; i++) {
          const start = lanes[i].position.start.line;
          const end = lanes[i + 1]?.position.start.line ?? Infinity;
          const cards = cache.listItems.filter(item => item.task !== undefined && item.position.start.line > start && item.position.start.line < end);
          const laneBox = flow.createDiv({ cls: "life-os-lane-preview" });
          const lane = laneBox.createEl("button", { text: `${lanes[i].heading} · ${cards.length}` });
          lane.type = "button";
          this.registerDomEvent(lane, "click", () => void this.openPath(pipeline.path, start + 1));
          const tasks = this.taskSnapshot?.tasks.filter(task => task.path === pipeline.path && task.line > start + 1 && task.line <= end) || [];
          for (const task of tasks.slice(0, 3)) {
            const item = laneBox.createEl("button", { cls: "life-os-lane-item", text: task.text });
            item.type = "button";
            this.registerDomEvent(item, "click", () => void this.openPath(task.path, task.line));
          }
          laneBox.createEl("p", { text: !this.taskSnapshot ? "Loading open items" : this.taskSnapshot.error ? "Open-item index unavailable" : `${Math.min(tasks.length, 3)} of ${tasks.length} indexed open items shown${this.taskSnapshot.state === "partial" ? " · partial index" : ""}` });
        }
        flow.createEl("p", { text: "Checkbox items by actual board heading, including checked items. Not a completion percentage." });
      }
    }
  }

  renderAiLive(parent, part = null) {
    const agentSettings = this.pluginSettings("agent-client");
    const restSettings = this.pluginSettings("obsidian-local-rest-api");
    const agentLoaded = this.pluginLoaded("agent-client");
    const restLoaded = this.pluginLoaded("obsidian-local-rest-api");
    const permissionSetting =
      typeof agentSettings.autoAllowPermissions === "boolean"
        ? agentSettings.autoAllowPermissions
        : null;
    const sessionCount = Array.isArray(agentSettings.savedSessions)
      ? agentSettings.savedSessions.length
      : 0;
    const agentConfigured = agentLoaded && Boolean(agentSettings.defaultAgentId);
    const restConfigured = restLoaded && Boolean(restSettings.apiKey);
    const prompts = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith("Prompts/")).length;
    const checks = [
      {
        icon: "bot",
        label: "Agent Client",
        ready: agentConfigured,
        state: agentConfigured ? "Configured" : agentLoaded ? "Installed" : "Unavailable",
        detail: agentConfigured
          ? `${sessionCount} local ${sessionCount === 1 ? "session" : "sessions"}`
          : "In-vault assistant interface",
      },
      {
        icon: "plug-zap",
        label: "Local MCP bridge",
        ready: restConfigured,
        state: restConfigured ? "Configured" : restLoaded ? "Installed" : "Unavailable",
        detail: restConfigured ? "Local server key present" : "Local tool connection",
      },
      {
        icon: "library",
        label: "Prompt library",
        ready: prompts > 0,
        state: prompts > 0 ? "Available" : "Unavailable",
        detail: `${prompts} governed workflows`,
      },
      {
        icon: "shield-check",
        label: "Permission policy",
        ready: agentLoaded && permissionSetting === false,
        state: !agentLoaded
          ? "Unavailable"
          : permissionSetting === false
            ? "Manual prompts"
            : permissionSetting === true
              ? "Auto-allow on"
              : "Unknown",
        detail:
          permissionSetting === false
            ? "Client setting is off. This reports policy, not enforcement."
            : permissionSetting === true
              ? "Client may auto-approve requests. This reports policy, not enforcement."
              : "Permission setting was not observable. No enforcement claim.",
      },
    ];
    const ready = checks.filter((check) => check.ready).length;
    const section = parent.createEl("section", { cls: "life-os-ai-live" });
    if (part !== "diagram") this.renderLiveHeading(
      section,
      "AI control center",
      "Capability status is local. Installed does not mean authenticated or connected.",
      `${ready} of ${checks.length} available`
    );
    if (part !== "checks" && this.visualEnabled()) {
      const flow = section.createEl("section", { cls: "life-os-connection-map", attr: { "aria-label": "AI integration map" } });
      flow.createEl("h3", { text: "How the parts connect" });
      const diagram = flow.createDiv({ cls: "life-os-ai-diagram" });
      diagram.createDiv({ cls: "life-os-ai-node", text: "EX3C AgendA · local dashboard" });
      diagram.createDiv({ cls: "life-os-ai-connector", text: "Selected context →" });
      const hub = diagram.createDiv({ cls: "life-os-ai-node", text: `Agent Client · ${agentConfigured ? "configured" : agentLoaded ? "loaded, configuration needed" : "unavailable"}` });
      hub.createDiv({ text: "Two separate integration paths ↓" });
      const branches = diagram.createDiv({ cls: "life-os-ai-branches" });
      branches.createDiv({ cls: "life-os-ai-node", text: "Provider · authentication not tested here" });
      branches.createDiv({ cls: "life-os-ai-node", text: `Optional local tools via MCP · ${restConfigured ? "key present, connection not tested" : "not configured"}` });
      flow.createEl("p", { text: "Integration overview, not a live traffic trace. This screen makes no provider requests. Review selected context and permissions before sending." });
    }
    if (part === "diagram") return;
    const grid = section.createDiv({ cls: "life-os-ai-check-grid" });
    for (const check of checks) {
      const card = grid.createDiv({
        cls: check.ready ? "life-os-ai-check is-ready" : "life-os-ai-check",
      });
      const icon = card.createSpan();
      setIcon(icon, check.icon);
      const copy = card.createDiv();
      copy.createEl("strong", { text: check.label });
      copy.createSpan({ text: check.detail });
      card.createSpan({
        cls: "life-os-ai-state",
        text: check.state,
      });
    }
  }

  renderCollectionLive(parent, options) {
    const kind = options.kind;
    const records = this.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isDomainRecord(file))
      .filter((file) => this.fileInArea(file))
      .filter((file) => kind === "library" ? Boolean(this.getFrontmatter(file).type) : options.types.includes(String(this.getFrontmatter(file).type || "")))
      .filter((file) => kind !== "library" || (file.path.startsWith("07 Library/") && !this.isExample(this.getFrontmatter(file))))
      .filter((file) => {
        const status = String(this.getFrontmatter(file).status || "").toLowerCase();
        return kind === "library" || !["done", "complete", "completed", "archived"].includes(status);
      })
      .sort(
        (left, right) =>
          (right.stat?.mtime || 0) - (left.stat?.mtime || 0)
      );
    if (options.discussionOnly) {
      this.renderDiscussion(parent.createEl("section", { cls: "life-os-collection-live" }), records);
      return;
    }
    const section = parent.createEl("section", { cls: "life-os-collection-live" });
    this.renderLiveHeading(
      section,
      options.title,
      options.description,
      `${records.length} ${records.length === 1 ? "note" : "notes"}`
    );
    if (!records.length) {
      section.createDiv({ cls: "life-os-live-empty", text: options.empty });
      return;
    }
    let visible = records;
    if (kind === "library") {
      const typeLabel = section.createEl("label", { text: "Type " });
      const typeSelect = typeLabel.createEl("select", { attr: { "aria-label": "Library type" } });
      const types = [...new Set(records.map(file => String(this.getFrontmatter(file).type)))].sort();
      if (!types.includes(this.libraryType)) this.libraryType = "all";
      for (const type of ["all", ...types]) typeSelect.createEl("option", { text: type === "all" ? "All types" : type, attr: { value: type } });
      typeSelect.value = this.libraryType;
      this.registerDomEvent(typeSelect, "change", () => { this.libraryType = typeSelect.value; this.render(); });
      const label = section.createEl("label", { text: "Library status " });
      const select = label.createEl("select", { attr: { "aria-label": "Library status" } });
      const statuses = [...new Set(records.map(file => String(this.getFrontmatter(file).status || "Not set")))].sort();
      for (const value of ["all", ...statuses]) select.createEl("option", { text: value === "all" ? "All statuses" : value, attr: { value } });
      if (!statuses.includes(this.libraryStatus)) this.libraryStatus = "all";
      select.value = this.libraryStatus;
      this.registerDomEvent(select, "change", () => { this.libraryStatus = select.value; this.render(); });
      visible = records.filter(file => (this.libraryStatus === "all" || String(this.getFrontmatter(file).status || "Not set") === this.libraryStatus) && (this.libraryType === "all" || String(this.getFrontmatter(file).type) === this.libraryType));
    }
    section.createEl("p", { text: `Showing ${Math.min(visible.length, this.itemLimit)} of ${visible.length} matching notes.` });
    const grid = section.createDiv({ cls: "life-os-record-grid" });
    for (const file of visible.slice(0, this.itemLimit)) {
      const data = this.getFrontmatter(file);
      const button = grid.createEl("button", { cls: "life-os-record-card" });
      button.type = "button";
      if (kind === "library" && this.visualEnabled()) {
        button.addClass("life-os-shelf-card");
        const cover = String(data.cover || "").replace(/^!?\[\[/, "").replace(/\]\]$/, "").split("|")[0];
        const imageFile = !/^(?:[a-z]+:|\/)/i.test(cover) && /\.(?:png|jpe?g|webp|gif)$/i.test(cover) ? this.app.metadataCache.getFirstLinkpathDest?.(cover, file.path) : null;
        if (imageFile instanceof TFile && this.app.vault.getResourcePath) button.createEl("img", { cls: "life-os-book-cover", attr: { src: this.app.vault.getResourcePath(imageFile), alt: "", loading: "lazy" } });
        else button.createDiv({ cls: "life-os-book-cover life-os-book-fallback", text: String(data.type || "Note").toUpperCase() });
      }
      const icon = button.createSpan({ cls: "life-os-record-icon" });
      setIcon(icon, options.icon);
      const copy = button.createDiv();
      copy.createEl("strong", { text: this.getFileTitle(file) });
      copy.createSpan({ text: String(data.status || "Status not set") });
      if (this.visualEnabled() && ["projects", "people"].includes(kind)) {
        const tasks = this.tasksForRecord(file, kind === "projects" ? "project" : "p");
        copy.createSpan({ cls: "life-os-record-metrics", attr: { title: "Counts open tasks written in this note plus tasks elsewhere tagged with its routing tag." }, text: !this.taskSnapshot || this.taskSnapshot.error ? "Task index unavailable" : `${tasks.length} tagged open · ${tasks.filter(task => task.overdue).length} overdue${this.taskSnapshot.state === "partial" ? " · partial index" : ""}` });
      }
      const arrow = button.createSpan({ cls: "life-os-record-arrow" });
      setIcon(arrow, "arrow-up-right");
      this.registerDomEvent(button, "click", () => void this.openPath(file.path));
    }
  }

  renderDiscussion(section, records) {
    const discussion = section.createDiv({ cls: "life-os-discussion-queue" });
    discussion.createEl("h3", { text: "Open conversations" });
    const entries = records.flatMap(file => this.tasksForRecord(file, "p").filter(task => task.discuss).map(task => ({ file, task })));
    discussion.createEl("p", { text: this.taskSnapshot && !this.taskSnapshot.error ? `${entries.length} indexed person-discussion links${this.taskSnapshot.state === "partial" ? " · partial index" : ""}. Explicit person tags only.` : "Task index unavailable." });
    if (!entries.length) discussion.createDiv({ cls: "life-os-live-empty", text: "Nothing to discuss. Tag a task #discuss and #p/<person>." });
    for (const {file, task} of entries.slice(0, this.itemLimit)) {
      const button = discussion.createEl("button", { text: `${this.getFileTitle(file)} · ${task.text}` });
      button.type = "button";
      this.registerDomEvent(button, "click", () => void this.openPath(task.path, task.line));
    }
  }

  tasksForRecord(file, prefix) {
    const slug = this.getFileTitle(file).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const tag = `#${prefix}/${slug}`;
    return (this.taskSnapshot?.tasks || []).filter(task => task.path === file.path || task.text.split(/\s+/).includes(tag));
  }

  // The Library as a bookshelf: every folder in 07 Library is a book on the shelf. Open a book to see what is inside:
  // its own folders stand on a smaller shelf, its notes and files are listed below; click one to open it.
  renderBookshelf(parent) {
    const ROOT = "07 Library";
    const rootFolder = this.app.vault.getAbstractFileByPath(ROOT);
    const section = parent.createEl("section", { cls: "life-os-collection-live ex3c-shelf" });
    if (!rootFolder || !Array.isArray(rootFolder.children)) {
      this.renderLiveHeading(section, "Library shelf", "Every folder in 07 Library is a book.", "0 books");
      section.createDiv({ cls: "life-os-live-empty", text: "There is no 07 Library folder yet. Make it, then put a folder in it for each book or collection." });
      return;
    }
    let here = this.app.vault.getAbstractFileByPath(this.shelfPath || ROOT);
    if (!here || !Array.isArray(here.children) || !(here.path === ROOT || here.path.startsWith(`${ROOT}/`))) here = rootFolder;
    this.shelfPath = here.path;
    const isFolder = (f) => Array.isArray(f.children);
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const countFiles = (folder) => folder.children.reduce((n, c) => n + (isFolder(c) ? countFiles(c) : 1), 0);
    const books = here.children.filter(isFolder).sort(byName);
    const files = here.children.filter((c) => !isFolder(c)).sort(byName);
    const atRoot = here.path === ROOT;
    this.renderLiveHeading(section, atRoot ? "Library shelf" : here.name, atRoot ? "Every folder in 07 Library is a book. Open one to see what is inside." : `${countFiles(here)} file${countFiles(here) === 1 ? "" : "s"} in this book.`, books.length || atRoot ? `${books.length} book${books.length === 1 ? "" : "s"}` : `${files.length} file${files.length === 1 ? "" : "s"}`);
    // where you are: Library › HG Worksheets › ADHD
    const crumbs = section.createDiv({ cls: "ex3c-shelf-crumbs" });
    const parts = atRoot ? [] : here.path.split("/");
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      if (i) crumbs.createSpan({ text: " › " });
      const b = crumbs.createEl("button", { cls: i === parts.length - 1 ? "is-here" : "", text: i ? name : "Library" });
      b.type = "button";
      this.registerDomEvent(b, "click", () => { this.shelfPath = path; this.render(); });
    });
    // the shelf: one spine per folder, its colour and height from its name and size
    const hue = (name) => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    if (books.length) {
      const shelf = section.createDiv({ cls: "ex3c-shelf-row" });
      for (const book of books) {
        const n = countFiles(book), h = hue(book.name);
        const spine = shelf.createEl("button", { cls: "ex3c-book", attr: { title: `${book.name}: ${n} file${n === 1 ? "" : "s"}`, style: `--h:${h};height:${Math.min(176, 118 + n * 6)}px;width:${Math.min(58, 34 + Math.round(book.name.length / 2))}px` } });
        spine.type = "button";
        spine.createSpan({ cls: "ex3c-book-title", text: book.name });
        spine.createSpan({ cls: "ex3c-book-count", text: String(n) });
        this.registerDomEvent(spine, "click", () => { this.shelfPath = book.path; this.render(); });
      }
      section.createDiv({ cls: "ex3c-shelf-plank" });
    } else if (atRoot) {
      section.createDiv({ cls: "life-os-live-empty", text: "No books yet: make a folder in 07 Library for each book or collection, and it stands here." });
    }
    // what lies in this folder: notes, PDFs, images
    if (files.length) {
      section.createEl("h3", { cls: "ex3c-shelf-sub", text: atRoot ? "Loose pages" : "Inside" });
      const list = section.createDiv({ cls: "ex3c-shelf-files" });
      const ICON = { md: "file-text", pdf: "file-type-2", png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image", canvas: "layout-dashboard", epub: "book" };
      for (const file of files) {
        const row = list.createEl("button", { cls: "ex3c-shelf-file" });
        row.type = "button";
        setIcon(row.createSpan({ cls: "ex3c-shelf-ico" }), ICON[String(file.extension).toLowerCase()] || "file");
        row.createSpan({ text: file.extension === "md" ? file.basename : file.name });
        const status = file.extension === "md" ? String(this.getFrontmatter(file).status || "") : "";
        if (status) row.createSpan({ cls: "life-os-progress-chip", text: status });
        this.registerDomEvent(row, "click", () => void this.app.workspace.getLeaf(false).openFile(file));
      }
    } else if (!atRoot && !books.length) {
      section.createDiv({ cls: "life-os-live-empty", text: "This book is empty. Put notes or PDFs in its folder." });
    }
  }

  renderLiveHeading(parent, title, description, status) {
    const heading = parent.createDiv({ cls: "life-os-live-heading" });
    const copy = heading.createDiv();
    copy.createEl("h2", { text: title });
    copy.createEl("p", { text: description });
    heading.createSpan({ cls: "life-os-progress-chip is-active", text: status });
  }

  getFrontmatter(file) {
    return file instanceof TFile
      ? this.app.metadataCache.getFileCache(file)?.frontmatter || {}
      : {};
  }

  getConfigFrontmatter() {
    return this.getFrontmatter(
      this.app.vault.getAbstractFileByPath("Meta/EX3C Agenda Config.md")
    );
  }

  getConfiguredFolders(config = this.getConfigFrontmatter()) {
    return {
      daily: normalizeFolder(config.daily_folder, DEFAULT_FOLDERS.daily),
      weekly: normalizeFolder(config.weekly_folder, DEFAULT_FOLDERS.weekly),
      quarterly: normalizeFolder(config.quarterly_folder, DEFAULT_FOLDERS.quarterly),
      retreats: normalizeFolder(config.retreat_folder, DEFAULT_FOLDERS.retreats),
      projects: normalizeFolder(config.projects_folder, DEFAULT_FOLDERS.projects),
    };
  }

  summarizeDailyProperties(data, questionKeys, habitKeys) {
    const questionsRecorded = questionKeys.filter(
      (key) => ratingState(data[key]).state === "recorded"
    ).length;
    const habitStates = habitKeys.map((key) => habitState(data[key]));
    const habitsRecorded = habitStates.filter(
      (state) => state === "done" || state === "unchecked"
    ).length;
    return {
      questionsRecorded,
      habitsRecorded,
      habitsDone: habitStates.filter((state) => state === "done").length,
      recorded: questionsRecorded + habitsRecorded,
    };
  }

  getQuestionKeys(config) {
    const questions = Array.isArray(config.questions) ? config.questions : [];
    return questions
      .map((question) => String(question?.key || question || ""))
      .filter(Boolean);
  }

  getHabitKeys(config) {
    return (Array.isArray(config.habits) ? config.habits : [])
      .map((habit) => String(habit || ""))
      .filter(Boolean);
  }

  countType(files, type) {
    return files.filter(
      (file) => this.isDomainRecord(file) && String(this.getFrontmatter(file).type || "") === type
    ).length;
  }

  isDomainRecord(file) {
    const projects = `${this.getConfiguredFolders().projects}/`;
    return [projects, "05 People/", "06 Writing/", "07 Library/"]
      .some((folder) => file.path.startsWith(folder)) &&
      (this.includeExamples || !this.isExample(this.getFrontmatter(file)));
  }

  fileExists(path) {
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  getFileTitle(file) {
    return file.basename || file.path.split("/").pop().replace(/\.md$/i, "");
  }

  resolveTaskStatus(symbol) {
    const normalized = symbol === "" ? " " : String(symbol || "");
    return TASK_STATUS_TYPES[normalized] || "unknown";
  }

  parseTaskLine(line, statusSymbol, file, lineNumber, today) {
    const match = line.match(/^\s*(?:[-+*]|\d+[.)])\s+\[([^\]])\]\s*(.*)$/u);
    if (!match || match[1] !== statusSymbol) {
      return null;
    }
    const raw = match[2].trim();
    const due = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    const scheduled = raw.match(/⏳\s*(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    const overdue = Boolean(due && due < today);
    const dueToday = due === today;
    // due within the next 3 days counts as urgent, here and in the planner's suggestions
    const dueSoon = Boolean(due && due > today && due <= moment(today).add(3, "days").format("YYYY-MM-DD"));
    const scheduledToday = scheduled === today;
    // a study task without a priority counts as 🔺 highest, as in the planner
    const high = raw.includes("⏫") || raw.includes("🔺") || (!/[🔼🔽⏬]/u.test(raw) && !/(^|\s)#soon\b/i.test(raw) && this.areaOf(raw, file) === "study");
    const discuss = /(^|\s)#discuss(?:\s|$)/.test(raw);
    const text = raw
      .replace(/\s*[🛫⏳📅✅❌➕]\s*\d{4}-\d{2}-\d{2}/gu, "")
      .replace(/\s*\[[\w-]+::[^\]]*\]/g, "")
      .replace(/\s*(?:🆔|⛔)\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, "")
      .replace(/\s*🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#^]*/u, " ")
      .replace(/\s*[🔺⏫🔼🔽⏬]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      text,
      due,
      scheduled,
      overdue,
      dueToday,
      dueSoon,
      scheduledToday,
      high,
      discuss,
      area: this.areaOf(raw, file),
      path: file.path,
      line: lineNumber,
    };
  }

  areaOf(text, file) {
    const tag = String(text || "").match(AREA_TAG_RE);
    if (tag) return tag[2].toLowerCase();
    const area = String(this.getFrontmatter(file).area || "").toLowerCase();
    return AREAS.includes(area) ? area : null;
  }

  tabArea() {
    return this.currentTab()?.area || null;
  }

  inArea(task) {
    const area = this.tabArea();
    return !area || task.area === area;
  }

  fileInArea(file) {
    const area = this.tabArea();
    return !area || this.areaOf("", file) === area;
  }

  async loadTaskSnapshot() {
    const paths = this.getConfiguredFolders();
    const sources = [
      "08 Tasks/Tasks.md",
      `${paths.projects}/`,
      "05 People/",
      "06 Writing/",
    ];
    // Every note can hold tasks (a study note in the Library, a project, the master list), so the feed
    // reads the whole vault except folders that only hold templates, docs, or settings.
    void sources;
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !TASK_EXCLUDED.some((folder) => file.path.startsWith(folder)))
      .filter((file) => String(this.app.metadataCache.getFileCache(file)?.frontmatter?.type ?? "") !== "checklist"); // reusable checklists stay out of task views
    const today = moment().format("YYYY-MM-DD");
    const tasks = [];
    const exampleFiles = files.filter((file) => this.isExample(this.getFrontmatter(file)));
    const indexFiles = files.filter((file) => !this.isExample(this.getFrontmatter(file)));

    try {
      const contents = await Promise.all(
        indexFiles.map(async (file) => {
          const cache = this.app.metadataCache.getFileCache(file);
          if (!cache) {
            return {
              file,
              content: "",
              listItems: [],
              error: "Metadata unavailable",
              errorType: "metadata",
            };
          }
          try {
            return {
              file,
              content: await this.app.vault.cachedRead(file),
              listItems: Array.isArray(cache.listItems) ? cache.listItems : [],
              error: "",
              errorType: "",
            };
          } catch (error) {
            return {
              file,
              content: "",
              listItems: [],
              error: error?.message || "Unreadable file",
              errorType: "read",
            };
          }
        })
      );
      let unresolvedStatuses = 0;
      let malformedItems = 0;
      for (const { file, content, listItems, error } of contents) {
        if (error) {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (const item of listItems) {
          if (typeof item.task !== "string") {
            continue;
          }
          const lineIndex = item.position?.start?.line;
          if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
            malformedItems += 1;
            continue;
          }
          const symbol = item.task === "" ? " " : item.task;
          const status = this.resolveTaskStatus(symbol);
          if (status === "unknown") {
            unresolvedStatuses += 1;
            continue;
          }
          if (status !== "open") {
            continue;
          }
          const task = this.parseTaskLine(
            lines[lineIndex],
            symbol,
            file,
            lineIndex + 1,
            today
          );
          if (!task) {
            malformedItems += 1;
            continue;
          }
          // Calendar events imported from .ics files are fixed appointments, not tasks to act on.
          if (/(^|\s)#event(?=\s|$)/.test(lines[lineIndex])) continue;
          tasks.push(task);
        }
      }
      tasks.sort((left, right) => {
        const rank = (task) =>
          task.overdue
            ? 0
            : task.dueToday || task.scheduledToday
              ? 1
              : task.dueSoon
                ? 2
                : task.high
                  ? 3
                  : task.due || task.scheduled
                    ? 4
                    : 5;
        const sortDate = (task) => task.due || task.scheduled || "9999-99-99";
        return (
          rank(left) - rank(right) ||
          sortDate(left).localeCompare(sortDate(right)) ||
          left.path.localeCompare(right.path) ||
          left.line - right.line ||
          left.text.localeCompare(right.text)
        );
      });
      const skipped = contents.filter((item) => item.error).length;
      return {
        tasks,
        error: "",
        state: skipped || unresolvedStatuses || malformedItems ? "partial" : "ready",
        skipped,
        missingMetadata: contents.filter((item) => item.errorType === "metadata").length,
        unresolvedStatuses,
        malformedItems,
        examplesExcluded: exampleFiles.length,
        candidateFiles: files.length,
      };
    } catch (error) {
      return {
        tasks: [],
        error: error?.message || "Task index unavailable",
        state: "unavailable",
        skipped: files.length,
        missingMetadata: 0,
        unresolvedStatuses: 0,
        malformedItems: 0,
        examplesExcluded: exampleFiles.length,
        candidateFiles: files.length,
      };
    }
  }

  taskGroup(task) {
    if (task.overdue) return "overdue";
    if (task.dueToday || task.scheduledToday) return "today";
    const today = moment().format("YYYY-MM-DD");
    if ((task.due && task.due > today) || (task.scheduled && task.scheduled > today)) return "upcoming";
    return "unscheduled";
  }

  renderFocusGroups(parent) {
    const section = parent.createDiv({ cls: "life-os-focus-groups" });
    section.createEl("h2", { text: "Where your attention goes" });
    section.createEl("p", { text: "One group per indexed open task. Past scheduled dates without a current due date fall under Other. Partial indexing may omit tasks." });
    for (const [id, label] of [["all", "All"], ["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["unscheduled", "Unscheduled / other"]]) {
      const count = this.taskSnapshot?.tasks.filter(task => this.inArea(task) && (id === "all" || this.taskGroup(task) === id)).length;
      const button = section.createEl("button", { text: `${label} · ${count ?? "Loading"}`, attr: { "aria-pressed": String(this.focusGroup === id) } });
      button.type = "button";
      this.registerDomEvent(button, "click", () => { this.focusGroup = id; this.render(); });
    }
    const total = this.taskSnapshot?.tasks.filter((task) => this.inArea(task)).length || 0;
    if (total) {
      const bar = section.createDiv({ cls: "life-os-workload-bar", attr: { "aria-label": "Distribution of indexed open tasks" } });
      for (const [id, label] of [["overdue", "Overdue"], ["today", "Today"], ["upcoming", "Upcoming"], ["unscheduled", "Unscheduled / other"]]) {
        const count = this.taskSnapshot.tasks.filter(task => this.inArea(task) && this.taskGroup(task) === id).length;
        if (!count) continue;
        const segment = bar.createEl("button", { cls: `life-os-workload-segment is-${id}`, attr: { style: `flex:${count}`, "aria-label": `${label}: ${count} of ${total}`, title: `${label}: ${count} of ${total}` } });
        segment.type = "button";
        this.registerDomEvent(segment, "click", () => { this.focusGroup = id; this.render(); });
      }
    }
  }

  renderTaskLive(parent, { limit = 7, attention = false, group = "all" } = {}) {
    const snapshot = this.taskSnapshot;
    const section = parent.createEl("section", { cls: "life-os-task-live" });
    const coverage = snapshot
      ? [
          this.tabArea() ? `${snapshot.tasks.filter((task) => this.inArea(task)).length} open in ${this.tabArea()}` : `${snapshot.tasks.length} open`,
          snapshot.skipped - snapshot.missingMetadata > 0
            ? `${snapshot.skipped - snapshot.missingMetadata} unreadable`
            : "",
          snapshot.missingMetadata
            ? `${snapshot.missingMetadata} metadata pending`
            : "",
          snapshot.unresolvedStatuses
            ? `${snapshot.unresolvedStatuses} unresolved status`
            : "",
          snapshot.examplesExcluded
            ? `${snapshot.examplesExcluded} sample excluded`
            : "",
        ]
          .filter(Boolean)
          .join(", ")
      : "Loading";
    this.renderLiveHeading(
      section,
      attention ? "Needs attention" : "Commitment feed",
      attention ? "Overdue, due within 3 days, planned for today, or high priority. Open a task at its source." : "Open tasks from the master inbox, projects, people, and writing notes.",
      coverage
    );

    if (!snapshot) {
      section.createDiv({ cls: "life-os-live-empty", text: "Loading local tasks..." });
      return;
    }
    if (snapshot.error) {
      section.createDiv({ cls: "life-os-live-empty", text: snapshot.error });
      return;
    }
    if (!snapshot.tasks.length) {
      section.createDiv({
        cls: "life-os-live-empty",
        text:
          snapshot.state === "partial"
            ? "No open tasks indexed. Some task data could not be classified."
            : "No open tasks found.",
      });
      return;
    }

    const scoped = snapshot.tasks.filter((task) => this.inArea(task));
    const selected = attention ? scoped.filter(task => task.overdue || task.dueToday || task.dueSoon || task.scheduledToday || task.high) : scoped.filter(task => group === "all" || this.taskGroup(task) === group);
    if (!selected.length) section.createDiv({ cls: "life-os-live-empty", text: attention ? "Nothing overdue, due within 3 days, planned for today, or high priority." : "No indexed tasks in this group." });
    const list = section.createDiv({ cls: "life-os-task-list" });
    for (const task of selected.slice(0, limit)) {
      const button = list.createEl("button", {
        cls: task.overdue
          ? "life-os-task-row is-overdue"
          : task.dueToday || task.scheduledToday
            ? "life-os-task-row is-today"
            : "life-os-task-row",
      });
      button.type = "button";
      const marker = button.createSpan({ cls: "life-os-task-marker" });
      setIcon(marker, task.discuss ? "messages-square" : "circle");
      const copy = button.createDiv();
      copy.createEl("strong", { text: task.text });
      copy.createSpan({ text: this.getTaskContext(task) });
      if (task.high) {
        button.createSpan({ cls: "life-os-task-priority", text: "High" });
      }
      this.registerDomEvent(button, "click", () => void this.openPath(task.path, task.line));
    }
    {
      // "All tasks" (on an area tab: all of that area's) opens the full list in place
      const area = this.tabArea() || "", open = this.showAllArea === (area || "all"), more = scoped.length - Math.min(selected.length, limit);
      this.addButton(section, { icon: open ? "chevron-up" : "list-checks", label: open ? `Hide the full${area ? ` ${area}` : ""} list` : `All${area ? ` ${area}` : ""} tasks`, description: open ? `${scoped.length} open${area ? ` ${area}` : ""} task${scoped.length === 1 ? "" : "s"}, below.` : `${scoped.length} open${area ? ` ${area}` : ""} task${scoped.length === 1 ? "" : "s"}${more > 0 ? `, ${more} more than shown above` : ""}.`, onClick: () => { this.showAllArea = open ? null : area || "all"; this.scrollToAreaList = !open; this.render(true); } });
      if (open) {
        const all = section.createDiv({ cls: "life-os-area-all" });
        all.createEl("h3", { text: `All open${area ? ` ${area}` : ""} tasks (${scoped.length})` });
        const today = moment().format("YYYY-MM-DD");
        const groups = [
          ["Overdue", scoped.filter((t) => t.overdue)],
          ["Today", scoped.filter((t) => !t.overdue && (t.dueToday || t.scheduledToday))],
          ["Coming up", scoped.filter((t) => !t.overdue && !t.dueToday && !t.scheduledToday && ((t.due && t.due > today) || (t.scheduled && t.scheduled > today)))],
          ["No date", scoped.filter((t) => !t.due && !t.scheduled)],
          ["Planned earlier, not done", scoped.filter((t) => !t.overdue && !t.due && t.scheduled && t.scheduled < today)],
        ];
        for (const [name, list] of groups) {
          if (!list.length) continue;
          all.createEl("h4", { text: `${name} (${list.length})` });
          const box = all.createDiv({ cls: "life-os-task-list" });
          for (const task of list) {
            const b = box.createEl("button", { cls: task.overdue ? "life-os-task-row is-overdue" : task.dueToday || task.scheduledToday ? "life-os-task-row is-today" : "life-os-task-row" });
            b.type = "button";
            setIcon(b.createSpan({ cls: "life-os-task-marker" }), task.discuss ? "messages-square" : "circle");
            const copy = b.createDiv(); copy.createEl("strong", { text: task.text }); copy.createSpan({ text: this.getTaskContext(task) });
            if (task.high) b.createSpan({ cls: "life-os-task-priority", text: "High" });
            this.registerDomEvent(b, "click", () => void this.openPath(task.path, task.line));
          }
        }
        if (this.scrollToAreaList) { this.scrollToAreaList = false; window.setTimeout(() => all.scrollIntoView({ behavior: "smooth", block: "start" }), 250); }
      }
    }
  }

  // one click picks a theme colour; the colour input next to it still takes any other
  // Configure > Areas: every area with its colour, name, tag and on/off switch; rename, open its note, make a new one.
  renderAreaManager(bar) {
    const plugin = this.plugin;
    if (plugin.areaUndo === undefined) { try { plugin.areaUndo = JSON.parse(window.localStorage.getItem("ex3c-area-undo") || "null"); } catch (e) { plugin.areaUndo = null; } }
    const box = bar.createDiv({ cls: "life-os-areas" });
    const head = box.createDiv({ cls: "life-os-areas-head" });
    head.createEl("strong", { text: "Areas" });
    head.createSpan({ text: `Each area has a folder in ${AREA_ROOT}, an area note that keeps its colour and switch, and a tab. A task belongs to an area by its #tag, or by the area property of its note. Switching an area off hides its tab and colour; no note changes.` });
    for (const a of plugin.areaList || []) {
      const name = plugin.areaName(a.key);
      const row = box.createDiv({ cls: a.enabled ? "life-os-area-row" : "life-os-area-row is-off", attr: { style: `--sw:${a.color}` } });
      const main = row.createDiv({ cls: "life-os-area-main" });
      // the colour: tap the swatch for the theme colours and a colour picker
      const open = this.areaColourOpen === a.key;
      const swatch = main.createEl("button", { cls: open ? "life-os-area-swatch is-open" : "life-os-area-swatch", attr: { type: "button", "aria-label": `${name} colour`, "aria-expanded": String(open), title: "Change the colour" } });
      this.registerDomEvent(swatch, "click", () => { this.areaColourOpen = open ? null : a.key; this.render(true); });
      const label = main.createDiv({ cls: "life-os-area-name" });
      label.createEl("strong", { text: name });
      label.createSpan({ cls: "life-os-area-tag", text: `#${a.key}` });
      const standard = LOCKED_AREAS.includes(a.key);
      if (standard) label.createSpan({ cls: "life-os-area-role", text: "Standard", attr: { title: a.key === "work" ? "A standard area: the Work schedule is built on #work, so it keeps its name and tag. Switch it off if you do not need it." : "A standard area: courses are built on #study and 10 Areas/Study, so it keeps its name and tag. Switch it off if you do not need it." } });
      const tabs = this.layout.tabs.filter((t) => t.area === a.key);
      if (!tabs.length) label.createSpan({ cls: "life-os-area-tag", text: "no tab" });
      const sw = main.createEl("label", { cls: "life-os-area-switch", attr: { title: a.enabled ? "On: its tab and colour show" : "Off: its tab and colour are hidden" } });
      const box2 = sw.createEl("input", { attr: { type: "checkbox", "aria-label": `${name} on` } });
      box2.checked = a.enabled;
      sw.createSpan({ text: a.enabled ? "On" : "Off" });
      this.registerDomEvent(box2, "change", () => void plugin.setAreaEnabled(a.key, box2.checked));
      const acts = row.createDiv({ cls: "life-os-area-actions" });
      const act = (text, icon, fn, title) => {
        const b = acts.createEl("button", { attr: { type: "button", title: title || text } });
        const i = b.createSpan(); setIcon(i, icon);
        b.createSpan({ text });
        this.registerDomEvent(b, "click", fn);
      };
      if (!standard) act("Rename", "pencil", () => this.openAreaRename(a));
      if (a.path) act("Note", "file-text", () => void this.openPath(a.path), `Open ${a.path}`);
      if (!tabs.length && a.enabled) act("Add tab", "plus", async () => {
        let id = a.key, n = 2;
        while (this.layout.tabs.some((t) => t.id === id)) id = `${a.key}-${n++}`;
        await plugin.changeLayout((layout) => layout.tabs.push({ id, label: name, area: a.key, icon: AREA_ICONS[a.key] || "layout-grid", widgets: [...AREA_WIDGETS] }));
        this.activeScreen = id; this.render(true);
      });
      else if (tabs.length && a.enabled) act("Go", "arrow-right", () => { this.activeScreen = tabs[0].id; this.render(true); plugin.refreshPalettes(); }, `Show the ${name} tab`);
      if (open) {
        const colours = row.createDiv({ cls: "life-os-area-colours" });
        this.colourDots(colours, a.color, (hex) => plugin.setAreaColor(a.key, hex));
        const own = colours.createEl("label", { text: "Any colour " });
        const pick = own.createEl("input", { attr: { type: "color", value: a.color, "aria-label": `${name} colour` } });
        this.registerDomEvent(pick, "change", () => void plugin.setAreaColor(a.key, pick.value));
      }
    }
    if (plugin.areaUndo) {
      const u = plugin.areaUndo;
      const row = box.createDiv({ cls: "life-os-areas-undo" });
      row.createSpan({ text: `Last rename: ${u.name} to ${u.newName}${u.newKey !== u.key ? `, #${u.key} to #${u.newKey}` : ""}.` });
      const b = row.createEl("button", { text: "Undo", attr: { type: "button" } });
      this.registerDomEvent(b, "click", () => void plugin.undoAreaRename().then(() => this.render(true)));
    }
    // a new area
    const used = new Set([...(plugin.areaList || []).map((a) => String(a.color).toLowerCase()), themeAccent(this.layout.theme || normalizeTheme(null), null).toLowerCase()]);
    const free = Object.values(THEME_PRESETS).find((c) => !used.has(c)) || THEME_PRESETS.mono;
    const add = box.createDiv({ cls: "life-os-area-new" });
    const nameIn = add.createEl("input", { attr: { type: "text", placeholder: "New area, for example Health", "aria-label": "Name of the new area", maxlength: "40" } });
    const colorIn = add.createEl("input", { attr: { type: "color", value: free, "aria-label": "Colour of the new area" } });
    const hint = add.createSpan({ cls: "life-os-area-hint", text: "" });
    const go = add.createEl("button", { text: "+ Add area", cls: "mod-cta", attr: { type: "button" } });
    const update = () => {
      const n = nameIn.value.replace(/[\\/:*?"<>|#^[\]]/g, "").trim(), key = areaSlug(n);
      const taken = key && (plugin.areaList || []).some((a) => a.key === key);
      hint.setText(!key ? `Makes ${AREA_ROOT}/<Name>/<Name>.md and a tab.` : taken ? `#${key} is already an area.` : `Makes ${AREA_ROOT}/${n}/${n}.md, the tag #${key}, and a ${n} tab.`);
      go.disabled = !key || taken;
    };
    update();
    this.registerDomEvent(nameIn, "input", update);
    const create = async () => {
      if (go.disabled) return;
      const id = await plugin.createArea(nameIn.value, colorIn.value);
      if (id) { this.activeScreen = id; this.render(true); plugin.refreshPalettes(); }
    };
    this.registerDomEvent(nameIn, "keydown", (e) => { if (e.key === "Enter") void create(); });
    this.registerDomEvent(go, "click", () => void create());
  }

  // Rename an area: shows what would change (count and list) before anything is written.
  openAreaRename(a) {
    const plugin = this.plugin, view = this;
    const oldName = plugin.areaName(a.key), locked = false;
    const modal = new Modal(this.app);
    modal.titleEl.setText(`Rename ${oldName}`);
    const c = modal.contentEl;
    c.addClass("life-os-area-rename");
    const nameIn = c.createEl("input", { attr: { type: "text", value: oldName, "aria-label": "New name", maxlength: "40" } });
    const what = c.createDiv({ cls: "life-os-area-what" });
    let keyBox = null;
    {
      const lab = c.createEl("label", { cls: "life-os-area-keyrow" });
      keyBox = lab.createEl("input", { attr: { type: "checkbox" } });
      lab.createSpan({ cls: "life-os-area-keytext" });
    }
    const list = c.createEl("details", { cls: "life-os-area-list" });
    const listSum = list.createEl("summary");
    const ul = list.createEl("ul");
    let uses = null;
    const row = c.createDiv({ cls: "modal-button-container" });
    const cancel = row.createEl("button", { text: "Cancel" });
    const ok = row.createEl("button", { text: "Rename", cls: "mod-cta" });
    const refresh = () => {
      const n = nameIn.value.replace(/[\\/:*?"<>|#^[\]]/g, "").trim(), key = areaSlug(n);
      const bits = [`the tab name: ${oldName} to ${n || "?"}`];
      if (!locked && a.path) bits.push(`the folder and note: ${AREA_ROOT}/${n || "?"}/${n || "?"}.md (links to it follow)`);
      what.empty();
      what.createEl("p", { text: "Changes:" });
      const w = what.createEl("ul");
      for (const b of bits) w.createEl("li", { text: b });
      let bad = !n;
      if (keyBox) {
        const same = key === a.key, taken = !same && (plugin.areaList || []).some((x) => x.key === key);
        keyBox.disabled = same || !key || taken;
        if (keyBox.disabled) keyBox.checked = false;
        const count = uses ? `${uses.lines.length} line${uses.lines.length === 1 ? "" : "s"} tagged #${a.key} in ${new Set(uses.lines.map((l) => l.path)).size} note${new Set(uses.lines.map((l) => l.path)).size === 1 ? "" : "s"}, and ${uses.props.length} note${uses.props.length === 1 ? "" : "s"} with area: ${a.key}` : "counting...";
        keyBox.parentElement.querySelector(".life-os-area-keytext").setText(same || !key ? `The tag stays #${a.key}.` : taken ? `#${key} is already an area, so the tag stays #${a.key}.` : `Also change the tag #${a.key} to #${key}: ${count}.`);
        list.toggleClass("is-hidden", !keyBox.checked || !uses);
      } else list.addClass("is-hidden");
      ok.disabled = bad;
      ok.setText(keyBox?.checked && uses ? `Rename and change ${uses.lines.length + uses.props.length} place${uses.lines.length + uses.props.length === 1 ? "" : "s"}` : "Rename");
    };
    void plugin.areaKeyUses(a.key).then((u) => {
      uses = u;
      listSum.setText(`Show the ${u.lines.length + u.props.length} places`);
      for (const l of u.lines) ul.createEl("li", { text: `${l.path}:${l.line + 1}  ${l.before.trim().slice(0, 90)}` });
      for (const p of u.props) ul.createEl("li", { text: `${p}  area: ${a.key}` });
      refresh();
    });
    nameIn.addEventListener("input", refresh);
    keyBox?.addEventListener("change", refresh);
    cancel.addEventListener("click", () => modal.close());
    const doIt = async () => {
      if (ok.disabled) return;
      ok.disabled = true;
      modal.close();
      await plugin.renameArea(a.key, nameIn.value, !!keyBox?.checked);
      view.render(true);
    };
    ok.addEventListener("click", () => void doIt());
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") void doIt(); });
    refresh();
    modal.open();
    window.setTimeout(() => { nameIn.focus(); nameIn.select(); }, 0);
  }


  colourDots(parent, now, pick) {
    const row = parent.createSpan({ cls: "life-os-dots" });
    for (const [name, hex] of Object.entries(THEME_PRESETS)) {
      const d = row.createEl("button", { cls: String(now || "").toLowerCase() === hex ? "life-os-dot is-active" : "life-os-dot", attr: { title: name, "aria-label": `Colour ${name}`, style: `--sw:${hex}` } });
      d.type = "button";
      this.registerDomEvent(d, "click", () => void pick(hex));
    }
  }

  getTaskContext(task) {
    if (task.overdue) {
      return `Overdue · ${dmy(task.due)}`;
    }
    if (task.dueToday) {
      return "Due today";
    }
    if (task.scheduledToday) {
      return "Scheduled today";
    }
    if (task.due) {
      return `Due ${dmy(task.due)}`;
    }
    if (task.scheduled) {
      return `Scheduled ${dmy(task.scheduled)}`;
    }
    return this.getFileTitle({ path: task.path });
  }

  renderSystemSummary(parent) {
    const stats = this.getSystemStats();
    const section = parent.createEl("section", { cls: "life-os-summary" });
    section.createEl("h2", { text: "Live system" });
    const grid = section.createDiv({ cls: "life-os-stat-grid" });

    for (const stat of stats) {
      const card = grid.createDiv({ cls: "life-os-stat" });
      const icon = card.createSpan({ cls: "life-os-stat-icon" });
      setIcon(icon, stat.icon);
      const copy = card.createDiv();
      copy.createEl("strong", { text: String(stat.value) });
      copy.createSpan({ text: stat.label });
    }
  }

  renderSetupBanner(parent) {
    const setupPath = "00 Dashboards/Setup.md";
    const setupFile = this.app.vault.getAbstractFileByPath(setupPath);
    const fm = this.getFrontmatter(setupFile);
    const status = String(fm.status || "open").toLowerCase();
    if (status === "done" || status === "complete" || status === "completed") {
      return;
    }
    const REQUIRED = [0, 1, 2];
    const holder = parent.createDiv();
    const draw = (done, total) => {
      holder.empty();
      const all = total > 0 && done === total;
      const banner = holder.createEl("section", { cls: all ? "life-os-setup-banner is-complete" : "life-os-setup-banner" });
      const icon = banner.createSpan({ cls: "life-os-setup-icon" });
      setIcon(icon, all ? "check-circle-2" : "route");
      const copy = banner.createDiv();
      copy.createEl("strong", { text: all ? `${this.appName()} is set up` : `Finish your ${this.appName()} setup` });
      copy.createEl("p", {
        text: all
          ? "The app, your own words and the first daily note are in place. Finish to put this banner away; Setup stays in 00 Dashboards."
          : total ? `${done} of ${total} required setup sections done.` : "Checking setup...",
      });
      const bar = copy.createDiv({ cls: "life-os-setup-progress", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total || REQUIRED.length), "aria-valuenow": String(done) } });
      bar.createDiv({ attr: { style: `width:${total ? (100 * done) / total : 0}%` } });
      if (all && setupFile) {
        this.addButton(banner, { icon: "check", label: "Finish setup", description: "Hide this banner.", primary: true,
          onClick: () => void this.app.fileManager.processFrontMatter(setupFile, (f) => { f.status = "done"; }) });
      } else {
        this.addButton(banner, { icon: "arrow-right", label: "Continue setup", description: "See what is left.", onClick: () => this.openPath(setupPath) });
      }
    };
    draw(0, 0);
    void this.setupProgress(fm).then(({ done, total }) => draw(done, total)).catch(() => draw(0, REQUIRED.length));
  }

  // Runs the setup checks (the Setup note's checks; built in, or your copy in Meta/views/setup-checks.js) through the Dataview API.
  async setupProgress(fm) {
    const REQUIRED = [0, 1, 2];
    const marked = new Set((Array.isArray(fm.setup_sections_done) ? fm.setup_sections_done : []).map(Number));
    const dv = this.app.plugins?.plugins?.dataview?.api;
    let rows = [];
    try {
      const src = await this.plugin.widgetCode("setup-checks");
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      if (dv) rows = await new AsyncFunction("dv", "app", "moment", "cur", src)(dv, this.app, moment, fm);
    } catch (error) { console.warn("EX3C setup checks", error); }
    const passing = (t) => rows.length > 0 && rows.filter((r) => r.tier === t && !r.opt).every((r) => r.ok);
    return { done: REQUIRED.filter((t) => marked.has(t) || passing(t)).length, total: REQUIRED.length };
  }

  getSystemStats() {
    const paths = this.getConfiguredFolders();
    const files = this.app.vault.getMarkdownFiles().filter((file) => this.isDomainRecord(file));
    const frontmatter = (file) =>
      this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const typeCount = (types) =>
      files.filter((file) => types.includes(String(frontmatter(file).type || ""))).length;

    const activeProjects = files.filter((file) => {
      const data = frontmatter(file);
      const status = String(data.status || "").toLowerCase();
      return (
        data.type === "project" &&
        !["done", "complete", "completed", "archived"].includes(status)
      );
    }).length;

    const todayPath = `${paths.daily}/${moment().format("YYYY-MM-DD")}.md`;
    const weekPath = `${paths.weekly}/${moment().format("gggg-[W]ww")}.md`;
    const aiReady =
      this.pluginLoaded("agent-client") &&
      this.pluginLoaded("obsidian-local-rest-api");

    return [
      {
        icon: "calendar-check",
        value: this.app.vault.getAbstractFileByPath(todayPath) ? "Ready" : "Not created",
        label: "Today",
      },
      {
        icon: "calendar-range",
        value: this.app.vault.getAbstractFileByPath(weekPath) ? "Ready" : "Not created",
        label: "This week",
      },
      { icon: "folder-kanban", value: activeProjects, label: "Active projects" },
      { icon: "users", value: typeCount(["person"]), label: "People" },
      {
        icon: "pen-tool",
        value: typeCount(["post", "video-script", "review"]),
        label: "Creative notes",
      },
      ...(this.plugin.aiOn() ? [{
        icon: "sparkles",
        value: aiReady ? "Loaded" : "Unavailable",
        label: "AI tools",
      }] : []),
    ];
  }

  renderActionSection(parent, title, description, actions, onSelect) {
    const section = parent.createEl("section", {
      cls: "life-os-section",
    });

    const heading = section.createDiv({ cls: "life-os-section-heading" });
    heading.createEl("h2", { text: title });
    heading.createEl("p", { text: description });

    const grid = section.createDiv({ cls: "life-os-grid" });

    for (const action of actions) {
      // a shortcut to a retired dashboard goes to its tab: left out on that tab itself, or when that tab is gone
      const goes = action.path && !this.app.vault.getAbstractFileByPath(action.path) ? RETIRED_DASHBOARDS[action.path] : null;
      if (goes && (goes === this.activeScreen || !this.layout.tabs.some((t) => t.id === goes) || ["Discuss queue", "Whole-life review"].includes(action.label))) continue;
      this.addButton(grid, {
        icon: action.icon,
        label: action.label,
        description: action.description,
        onClick: () => onSelect(action),
      });
    }
  }

  addButton(parent, options) {
    const button = parent.createEl("button", {
      cls: options.primary
        ? "life-os-action is-primary"
        : "life-os-action",
    });

    button.type = "button";

    const icon = button.createSpan({ cls: "life-os-action-icon" });
    setIcon(icon, options.icon);

    const copy = button.createSpan({ cls: "life-os-action-copy" });
    copy.createSpan({
      cls: "life-os-action-label",
      text: options.label,
    });
    copy.createSpan({
      cls: "life-os-action-description",
      text: options.description,
    });

    this.registerDomEvent(button, "click", () => {
      void options.onClick();
    });

    return button;
  }

  addStatus(parent, iconName, label, active) {
    const chip = parent.createSpan({
      cls: active
        ? "life-os-status is-active"
        : "life-os-status is-inactive",
    });

    const icon = chip.createSpan();
    setIcon(icon, iconName);
    chip.createSpan({ text: label });
  }

  runCommand(commandId, label) {
    return this.plugin.runCommand(commandId, label);
  }

  async openPath(path, line = null) {
    if (RETIRED_DASHBOARDS[path] && !this.app.vault.getAbstractFileByPath(path) && this.layout.tabs.some((t) => t.id === RETIRED_DASHBOARDS[path])) {
      this.activeScreen = RETIRED_DASHBOARDS[path];
      this.render(true);
      return;
    }
    if (path === `${DEFAULT_FOLDERS.projects}/Projects Board.md`) {
      path = `${this.getConfiguredFolders().projects}/Projects Board.md`;
    }
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      new Notice(`EX3C AgendA could not find ${path}.`);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, Number.isInteger(line) && line > 0 ? { eState: { line: line - 1 } } : {});
    const editor = leaf.view?.editor;
    if (editor && Number.isInteger(line) && line > 0) {
      const position = { line: line - 1, ch: 0 };
      editor.setCursor(position);
      editor.scrollIntoView?.({ from: position, to: position }, true);
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  pluginLoaded(id) {
    return Boolean(this.app.plugins?.getPlugin?.(id));
  }

  pluginSettings(id) {
    return this.app.plugins?.getPlugin?.(id)?.settings || {};
  }
}

// Original Canvas renderer inspired by SEO OS's brain-shaped knowledge map.
// Positions are decorative; every displayed edge comes from resolved vault links.
class LifeOSBrainRenderer extends Component {
  constructor(app, contentEl, compact = false) {
    super();
    this.app = app;
    this.contentEl = contentEl;
    this.compact = compact;
    this.panX = 0;
    this.panY = 0;
    this.yaw = 0.28;
    this.pitch = -0.12;
    this.labelMode = compact ? "off" : "auto";
    this.zoom = 1;
    this.query = "";
    this.region = "all";
    this.selected = null;
    this.hovered = null;
    this.nodes = [];
    this.edges = [];
    this.projected = [];
    this.regions = [
      { id: "direction", name: "Direction & projects", color: "#ff906b" },
      { id: "memory", name: "Journal & reflection", color: "#c095e8" },
      { id: "people", name: "People", color: "#e5b96a" },
      { id: "knowledge", name: "Knowledge & ideas", color: "#6fbdd8" },
      { id: "practice", name: "Tasks & systems", color: "#82c3a5" },
    ];
  }
  getViewType() { return "life-os-brain"; }
  getDisplayText() { return "EX3C AgendA Brain"; }
  getIcon() { return "brain"; }
  async onOpen() {
    const root = this.contentEl;
    root.empty(); root.addClass("life-os-brain");
    const header = root.createDiv({ cls: "life-os-brain-header" });
    const title = header.createDiv();
    title.createEl("h2", { text: "Your connected brain" });
    this.summary = title.createEl("p", { text: "Reading vault links…", attr: { "aria-live": "polite" } });
    const controls = header.createDiv({ cls: "life-os-brain-controls" });
    const search = controls.createEl("input", { attr: { type: "search", placeholder: "Find a note…", "aria-label": "Search brain notes" } });
    this.registerDomEvent(search, "input", () => { this.query = search.value.toLowerCase(); this.update(); });
    const reset = controls.createEl("button", { text: "Reset view" });
    this.registerDomEvent(reset, "click", () => { this.panX = 0; this.panY = 0; this.yaw = 0.28; this.pitch = -0.12; this.zoom = 1; this.clearHover(); });
    const labels = controls.createEl("select", { attr: { "aria-label": "Note labels" } });
    for (const [value, text] of [["auto", "Labels: Auto"], ["all", "Labels: All"], ["off", "Labels: Hover only"]]) labels.createEl("option", { text, attr: { value } });
    this.registerDomEvent(labels, "change", () => { this.labelMode = labels.value; this.draw(); });
    const standard = controls.createEl("button", { text: "Standard graph" });
    this.registerDomEvent(standard, "click", () => {
      if (!this.app.commands.executeCommandById("graph:open")) new Notice("Enable Obsidian's Graph view core plugin first.");
    });
    this.filters = root.createDiv({ cls: "life-os-brain-filters", attr: { "aria-label": "Brain regions" } });
    for (const region of [{ id: "all", name: "All regions", color: "#c4cecc" }, ...this.regions]) {
      const button = this.filters.createEl("button", { text: region.name, attr: { "aria-pressed": String(region.id === this.region), style: `--region-color:${region.color}` } });
      this.registerDomEvent(button, "click", () => {
        this.region = region.id;
        [...this.filters.children].forEach((child) => child.setAttribute("aria-pressed", String(child === button)));
        this.update();
      });
    }
    const body = root.createDiv({ cls: "life-os-brain-body" });
    this.stage = body.createDiv({ cls: "life-os-brain-stage" });
    this.canvas = this.stage.createEl("canvas", { attr: { tabindex: "0", "aria-label": "3D brain graph. Drag to rotate, Shift-drag to pan, scroll to zoom. Arrow keys rotate. Browse notes in the adjacent list." } });
    this.caption = this.stage.createDiv({ cls: "life-os-brain-caption", text: "Drag to rotate · Shift-drag to pan · Scroll to zoom" });
    this.tooltip = this.stage.createDiv({ cls: "life-os-brain-tooltip", attr: { role: "tooltip" } });
    this.tooltip.hidden = true;
    this.panel = body.createEl("aside", { cls: "life-os-brain-panel", attr: { "aria-label": "Notes and connections" } });
    this.ctx = this.canvas.getContext("2d");
    if (!this.ctx) this.caption.setText("Canvas is unavailable. Browse and open notes in the list.");
    let drag = null;
    this.registerDomEvent(this.canvas, "pointerdown", (event) => {
      this.clearHover();
      drag = { x: event.clientX, y: event.clientY, distance: 0 };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.registerDomEvent(this.canvas, "pointermove", (event) => {
      if (!drag) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        const hit = this.hitTest(x, y);
        const changed = this.hovered !== (hit?.node.path || null);
        this.hovered = hit?.node.path || null;
        this.tooltip.empty();
        this.tooltip.hidden = !hit;
        if (hit) {
          this.tooltip.createEl("strong", { text: hit.node.title });
          this.tooltip.createDiv({ text: hit.node.path });
          this.tooltip.createDiv({ text: `${this.regions.find((r) => r.id === hit.node.region).name} · ${hit.node.degree} connections${hit.node.sample ? " · Sample note" : ""}` });
          this.tooltip.createDiv({ text: "Click to explore linked notes" });
          this.tooltip.style.left = `${Math.max(8, Math.min(x + 16, rect.width - this.tooltip.offsetWidth - 8))}px`;
          this.tooltip.style.top = `${Math.max(8, Math.min(y + 16, rect.height - this.tooltip.offsetHeight - 8))}px`;
        }
        this.canvas.style.cursor = hit ? "pointer" : "grab";
        if (changed) this.draw();
        return;
      }
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.distance += Math.abs(dx) + Math.abs(dy);
      if (event.shiftKey) { this.panX += dx; this.panY += dy; }
      else { this.yaw += dx * 0.007; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.007)); }
      drag.x = event.clientX; drag.y = event.clientY;
      this.draw();
    });
    this.registerDomEvent(this.canvas, "pointerup", (event) => {
      if (drag && drag.distance < 6) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        const hit = this.hitTest(x, y);
        this.selected = hit?.node.path || null;
        this.update();
      }
      drag = null;
    });
    this.registerDomEvent(this.canvas, "pointercancel", () => { drag = null; });
    this.registerDomEvent(this.canvas, "pointerleave", () => this.clearHover());
    this.registerDomEvent(this.canvas, "wheel", (event) => {
      event.preventDefault();
      this.clearHover();
      this.zoom = Math.max(0.55, Math.min(2.5, this.zoom * Math.exp(-event.deltaY * 0.001)));
      this.draw();
    }, { passive: false });
    this.registerDomEvent(this.canvas, "keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Escape"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") this.yaw -= 0.1;
      if (event.key === "ArrowRight") this.yaw += 0.1;
      if (event.key === "ArrowUp") this.pitch = Math.max(-1.4, this.pitch - 0.1);
      if (event.key === "ArrowDown") this.pitch = Math.min(1.4, this.pitch + 0.1);
      if (["+", "="].includes(event.key)) this.zoom = Math.min(2.5, this.zoom + 0.1);
      if (event.key === "-") this.zoom = Math.max(0.55, this.zoom - 0.1);
      if (event.key === "Escape") this.selected = null;
      this.update();
    });
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(this.stage);
    const refresh = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.refresh(), 150);
    };
    this.registerEvent(this.app.metadataCache.on("resolved", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("create", refresh));
    this.refresh();
    if (this.compact) {
      this.canvas.setAttribute("tabindex", "-1");
      this.canvas.setAttribute("aria-label", "Preview of connected notes. Use Explore Brain for interactive navigation.");
    }
  }
  regionFor(path) {
    if (/^(03 Planning|04 Projects)\//.test(path)) return "direction";
    if (/^(01 Journal|02 Retreats)\//.test(path)) return "memory";
    if (path.startsWith("05 People/")) return "people";
    if (/^(06 Writing|07 Library|09 Reading|wiki|inbox|Inbox \(uncategorised\))\//.test(path)) return "knowledge";
    return "practice";
  }
  clearHover() {
    this.hovered = null;
    if (this.tooltip) this.tooltip.hidden = true;
    this.draw();
  }
  hitTest(x, y) {
    const connected = new Set(this.selected ? this.edges.filter(([a, b]) => a === this.selected || b === this.selected).flat() : []);
    return [...this.projected].reverse().filter((p) => this.selected ? p.node.path === this.selected || connected.has(p.node.path) : this.matches(p.node))
      .map((p) => ({ ...p, distance: Math.hypot(p.x - x, p.y - y) }))
      .filter((p) => p.distance < 10).sort((a, b) => a.distance - b.distance || b.depth - a.depth)[0];
  }
  // Low-resolution 3D volume derived from the original folded brain contour.
  // Cached independently of graph hover so labels never rebuild the surface.
  buildBrainGeometry() {
    if (this.brainGeometry) return this.brainGeometry;
    const sample = (d, count, closed = false) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      const length = path.getTotalLength();
      return Array.from({ length: count }, (_, i) => {
        const p = path.getPointAtLength(length * i / (closed ? count : count - 1));
        return [p.x / 180, -p.y / 180];
      });
    };
    const contour = sample("M -8 -151 C -8 -177 -43 -183 -59 -162 C -82 -180 -113 -159 -113 -140 C -140 -143 -159 -122 -155 -99 C -183 -92 -190 -62 -176 -43 C -199 -21 -188 12 -174 22 C -191 46 -176 73 -155 76 C -160 102 -136 123 -115 118 C -103 147 -74 153 -55 137 C -34 155 -8 135 -8 113 Z", 80, true);
    const grooves = ["M -59 -162 C -43 -145 -69 -130 -56 -112 C -46 -98 -22 -115 -8 -99","M -113 -140 C -92 -145 -77 -129 -85 -109 C -96 -89 -118 -111 -126 -91 C -132 -76 -117 -60 -98 -68","M -155 -99 C -137 -93 -151 -63 -135 -48 C -119 -34 -99 -49 -86 -31 C -75 -15 -90 2 -111 -3","M -176 -43 C -159 -50 -141 -28 -150 -10 C -161 7 -151 25 -132 27 C -109 28 -112 51 -93 55","M -174 22 C -160 31 -175 57 -155 76 C -141 87 -125 67 -112 80 C -99 94 -116 106 -115 118","M -8 -61 C -28 -78 -53 -67 -49 -48 C -44 -28 -65 -21 -62 -3 C -59 15 -32 13 -24 31 C -15 46 -31 65 -8 76","M -55 -112 C -77 -97 -61 -77 -73 -63","M -132 27 C -126 6 -142 -8 -128 -24","M -93 55 C -68 40 -53 61 -61 80 C -69 101 -91 99 -83 119 C -78 133 -63 125 -55 137","M -8 113 C -26 100 -27 79 -45 83"].map((d) => sample(d, 28));
    const faces = [], lines = [];
    for (const side of [1, -1]) {
      const rings = [];
      for (let r = 0; r <= 12; r++) {
        const angle = -Math.PI / 2 + r / 12 * Math.PI;
        rings.push(contour.map(([x, y]) => [
          side * (-0.50 + (x + 0.50) * Math.cos(angle)),
          0.03 + (y - 0.03) * Math.cos(angle),
          Math.sin(angle) * 1.05,
        ]));
      }
      for (let r = 0; r < 12; r++) for (let i = 0; i < contour.length; i++) {
        const next = (i+1) % contour.length;
        faces.push([rings[r][i], rings[r][next], rings[r+1][next], rings[r+1][i]]);
      }
      lines.push({ points: [...rings[6], rings[6][0]], alpha: 0.28 });
      for (const zside of [-1, 1]) for (const groove of grooves) {
        lines.push({ points: groove.map(([x, y]) => {
          const angle = Math.atan2(y-0.03, x+0.5);
          const distance = Math.hypot(x+0.5,y-0.03);
          const boundary = contour.reduce((best,p) => {
            const delta = Math.atan2(p[1]-0.03,p[0]+0.5)-angle;
            const error = Math.abs(Math.atan2(Math.sin(delta),Math.cos(delta)));
            return error < best.error ? { error, radius: Math.hypot(p[0]+0.5,p[1]-0.03) } : best;
          }, { error: Infinity, radius: 1 });
          const ratio = Math.min(1, distance / boundary.radius);
          return [x*side,y,zside*1.05*Math.sqrt(1-ratio*ratio)];
        }), alpha: zside === 1 ? 0.23 : 0.09 });
      }
    }
    // Rounded stem, also a volume, not a flat overlay.
    for (let i = 0; i < 16; i++) {
      const a = i/16*Math.PI*2, b = (i+1)/16*Math.PI*2;
      faces.push([[Math.cos(a)*0.10,-0.72,Math.sin(a)*0.10-0.25],
        [Math.cos(b)*0.10,-0.72,Math.sin(b)*0.10-0.25],
        [Math.cos(b)*0.07,-1.12,Math.sin(b)*0.07-0.15],
        [Math.cos(a)*0.07,-1.12,Math.sin(a)*0.07-0.15]]);
    }
    return this.brainGeometry = { faces, lines };
  }
  drawSurface(ctx, width, height) {
    const key = [width,height,this.yaw,this.pitch,this.panX,this.panY,this.zoom,window.devicePixelRatio].join(":");
    if (key !== this.surfaceKey) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = this.surfaceCanvas || (this.surfaceCanvas = document.createElement("canvas"));
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
      const layer = canvas.getContext("2d");
      layer.setTransform(dpr,0,0,dpr,0,0);
      const geometry = this.buildBrainGeometry();
      const faces = geometry.faces.map((face) => face.map((p) => this.project(p,width,height)));
      faces.sort((a,b) => a.reduce((s,p)=>s+p.depth,0)-b.reduce((s,p)=>s+p.depth,0));
      layer.fillStyle = "rgba(240,160,135,0.055)";
      for (const face of faces) {
        layer.beginPath(); face.forEach((p,i)=> i ? layer.lineTo(p.x,p.y) : layer.moveTo(p.x,p.y));
        layer.closePath(); layer.fill();
      }
      layer.lineWidth = 1.1; layer.lineJoin = "round"; layer.lineCap = "round";
      for (const line of geometry.lines) {
        layer.beginPath();
        line.points.forEach((v,i) => { const p=this.project(v,width,height); if(i) layer.lineTo(p.x,p.y); else layer.moveTo(p.x,p.y); });
        layer.strokeStyle = `rgba(240,160,145,${line.alpha})`; layer.stroke();
      }
      this.surfaceKey = key;
    }
    ctx.drawImage(this.surfaceCanvas, 0, 0, width, height);
  }
  pointFor(path, region) {
    let hash = 0;
    for (const char of path) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    const random = () => { hash = (Math.imul(hash, 1664525) + 1013904223) | 0; return (hash >>> 0) / 4294967296; };
    const side = random() < 0.5 ? -1 : 1;
    const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 0.72;
    let y = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    if (region === "direction") z = 0.35 + random() * 0.45;
    if (region === "memory") y = 0.2 + random() * 0.55;
    if (region === "people") { y = -0.3 - random() * 0.35; z *= 0.65; }
    if (region === "knowledge") z = -0.3 - random() * 0.5;
    let x = (random() * 2 - 1) * 0.82;
    y = (y - 0.08) / 0.82; z /= 1.12;
    const radius3 = Math.hypot(x, y, z);
    if (radius3 > 0.85) { const factor = 0.85 / radius3; x *= factor; y *= factor; z *= factor; }
    return [side * 0.46 + x * 0.45, 0.08 + y * 0.82, z * 1.12];
  }
  refresh() {
    const all = this.app.vault.getMarkdownFiles().filter((file) =>
      !/^(build|Templates|scripts|Guide|Meta)\//i.test(file.path) && !file.path.startsWith("."));
    const files = all.sort((a, b) => a.path.localeCompare(b.path)).slice(0, this.compact ? 300 : 2000);
    this.total = all.length;
    this.nodes = files.map((file) => {
      const region = this.regionFor(file.path);
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      const tags = Array.isArray(data.tags) ? data.tags : String(data.tags || "").split(/[ ,]+/);
      return { path: file.path, title: file.basename || file.path.split("/").pop().replace(/\.md$/, ""), region,
        sample: data.example === true || tags.some((tag) => String(tag).replace(/^#/, "") === "example"),
        point: this.pointFor(file.path, region), degree: 0 };
    });
    const lookup = new Map(this.nodes.map((node) => [node.path, node]));
    const seen = new Set(); this.edges = [];
    for (const [source, targets] of Object.entries(this.app.metadataCache.resolvedLinks || {})) {
      if (!lookup.has(source)) continue;
      for (const target of Object.keys(targets)) {
        if (!lookup.has(target) || source === target) continue;
        const key = JSON.stringify([source, target].sort());
        if (seen.has(key)) continue;
        seen.add(key); this.edges.push([source, target]);
        lookup.get(source).degree++; lookup.get(target).degree++;
      }
    }
    if (!lookup.has(this.selected)) this.selected = null;
    this.update();
  }
  matches(node) { return (this.region === "all" || node.region === this.region) && node.path.toLowerCase().includes(this.query); }
  async openNote(node) {
    const file = this.app.vault.getAbstractFileByPath(node.path);
    if (!(file instanceof TFile)) { new Notice("This note is no longer available."); return; }
    const leaf = this.app.workspace.getLeaf("tab"); await leaf.openFile(file); await this.app.workspace.revealLeaf(leaf);
  }
  update() {
    if (!this.panel) return;
    this.hovered = null;
    if (this.tooltip) this.tooltip.hidden = true;
    const visible = this.nodes.filter((node) => this.matches(node));
    const paths = new Set(visible.map((node) => node.path));
    const edgeCount = this.edges.filter(([a, b]) => paths.has(a) && paths.has(b)).length;
    this.summary.setText(`${visible.length} notes · ${edgeCount} links · ${visible.filter((node) => node.sample).length} sample notes${this.total > this.nodes.length ? ` · showing ${this.nodes.length} of ${this.total}` : ""}`);
    if (this.compact) { this.draw(); return; }
    this.panel.empty();
    const selected = this.nodes.find((node) => node.path === this.selected);
    if (selected) {
      this.panel.createEl("h3", { text: selected.title });
      this.panel.createEl("p", { text: `${selected.path}${selected.sample ? " · Sample note" : ""}` });
      const open = this.panel.createEl("button", { text: "Open note", cls: "life-os-brain-open" });
      open.addEventListener("click", () => void this.openNote(selected));
    }
    const connected = new Set(this.edges.flatMap(([a, b]) => a === this.selected ? [b] : b === this.selected ? [a] : []));
    const list = selected ? this.nodes.filter((node) => connected.has(node.path)) : visible;
    this.panel.createEl("h3", { text: selected ? `Connected notes (${list.length})` : `Browse notes (${visible.length})` });
    if (!list.length) this.panel.createEl("p", { text: selected ? "No linked notes yet. Add a wikilink in this note to connect it." : "No matching notes." });
    for (const node of [...list].sort((a, b) => b.degree - a.degree || a.path.localeCompare(b.path)).slice(0, 60)) {
      const button = this.panel.createEl("button", { cls: "life-os-brain-note", attr: { title: node.path } });
      button.createSpan({ text: node.title });
      button.createEl("small", { text: `${node.degree} links${node.sample ? " · Sample" : ""}` });
      button.addEventListener("click", () => { this.selected = node.path; this.update(); });
    }
    if (list.length > 60) this.panel.createEl("p", { text: "Showing the 60 most connected notes. Search to narrow the list." });
    if (selected) {
      const clear = this.panel.createEl("button", { text: "Clear selection" });
      clear.addEventListener("click", () => { this.selected = null; this.update(); });
    }
    this.draw();
  }
  project(point, width, height) {
    const [x, y, z] = point;
    const rx = x * Math.cos(this.yaw) + z * Math.sin(this.yaw);
    const rz = z * Math.cos(this.yaw) - x * Math.sin(this.yaw);
    const ry = y * Math.cos(this.pitch) - rz * Math.sin(this.pitch);
    const depth = y * Math.sin(this.pitch) + rz * Math.cos(this.pitch);
    const scale = Math.min(width, height) * 0.31 * this.zoom * 4.5 / (4.5 - depth);
    return { x: width / 2 + this.panX + rx * scale, y: height / 2 + this.panY - ry * scale, depth, scale };
  }
  draw() {
    const ctx = this.ctx;
    if (!ctx || !this.stage) return;
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    if (!this.compact) {
      const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.min(width, height) * 0.6);
      glow.addColorStop(0, "#173135"); glow.addColorStop(1, "#0c1118"); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    }
    this.drawSurface(ctx, width, height);
    this.projected = this.nodes.map((node) => ({ ...this.project(node.point, width, height), node })).sort((a, b) => a.depth - b.depth);
    const lookup = new Map(this.projected.map((point) => [point.node.path, point]));
    const focus = this.hovered || this.selected;
    const edges = focus ? this.edges.filter(([a, b]) => a === focus || b === focus) : this.edges;
    const connected = new Set(focus ? edges.flat() : []);
    for (const [a, b] of edges.slice(0, 10000)) {
      const source = lookup.get(a), target = lookup.get(b);
      if (!this.selected && (!this.matches(source.node) || !this.matches(target.node))) continue;
      ctx.beginPath(); ctx.moveTo(source.x, source.y); ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = focus ? "rgba(255,203,159,0.9)" : "rgba(156,193,204,0.15)";
      ctx.lineWidth = focus ? 1.5 : 0.6; ctx.stroke();
    }
    for (const point of this.projected) {
      const active = (focus ? connected.has(point.node.path) || point.node.path === focus : true) && (this.selected || this.matches(point.node)), selected = point.node.path === focus;
      const color = this.regions.find((region) => region.id === point.node.region).color;
      const radius = selected ? 7 : 2.5 + Math.min(3, Math.sqrt(point.node.degree) * 0.5);
      ctx.globalAlpha = active ? Math.max(0.45, 0.7 + point.depth * 0.2) : 0.05;
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.drawLabels(ctx, width, height, focus, connected);
    this.caption.setText(edges.length > 10000 ? "10,000 links drawn. Select a note to isolate its connections." : "Drag to rotate · Shift-drag to pan · Scroll to zoom · Hover or click a note");
  }
  drawLabels(ctx, width, height, focus, connected) {
    const occupied = [];
    this.visibleLabels = [];
    const candidates = this.projected.filter((p) => (this.selected || this.matches(p.node)) && (!focus || p.node.path === focus || connected.has(p.node.path)))
      .sort((a,b) => Number(b.node.path === focus)-Number(a.node.path === focus) || b.node.degree-a.node.degree || b.depth-a.depth);
    ctx.font = "12px sans-serif";
    for (const p of candidates) {
      if (this.labelMode === "off" && p.node.path !== focus) continue;
      const title = p.node.title.length > 36 ? p.node.title.slice(0,35)+"…" : p.node.title;
      const w = ctx.measureText(title).width + 8;
      const box = { x: p.x+9, y: p.y-17, w, h: 18 };
      if (box.x < 0 || box.y < 0 || box.x+w > width || box.y+18 > height-35) continue;
      if (this.labelMode === "auto" && occupied.some((r) => box.x < r.x+r.w && box.x+w > r.x && box.y < r.y+r.h && box.y+18 > r.y)) continue;
      occupied.push(box); this.visibleLabels.push(p.node.path);
      ctx.fillStyle = "rgba(12,17,24,0.78)"; ctx.fillRect(box.x,box.y,w,18);
      ctx.fillStyle = p.node.path === focus ? "#fff1e4" : "#bac9d0";
      ctx.fillText(title,box.x+4,box.y+13);
    }
  }
  async onClose() {
    clearTimeout(this.timer); this.observer?.disconnect(); this.contentEl.empty(); this.ctx = null; this.panel = null; this.surfaceCanvas = null; this.brainGeometry = null;
  }
  onload() { void this.onOpen(); }
  onunload() { void this.onClose(); }
}

// Retain compatibility with already-open standalone Brain tabs.
class LifeOSBrainView extends ItemView {
  async onOpen() {
    this.renderer = new LifeOSBrainRenderer(this.app, this.contentEl);
    this.addChild(this.renderer);
  }
  getViewType() { return "life-os-brain"; }
  getDisplayText() { return "EX3C AgendA Brain"; }
  getIcon() { return "brain"; }
  async onClose() { if (this.renderer) this.removeChild(this.renderer); this.renderer = null; }
}

class LifeOSWidgetPaletteView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
  }
  getViewType() { return PALETTE_VIEW; }
  getDisplayText() { return "EX3C AgendA widgets"; }
  getIcon() { return "layout-grid"; }
  async onOpen() { this.render(); }
  async onClose() { this.contentEl.empty(); }

  render() {
    const root = this.contentEl;
    const hadFocus = root.contains(document.activeElement) && document.activeElement?.tagName === "INPUT";
    const keepScroll = root.scrollTop; // redrawing the panel must not jump back to the top
    window.requestAnimationFrame(() => { root.scrollTop = keepScroll; });
    if (!(this.previewing instanceof Set)) this.previewing = new Set();
    root.empty();
    root.addClass("life-os-palette");
    const plugin = this.plugin;
    const current = plugin.currentTab();
    root.createEl("h3", { text: "Widgets" });
    root.createEl("p", { cls: "life-os-palette-help", text: plugin.editing
      ? "Drag a widget onto a tab in EX3C AgendA, or into the page where it should go. A widget can sit on several tabs. Drop a widget from the page here to take it off that tab."
      : "Press Edit layout to rearrange EX3C AgendA. You can also drag a widget into EX3C AgendA while editing." });
    const actions = root.createDiv({ cls: "life-os-palette-actions" });
    const edit = actions.createEl("button", { text: plugin.editing ? "Done editing" : "Edit layout", cls: plugin.editing ? "mod-cta" : "" });
    edit.type = "button";
    this.registerDomEvent(edit, "click", () => void plugin.setEditing(!plugin.editing));
    const config = actions.createEl("button", { text: "Questions, habits, folders" });
    config.type = "button";
    config.setAttribute("title", "Open Meta/EX3C Agenda Config.md");
    this.registerDomEvent(config, "click", () => void this.app.workspace.openLinkText("Meta/EX3C Agenda Config", "", true));
    const search = root.createEl("input", { cls: "life-os-palette-search", attr: { type: "search", placeholder: "Find a widget…", value: this.query } });
    this.registerDomEvent(search, "input", () => { this.query = search.value; this.render(); });
    if (hadFocus) window.setTimeout(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }, 0);
    makeDropTarget(this, plugin, root, (drag) => void plugin.removeWidget(drag.id, drag.fromTab));

    const where = new Map();
    for (const tab of plugin.layout.tabs) for (const id of tab.widgets) where.set(id, [...(where.get(id) || []), tab]);
    const q = this.query.trim().toLowerCase();
    const matches = WIDGETS.filter((w) => plugin.widgetShown(w.id)).filter((w) => !q || `${w.label} ${w.desc} ${w.from}`.toLowerCase().includes(q));
    const home = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (home instanceof LifeOSHomeView) {
      const allOpen = matches.length > 0 && matches.every((w) => this.previewing.has(w.id));
      const all = actions.createEl("button", { text: allOpen ? "Hide all previews" : "Show all previews" });
      all.type = "button";
      this.registerDomEvent(all, "click", () => { this.previewing = allOpen ? new Set() : new Set(matches.map((w) => w.id)); this.render(); });
    }
    if (!matches.length) root.createDiv({ cls: "life-os-palette-empty", text: "No widget matches." });
    // grouped by what the widget is for; each widget is listed once, with the tabs it is on
    for (const wf of WORKFLOWS) {
      const list = matches.filter((w) => workflowOf(w.id) === wf.id);
      if (!list.length) continue;
      root.createEl("h4", { text: wf.label });
      for (const widget of list) {
        const onTabs = where.get(widget.id) || [];
        const item = root.createDiv({ cls: `life-os-palette-item${onTabs.length ? " is-placed" : ""}` });
        const head = item.createDiv({ cls: "life-os-palette-item-head" });
        const grip = head.createSpan({ cls: "life-os-slot-handle" });
        setIcon(grip, "grip-vertical");
        head.createEl("strong", { text: widget.label });
        if (home instanceof LifeOSHomeView) {
          const open = this.previewing.has(widget.id);
          const pv = head.createEl("button", { cls: `clickable-icon life-os-palette-eye${open ? " is-active" : ""}`, attr: { "aria-label": open ? "Hide preview" : "Preview", title: open ? "Hide preview" : "Preview with your own notes" } });
          pv.type = "button";
          setIcon(pv, open ? "eye-off" : "eye");
          this.registerDomEvent(pv, "click", (event) => { event.stopPropagation(); if (open) this.previewing.delete(widget.id); else this.previewing.add(widget.id); this.render(); });
        }
        item.createDiv({ cls: "life-os-palette-desc", text: widget.desc });
        item.createDiv({ cls: "life-os-palette-meta", text: onTabs.length ? `On ${onTabs.map((t) => t.label).join(", ")}` : "Not on a tab" });
        if (this.previewing.has(widget.id) && home instanceof LifeOSHomeView) {
          // a live, read-only preview drawn from your own notes, scaled down
          const frame = item.createDiv({ cls: "life-os-palette-preview", attr: { inert: "", "aria-hidden": "true" } });
          const inner = frame.createDiv({ cls: "life-os-palette-preview-inner life-os-home" });
          try { home.renderWidget(widget.id, inner); } catch (error) { inner.setText(`No preview: ${error.message}`); }
        }
        makeDraggable(this, plugin, item, { kind: "widget", id: widget.id });
        if (current && !onTabs.includes(current)) {
          const add = item.createEl("button", { text: `Add to ${current.label}` });
          add.type = "button";
          this.registerDomEvent(add, "click", () => void plugin.moveWidget(widget.id, current.id));
        }
      }
    }
  }
}


// ---------- parent roll-up ----------
const ROLLUP_TASK_RE = /^(\s*[-*+] \[)(.)(\] )/;
const rollupKey = (line) => line.replace(ROLLUP_TASK_RE, "").replace(/\s*(✅|❌) \d{4}-\d{2}-\d{2}/gu, "").trim();
const isDoneChar = (c) => c === "x" || c === "X" || c === "-";
// Runs widget code the way Dataview's dv.view runs a view file (the code gets dv and input), but waits for it,
// so an error shows in the widget instead of disappearing.
async function runViewSource(src, dv, input, name) {
  const body = `${src.includes("await") ? `return (async () => { ${src}\n})();` : src}\n//# sourceURL=ex3c-agenda/views/${name}.js`;
  try {
    // Built-in widgets run outside the plugin's module scope, where require("obsidian") fails; hand them the module.
    await new Function("dv", "input", "require", body)(dv, input, (id) => (id === "obsidian" ? OBSIDIAN : require(id)));
  } catch (error) {
    dv.container.createEl("pre", { cls: "life-os-widget-error", text: `EX3C AgendA: the ${name} widget failed.\n\n${error}` });
  }
}

// What Meta/views/<name>.js holds while a widget runs the built-in code (the same text as bundle-views.mjs --stubs).
function widgetStub(name) {
  if (name === "setup-checks") {
    return `// ${STUB_MARK}\n// The setup checks are built into the EX3C AgendA plugin and update with it (the Setup note and the Home banner use them).\n// To change them, run the command "EX3C AgendA: Edit widget code" and pick setup-checks; your copy then replaces this file.\n`;
  }
  return `// ${STUB_MARK}\n// The "${name}" widget is built into the EX3C AgendA plugin and updates with it. Notes run it through this file.\n// To change its code, run the command "EX3C AgendA: Edit widget code" and pick ${name}; your copy then replaces this file.\nconst ex3c = dv.app.plugins.plugins["ex3c-agenda"];\nif (ex3c?.runWidget) await ex3c.runWidget(${JSON.stringify(name)}, dv, input, true);\nelse dv.paragraph("Turn on the EX3C AgendA plugin to show this widget.");\n`;
}

class WidgetPickModal extends FuzzySuggestModal {
  constructor(app, items, placeholder, onPick) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }
  getItems() { return this.items; }
  getItemText(item) { return item.label; }
  onChooseItem(item) { this.onPick(item); }
}

class RollupListModal extends Modal {
  constructor(app, title, lines, yes, onDone) { super(app); this.titleText = title; this.lines = lines; this.yes = yes; this.onDone = onDone; this.answer = false; }
  onOpen() {
    this.titleEl.setText(this.titleText);
    const ul = this.contentEl.createEl("ul", { attr: { style: "max-height:40vh;overflow:auto" } });
    for (const l of this.lines) ul.createEl("li", { text: l });
    this.contentEl.createEl("p", { text: "You can undo this from the notice afterwards.", attr: { style: "color:var(--text-muted);font-size:12px" } });
    const row = this.contentEl.createDiv({ attr: { style: "display:flex;gap:8px;justify-content:flex-end" } });
    const no = row.createEl("button", { text: "No, only the parent" }); const yes = row.createEl("button", { text: this.yes, cls: "mod-cta" });
    no.addEventListener("click", () => this.close()); yes.addEventListener("click", () => { this.answer = true; this.close(); });
  }
  onClose() { this.contentEl.empty(); this.onDone(this.answer); }
}
// ---------- task fields in the Tasks plugin's edit dialog ----------
// "Tasks: Create or edit task" (and Edit task in the planner) sets a task's dates, priority and repeat. The fields
// EX3C AgendA reads ([est:: 1h], [price:: 12] and the rest) are part of the task's description, so this section edits
// them in the dialog's description box: Apply writes them with everything else, Cancel leaves the task as it was.
const TASK_FIELDS = [
  { key: "est", label: "Length", placeholder: "30m, 1h 30m", title: "How long it takes: 30m, 1h 30m, 1.5h, or minutes. The planner plans with it." },
  { key: "commute", label: "Commute", placeholder: "20m", title: "Travel before and after it, drawn around it on the planner's hours" },
  { key: "price", label: "Price", placeholder: "12.50", title: "Price of one; the purchases list adds up price × quantity", mode: "decimal" },
  { key: "qty", label: "Quantity", placeholder: "3", title: "How many", mode: "numeric" },
  { key: "shop", label: "Shop", placeholder: "Ikea", title: "Where to buy it; the purchases list groups by shop" },
  { key: "link", label: "Link", placeholder: "https://", title: "Web page of the item", mode: "url" },
];
const descFields = (desc) => { const f = {}; for (const m of String(desc).matchAll(/\[([\w-]+)::\s*([^\]]*)\]/g)) f[m[1]] = m[2].trim(); return f; };
function setDescField(desc, key, value) {
  const v = String(value ?? "").trim(), re = new RegExp(`\\s*\\[${key}::[^\\]]*\\]`);
  if (!v) return desc.replace(re, "").trim();
  return re.test(desc) ? desc.replace(re, ` [${key}:: ${v}]`).trim() : `${desc.trimEnd()} [${key}:: ${v}]`.trim();
}
const fieldMinutes = (s) => { const v = String(s ?? "").trim().toLowerCase().replace(",", "."); if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith("h") ? 60 : 1); } return hit ? m : null; };
const fieldDuration = (min) => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m"; };
// The value as it is written: prices and quantities with a decimal point and no currency sign (also while you type,
// so Enter can apply at any moment); lengths become "1h 30m" once you leave the box.
function fieldValue(key, raw, done) {
  let v = String(raw ?? "").trim();
  if ((key === "price" || key === "qty") && v) v = v.replace(/^[€$£]\s*|\s*(€|eur|euros?)$/i, "").replace(",", ".");
  if (done && (key === "est" || key === "commute") && v) { const m = fieldMinutes(v); if (m !== null) v = fieldDuration(m); }
  return v;
}

function addTaskFields(form) {
  if (form.dataset.ex3cFields) return;
  const desc = form.querySelector("textarea#description, textarea.tasks-modal-description");
  if (!desc) return;
  form.dataset.ex3cFields = "1";
  const doc = form.ownerDocument;
  let writing = false;
  // change the description the way typing in it would, so the dialog takes the new text
  const write = (fn) => {
    const next = fn(desc.value);
    if (next === desc.value) return;
    writing = true; desc.value = next; desc.dispatchEvent(new Event("input", { bubbles: true })); writing = false;
  };
  const sec = doc.createElement("section");
  sec.className = "ex3c-task-fields";
  const head = sec.createDiv({ cls: "ex3c-tf-head" });
  head.createSpan({ text: "Fields" });
  head.createSpan({ cls: "ex3c-tf-note", text: "written in the description as [name:: value]" });
  const grid = sec.createDiv({ cls: "ex3c-tf-grid" });
  const inputs = {};
  const row = (key, label, { placeholder = "", title = "", mode = "" } = {}) => {
    const id = `ex3c-field-${key}`, cell = grid.createDiv({ cls: "ex3c-tf-field" });
    const lab = cell.createEl("label", { text: label, attr: { for: id } });
    const input = cell.createEl("input", { type: "text", attr: { id, placeholder, spellcheck: "false", autocomplete: "off", ...(mode ? { inputmode: mode } : {}) } });
    if (title) { lab.title = title; input.title = title; }
    input.value = descFields(desc.value)[key] ?? "";
    input.addEventListener("input", () => write((d) => setDescField(d, key, fieldValue(key, input.value, false))));
    input.addEventListener("change", () => { const v = fieldValue(key, input.value, true); input.value = v; write((d) => setDescField(d, key, v)); });
    inputs[key] = input;
  };
  for (const f of TASK_FIELDS) row(f.key, f.label, f);
  // [mode:: parallel] on a task with indented steps: its steps can be done in any order
  const mcell = grid.createDiv({ cls: "ex3c-tf-field" });
  const ml = mcell.createEl("label", { text: "Sub-steps", attr: { for: "ex3c-field-mode", title: "The steps indented under this task: one after the other (top to bottom), or in any order ([mode:: parallel])" } });
  const mode = mcell.createEl("select", { cls: "dropdown", attr: { id: "ex3c-field-mode", title: ml.title } });
  mode.createEl("option", { text: "In order", attr: { value: "" } });
  mode.createEl("option", { text: "Any order", attr: { value: "parallel" } });
  const showMode = () => { const v = descFields(desc.value).mode ?? ""; if (v && ![...mode.options].some((o) => o.value === v)) mode.createEl("option", { text: v, attr: { value: v } }); mode.value = v; };
  showMode();
  mode.addEventListener("change", () => write((d) => setDescField(d, "mode", mode.value)));
  // your own fields: any other [name:: value] in the description, and a row to add one
  const own = () => { for (const k of Object.keys(descFields(desc.value))) if (!inputs[k] && k !== "mode") row(k, k); };
  own();
  const add = sec.createDiv({ cls: "ex3c-tf-add" });
  const nk = add.createEl("input", { type: "text", attr: { placeholder: "Your own field, e.g. colour", spellcheck: "false", autocomplete: "off", "aria-label": "Name of the new field" } });
  const nv = add.createEl("input", { type: "text", attr: { placeholder: "value", autocomplete: "off", "aria-label": "Its value" } });
  const nb = add.createEl("button", { text: "Add", attr: { type: "button" } });
  const addField = () => {
    const k = nk.value.trim().toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!k) { nk.focus(); return; }
    if (inputs[k] || k === "mode") { new Notice(`${k} is already in the form.`); inputs[k]?.focus(); return; }
    if (!nv.value.trim()) { nv.focus(); return; }
    write((d) => setDescField(d, k, nv.value));
    nk.value = ""; nv.value = ""; own(); nk.focus();
  };
  nb.addEventListener("click", addField);
  for (const i of [nk, nv]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addField(); } });
  // typing a field into the description by hand shows up here too
  desc.addEventListener("input", () => {
    if (writing) return;
    const f = descFields(desc.value);
    for (const [k, input] of Object.entries(inputs)) if (doc.activeElement !== input) input.value = f[k] ?? "";
    showMode(); own();
  });
  const after = form.querySelector("#line-after-happens-dates");
  const buttons = form.querySelector(".tasks-modal-button-section");
  if (after) { after.after(sec); sec.after(doc.createElement("hr")); }
  else if (buttons) buttons.before(sec);
  else form.append(sec);
}

module.exports = class LifeOSPlugin extends Plugin {
  async onload() {
    this.editing = false;
    this.drag = null;
    this.savingLayout = false;
    this.layout = normalizeLayout(null);
    this.widgetCatalog = WIDGETS; // read by the Guide's EX3C AgendA UI map
    this.registerView("life-os-brain", (leaf) => new LifeOSBrainView(leaf));
    this.registerView(PALETTE_VIEW, (leaf) => new LifeOSWidgetPaletteView(leaf, this));
    this.registerView(
      VIEW_TYPE,
      (leaf) => new LifeOSHomeView(leaf, this)
    );

    this.addRibbonIcon("calendar-check-2", "Open EX3C AgendA", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-home",
      name: "Open EX3C AgendA home",
      callback: () => this.activateView("home"),
    });

    this.addCommand({
      id: "open-capture",
      name: "Open EX3C AgendA capture",
      callback: () => this.openCapture(),
    });

    this.addCommand({
      id: "open-configuration",
      name: "Open EX3C Agenda Config (questions, habits, folders)",
      callback: () => this.app.workspace.openLinkText("Meta/EX3C Agenda Config", "", true),
    });

    this.addCommand({
      id: "edit-layout",
      name: "Edit EX3C AgendA layout",
      callback: () => this.setEditing(!this.editing),
    });

    this.addCommand({
      id: "rebuild-workflow-map",
      name: "Redraw the workflow map canvas",
      callback: async () => { if (await this.rebuildWorkflowCanvas(true)) new Notice("Workflow map redrawn."); },
    });

    this.addCommand({
      id: "open-widgets",
      name: "Open EX3C AgendA widgets panel",
      callback: () => this.openPalette(),
    });

    this.addCommand({
      id: "edit-widget-code",
      name: "Edit widget code",
      callback: () => void this.pickWidgetToEdit(),
    });

    this.addCommand({
      id: "reset-widget-code",
      name: "Reset widget to built-in",
      callback: () => void this.pickWidgetToReset(),
    });

    // The Tasks plugin's edit dialog (Tasks: Create or edit task, and Edit task in the widgets) gets a Fields
    // section for length, price, shop and the other [name:: value] fields: see addTaskFields.
    const watchTaskDialogs = (doc) => {
      const check = () => { for (const form of doc.querySelectorAll("form.tasks-modal:not([data-ex3c-fields])")) addTaskFields(form); };
      const observer = new MutationObserver(() => { check(); doc.defaultView?.setTimeout(check, 0); });
      observer.observe(doc.body, { childList: true });
      this.register(() => observer.disconnect());
    };
    watchTaskDialogs(document);
    this.registerEvent(this.app.workspace.on("window-open", (win) => watchTaskDialogs(win.doc)));

    // Other plugins (Day Planner, Periodic Notes links) can create a journal note by
    // copying the template text without running Templater; run it once on such notes.
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.app.workspace.layoutReady && file instanceof TFile && file.extension === "md" && file.path.startsWith("01 Journal/")) {
        window.setTimeout(() => void this.renderRawTemplate(file), 600);
      }
    }));

    const widgetFolderChanged = (file, oldPath = "") => {
      if (![file.path, oldPath].some((p) => (p.startsWith(`${USER_WIDGET_DIR}/`) || p.startsWith(`${VIEW_DIR}/`)) && p.endsWith(".js"))) return;
      window.clearTimeout(this.userWidgetTimer);
      this.userWidgetTimer = window.setTimeout(() => void this.loadLayout().then(() => this.refreshViews()), 400);
    };
    for (const kind of ["create", "delete", "rename", "modify"]) this.registerEvent(this.app.vault.on(kind, widgetFolderChanged));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file.path === LAYOUT_PATH && !this.savingLayout) void this.loadLayout().then(() => this.refreshViews());
    }));

    // one command per page, offered only while that page is in your layout (ids stay the same as before)
    const PAGE_COMMANDS = [["today", "Check-in"], ["projects", "Projects"], ["work", "Work"], ["study", "Study"], ["personal", "Personal"], ["people", "People"], ["library", "Library"], ["review", "Review"]];
    for (const [id, label] of PAGE_COMMANDS) {
      this.addCommand({
        id: `open-${id}`,
        name: `Open EX3C AgendA ${label}`,
        checkCallback: (checking) => {
          if (!this.layout?.tabs?.some((t) => t.id === id && this.tabShown(t))) return false;
          if (!checking) void this.activateView(id);
          return true;
        },
      });
    }
    this.addCommand({ id: "open-brain", name: "Open EX3C AgendA Brain", callback: () => void this.app.workspace.getLeaf("tab").setViewState({ type: "life-os-brain", active: true }) });

    // Optional modules: while the AI module is removed (no Prompts/ and no Assistant dashboard),
    // every AI entry point hides: app buttons and widgets, the AI page, and prompt buttons in notes.
    const moduleChanged = (file, oldPath = "") => {
      if (![file.path, oldPath].some((p) => Object.values(MAP_MODULE_PATHS).flat().some((m) => p === m || p.startsWith(`${m}/`)))) return;
      window.clearTimeout(this.moduleTimer);
      this.moduleTimer = window.setTimeout(() => this.syncModuleState(), 300);
    };
    for (const kind of ["create", "delete", "rename"]) this.registerEvent(this.app.vault.on(kind, moduleChanged));
    this.register(() => document.body.removeClass("ex3c-ai-off"));
    const accentSoon = () => { window.clearTimeout(this.accentTimer); this.accentTimer = window.setTimeout(() => this.applyAccent(), 50); };
    this.registerEvent(this.app.workspace.on("active-leaf-change", accentSoon));
    this.registerEvent(this.app.workspace.on("file-open", accentSoon));
    this.registerEvent(this.app.metadataCache.on("changed", (file) => { if (this.app.workspace.getLeavesOfType("markdown").some((l) => l.view?.file === file)) accentSoon(); }));
    this.registerEvent(this.app.workspace.on("layout-change", accentSoon));
    this.register(() => { for (const k of ["--accent-h", "--accent-s", "--accent-l"]) document.body.style.removeProperty(k); });

    this.app.workspace.onLayoutReady(async () => {
      try {
        await this.loadLayout();
      } catch (error) {
        console.error("EX3C AgendA could not load its layout; using the default tabs.", error);
      }
      this.loadAreas();
      this.syncModuleState(false);
      this.applyAccent();
      void this.activateView();
      // calendar links (Import calendars): refresh the ones older than six hours, quietly, a little after start-up
      window.setTimeout(() => void this.refreshCalendars(false), 15000);
      // the Work schedule as dated lines in 10 Areas/Work/Work schedule.md (for Day Planner): now, after every
      // change to the Ideal Week, and when the date changes while Obsidian stays open
      window.setTimeout(() => void this.syncWorkNote(), 5000);
    });
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file?.path !== "03 Planning/Ideal Week.md") return;
      window.clearTimeout(this.workNoteTimer);
      this.workNoteTimer = window.setTimeout(() => void this.syncWorkNote(), 1500);
    }));
    this.registerInterval(window.setInterval(() => { if (this.workNoteDay !== moment().format("YYYY-MM-DD")) void this.syncWorkNote(); }, 60 * 60 * 1000));
    this.addCommand({ id: "refresh-calendars", name: "Refresh calendar links", callback: () => void this.refreshCalendars(true) });
    // the area list follows the area notes: a new note, a changed colour or switch, a rename or a delete
    const areasSoon = (file, oldPath) => {
      const known = (p) => p && this.areaList?.some((a) => a.path === p);
      const isArea = file?.extension === "md" && String(this.app.metadataCache.getFileCache(file)?.frontmatter?.type ?? "").toLowerCase() === "area";
      if (!isArea && !known(file?.path) && !known(oldPath)) return;
      window.clearTimeout(this.areaTimer);
      this.areaTimer = window.setTimeout(() => { if (this.loadAreas()) { this.refreshViews(); this.applyAccent(); } }, 300);
    };
    this.registerEvent(this.app.metadataCache.on("changed", (file) => areasSoon(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => areasSoon(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => areasSoon(file, oldPath)));
    this.registerEvent(this.app.metadataCache.on("resolved", () => { if (!this.areasResolved) { this.areasResolved = true; if (this.loadAreas()) this.refreshViews(); } }));
    this.setupRollup();
  }

  // Colour per pane: Obsidian's accent stays the Theme colour; a note with area: work/study/personal gets that area's
  // colour in its own pane only (the app sets its page colour inside its own view), so tabs side by side never mix.
  accentFor(leaf) {
    const theme = this.layout.theme || normalizeTheme(null);
    const file = leaf?.view?.file;
    const area = file ? String(this.app.metadataCache.getFileCache(file)?.frontmatter?.area ?? "").toLowerCase() : "";
    return AREAS.includes(area) ? themeAccent(theme, area) : null;
  }

  applyAccent() {
    const theme = this.layout.theme || normalizeTheme(null);
    const hsl = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, dlt = max - min;
      const s = dlt ? dlt / (1 - Math.abs(2 * l - 1)) : 0;
      const h = !dlt ? 0 : max === r ? 60 * (((g - b) / dlt) % 6) : max === g ? 60 * ((b - r) / dlt + 2) : 60 * ((r - g) / dlt + 4);
      return [Math.round((h + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
    };
    const base = themeAccent(theme, null);
    if (HEX.test(base)) {
      const [h, s, l] = hsl(base), st = document.body.style;
      st.setProperty("--accent-h", String(h)); st.setProperty("--accent-s", `${s}%`); st.setProperty("--accent-l", `${l}%`);
    }
    const VARS = ["--accent-h", "--accent-s", "--accent-l", "--color-accent", "--color-accent-1", "--color-accent-2", "--interactive-accent", "--interactive-accent-hover", "--text-accent", "--text-accent-hover", "--text-on-accent"];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const el = leaf.view?.containerEl, hex = this.accentFor(leaf);
      if (!el) continue;
      if (!hex || !HEX.test(hex)) { for (const v of VARS) el.style.removeProperty(v); continue; }
      const [h, s, l] = hsl(hex);
      el.style.setProperty("--accent-h", String(h)); el.style.setProperty("--accent-s", `${s}%`); el.style.setProperty("--accent-l", `${l}%`);
      el.style.setProperty("--color-accent", hex);
      el.style.setProperty("--color-accent-1", `hsl(${h}, ${s}%, ${Math.min(95, l + 4)}%)`);
      el.style.setProperty("--color-accent-2", `hsl(${h}, ${s}%, ${Math.min(95, l + 8)}%)`);
      el.style.setProperty("--interactive-accent", hex);
      el.style.setProperty("--interactive-accent-hover", `hsl(${h}, ${s}%, ${Math.min(95, l + 6)}%)`);
      el.style.setProperty("--text-accent", `hsl(${h}, ${s}%, ${Math.min(90, l + 10)}%)`);
      el.style.setProperty("--text-accent-hover", `hsl(${h}, ${s}%, ${Math.min(95, l + 16)}%)`);
      el.style.setProperty("--text-on-accent", textOn(hex));
    }
  }

  // ---------- parent roll-up ----------
  rollupOn() {
    const f = this.app.vault.getAbstractFileByPath("Meta/EX3C Agenda Config.md");
    return (f && this.app.metadataCache.getFileCache(f)?.frontmatter?.rollup_parents) !== false;
  }
  async setupRollup() {
    this.taskSnap = new Map();
    this.autoTicked = new Set(); // this session only: everything lasting is read from the notes (✅ dates)
    this.registerEvent(this.app.metadataCache.on("changed", (file, data, cache) => { void this.onTasksChanged(file, data, cache); }));
    // what every note's tasks look like now, so a change can be compared with it
    window.setTimeout(async () => {
      for (const file of this.app.vault.getMarkdownFiles()) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.listItems?.some((i) => i.task !== undefined) || this.taskSnap.has(file.path)) continue;
        try { this.taskSnap.set(file.path, this.taskTree(await this.app.vault.cachedRead(file), cache)); } catch (error) { /* skip */ }
      }
    }, 8000);
  }
  saveRollup() { /* nothing is stored outside the notes */ }
  // tasks of one note as a tree: line, status, key, parent and children (by line)
  taskTree(data, cache) {
    const lines = data.split("\n"), items = new Map();
    for (const li of cache?.listItems || []) {
      if (li.task === undefined) continue;
      const line = li.position.start.line, text = lines[line] ?? "";
      if (!ROLLUP_TASK_RE.test(text)) continue;
      items.set(line, { line, status: text.match(ROLLUP_TASK_RE)[2], key: rollupKey(text), text, parent: li.parent >= 0 ? li.parent : null, kids: [], recur: /🔁/u.test(text) });
    }
    for (const it of items.values()) if (it.parent !== null && items.has(it.parent)) items.get(it.parent).kids.push(it.line);
    return items;
  }
  async onTasksChanged(file, data, cache) {
    if (!(file instanceof TFile) || !cache?.listItems) return;
    const now = this.taskTree(data, cache), prev = this.taskSnap.get(file.path);
    this.taskSnap.set(file.path, now);
    if (!prev || !this.rollupOn()) return;
    const was = new Map([...prev.values()].map((it) => [it.key, it.status]));
    const changed = [...now.values()].filter((it) => was.has(it.key) && isDoneChar(was.get(it.key)) !== isDoneChar(it.status));
    if (!changed.length) return;
    const leaves = (it) => (it.kids.length ? it.kids.flatMap((k) => leaves(now.get(k))) : [it]).filter((x) => x && !x.recur);
    const ancestors = (it) => { const out = []; for (let p = it.parent; p !== null && now.has(p); p = now.get(p).parent) out.push(now.get(p)); return out; };
    const id = (it) => `${file.path}::${it.key}`;
    const tick = [], reopen = [], askFor = [];
    for (const it of changed) {
      if (isDoneChar(it.status)) {
        // upward: the parent whose steps are now all done
        for (const p of ancestors(it)) { if (isDoneChar(p.status) || p.recur) break; const ls = leaves(p); if (ls.length && ls.every((l) => isDoneChar(l.status) || l === it)) { if (!tick.includes(p)) tick.push(p); } else break; }
        // downward: a parent ticked while steps under it are still open
        const open = it.kids.length ? leaves(it).filter((l) => !isDoneChar(l.status)) : [];
        if (open.length && !this.autoTicked.has(id(it))) askFor.push({ parent: it, open });
      } else {
        // reopen a parent that was ticked along with its last step: its ✅ is the same day as that step's (read from the note)
        const doneOn = (x) => (x.text.match(/✅ (\d{4}-\d{2}-\d{2})/u) || [])[1] || null;
        for (const p of ancestors(it)) { if (!isDoneChar(p.status) || reopen.includes(p)) continue; const ls = leaves(p).filter((l) => l !== it && doneOn(l)); const last = ls.map(doneOn).sort().pop(); if (this.autoTicked.has(id(p)) || (doneOn(p) && last && doneOn(p) === last)) reopen.push(p); }
      }
    }
    if (tick.length || reopen.length) await this.rollupWrite(file, tick, reopen);
    for (const a of askFor) {
      const lines = a.open.map((l) => l.key.replace(/\s+[📅⏳🛫➕].*$/u, ""));
      new RollupListModal(this.app, `Also tick ${a.open.length} step${a.open.length === 1 ? "" : "s"} under "${a.parent.key.replace(/\s+[📅⏳🛫➕].*$/u, "")}"?`, lines, `Tick ${a.open.length}`, (yes) => { if (yes) void this.rollupWrite(file, a.open, [], true); }).open();
    }
  }
  // ticks (with the Tasks plugin, so ✅ is written) or reopens task lines, then offers Undo
  async rollupWrite(file, tick, reopen, asked = false) {
    const tasksApi = this.app.plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
    const changes = [];
    await this.app.vault.process(file, (data) => {
      const L = data.split("\n");
      const find = (it) => { if (L[it.line] !== undefined && rollupKey(L[it.line]) === it.key) return it.line; return L.findIndex((l) => ROLLUP_TASK_RE.test(l) && rollupKey(l) === it.key); };
      for (const it of tick) {
        const i = find(it); if (i < 0 || isDoneChar(L[i].match(ROLLUP_TASK_RE)[2])) continue;
        let next = tasksApi?.executeToggleTaskDoneCommand ? tasksApi.executeToggleTaskDoneCommand(L[i], file.path) : `${L[i].replace(ROLLUP_TASK_RE, "$1x$3")} ✅ ${moment().format("YYYY-MM-DD")}`;
        if (next.includes("\n")) next = next.split("\n").pop(); // never adds a repeat (repeating parents are skipped anyway)
        changes.push({ before: L[i], after: next, key: it.key, kind: "tick" }); L[i] = next;
      }
      for (const it of reopen) {
        const i = find(it); if (i < 0) continue;
        const next = L[i].replace(ROLLUP_TASK_RE, "$1 $3").replace(/\s*✅ \d{4}-\d{2}-\d{2}/u, "");
        changes.push({ before: L[i], after: next, key: it.key, kind: "reopen" }); L[i] = next;
      }
      return L.join("\n");
    });
    if (!changes.length) return;
    for (const c of changes) { const k = `${file.path}::${c.key}`; if (c.kind === "tick" && !asked) this.autoTicked.add(k); else this.autoTicked.delete(k); }
    void this.saveRollup();
    const name = (c) => c.key.replace(/\s+[📅⏳🛫➕\[].*$/u, "");
    const msg = asked ? `Ticked ${changes.length} step${changes.length === 1 ? "" : "s"}.` : changes.map((c) => (c.kind === "tick" ? `${name(c)}: all its steps are done, so it is ticked too.` : `${name(c)} is open again: one of its steps is not done.`)).join(" ");
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(`${msg} `));
    const undo = document.createElement("a"); undo.textContent = "Undo"; undo.style.cursor = "pointer"; frag.appendChild(undo);
    const notice = new Notice(frag, 10000);
    undo.addEventListener("click", async () => {
      notice.hide();
      await this.app.vault.process(file, (data) => { const L = data.split("\n"); for (const c of changes) { const i = L.indexOf(c.after); if (i >= 0) L[i] = c.before; } return L.join("\n"); });
      for (const c of changes) this.autoTicked.delete(`${file.path}::${c.key}`);
      void this.saveRollup();
    });
  }

  // Text from a web address (a calendar link). Obsidian's requestUrl is not bound by the browser's CORS rules.
  async fetchText(url) {
    const res = await requestUrl({ url: String(url).replace(/^webcal:/i, "https:"), method: "GET" });
    return res.text;
  }

  // Runs the Import calendars view without showing it, so its links are refreshed (all of them when forced).
  async refreshCalendars(force) {
    const api = this.app.plugins?.plugins?.dataview?.api;
    if (!api?.executeJs) return;
    const host = document.createElement("div"), component = new Component();
    component.load();
    try { await api.executeJs(`await dv.app.plugins.plugins[${JSON.stringify(this.manifest.id)}].runWidget("calendars", dv, { refresh: ${force ? "\"all\"" : "\"stale\""} })`, host, component, LAYOUT_PATH); }
    catch (error) { console.warn("EX3C AgendA: calendar refresh", error); }
    finally { window.setTimeout(() => component.unload(), 60000); }
  }

  async syncWorkNote() {
    const api = this.app.plugins?.plugins?.dataview?.api;
    if (!api?.executeJs) return;
    this.workNoteDay = moment().format("YYYY-MM-DD");
    const host = document.createElement("div"), component = new Component();
    component.load();
    try { await api.executeJs(`await dv.app.plugins.plugins[${JSON.stringify(this.manifest.id)}].runWidget("worknote", dv)`, host, component, LAYOUT_PATH); }
    catch (error) { console.warn("EX3C AgendA: work schedule note", error); }
    finally { window.setTimeout(() => component.unload(), 10000); }
  }

  // ---------- built-in widgets ----------
  // Your own copy of a built-in widget (Meta/views/<name>.js that is not a stub), else null.
  async vaultWidgetCode(name) {
    const file = this.app.vault.getFileByPath(normalizePath(`${VIEW_DIR}/${name}.js`));
    if (!file) return null;
    const text = await this.app.vault.cachedRead(file);
    return text.includes(STUB_MARK) ? null : text;
  }

  // The code a widget runs: your copy if there is one, else the built-in code.
  async widgetCode(name) {
    return (await this.vaultWidgetCode(name)) ?? BUILTIN_VIEWS[name] ?? null;
  }

  // Draws a widget into dv.container. Stubs pass fromStub, because they are only there when there is no copy.
  // A menu for widgets, which cannot always load the obsidian module themselves: at the pointer, or as a sheet
  // on a phone. items: { title, icon, run } each, "-" for a line between them.
  showMenu(evt, items) {
    const menu = new Menu();
    for (const it of items) {
      if (it === "-") menu.addSeparator();
      else if (it) menu.addItem((i) => i.setTitle(it.title).setIcon(it.icon ?? null).onClick(() => void it.run()));
    }
    if (evt && (evt.clientX || evt.clientY)) menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
    else menu.showAtMouseEvent(evt);
    return menu;
  }

  async runWidget(name, dv, input, fromStub = false) {
    if (!fromStub && (await this.vaultWidgetCode(name)) !== null) return dv.view(`${VIEW_DIR}/${name}`, input);
    if (!(name in BUILTIN_VIEWS)) {
      dv.paragraph(`EX3C AgendA has no built-in widget called "${name}".`);
      return;
    }
    return runViewSource(BUILTIN_VIEWS[name], dv, input, name);
  }

  async writeVaultFile(path, text) {
    const file = this.app.vault.getFileByPath(path);
    if (file) return this.app.vault.modify(file, text);
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder && !this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
    return this.app.vault.create(path, text);
  }

  async pickWidgetToEdit() {
    const items = [];
    for (const name of Object.keys(BUILTIN_VIEWS)) {
      const own = (await this.vaultWidgetCode(name)) !== null;
      items.push({ name, label: `${WIDGET_LABELS[name] ?? name} (${name}.js)${own ? ", your copy" : ""}` });
    }
    new WidgetPickModal(this.app, items, "Widget whose code you want to edit", (item) => void this.copyWidgetToVault(item.name)).open();
  }

  // Puts the full built-in code in Meta/views/<name>.js (unless you already have a copy) and opens it.
  async copyWidgetToVault(name) {
    const path = normalizePath(`${VIEW_DIR}/${name}.js`);
    if ((await this.vaultWidgetCode(name)) === null) {
      const header = `// Your copy of the EX3C AgendA "${name}" widget, taken from plugin version ${this.manifest.version} on ${moment().format("DD-MM-YYYY")}.\n`
        + `// It runs instead of the built-in code, so plugin updates no longer change this widget.\n`
        + `// To go back to the built-in code, run the command "EX3C AgendA: Reset widget to built-in".\n`;
      await this.writeVaultFile(path, header + BUILTIN_VIEWS[name]);
    }
    new Notice(`${path} is your copy of the ${name} widget. Edit it in a code editor; the app redraws when you save.`, 10000);
    if (Platform.isDesktopApp) this.app.openWithDefaultApp?.(path);
  }

  async pickWidgetToReset() {
    const items = [];
    for (const name of Object.keys(BUILTIN_VIEWS)) if ((await this.vaultWidgetCode(name)) !== null) items.push({ name, label: `${WIDGET_LABELS[name] ?? name} (${name}.js)` });
    if (!items.length) {
      new Notice("Every widget already runs the built-in code.");
      return;
    }
    new WidgetPickModal(this.app, items, "Widget to put back to the built-in code", (item) => void this.resetWidget(item.name)).open();
  }

  // Your copy goes to the trash (Obsidian's or the system's, as set in Files and links); the stub takes its place.
  async resetWidget(name) {
    const path = normalizePath(`${VIEW_DIR}/${name}.js`);
    const file = this.app.vault.getFileByPath(path);
    if (file) await this.app.fileManager.trashFile(file);
    await this.writeVaultFile(path, widgetStub(name));
    const trash = this.app.vault.getConfig?.("trashOption");
    const where = !file ? "" : trash === "local" ? " Your copy is in the vault's .trash folder." : trash === "none" ? " Your copy was deleted (Files and links › Deleted files is set to delete permanently)." : " Your copy is in the system trash.";
    new Notice(`The ${WIDGET_LABELS[name] ?? name} widget runs the built-in code again.${where}`, 8000);
  }

  aiOn() {
    return AI_MODULE_PATHS.some((p) => this.app.vault.getAbstractFileByPath(p));
  }

  modulesOff() {
    return Object.entries(MAP_MODULE_PATHS).filter(([, ps]) => !ps.some((p) => this.app.vault.getAbstractFileByPath(p))).map(([m]) => m).sort();
  }

  // Rebuild the workflow canvas from Guide/views/workflow-map.js with the layout in Guide/views/workflow-canvas.js,
  // only when the set of removed modules changed since the app started (so hand-made moves survive otherwise).
  async rebuildWorkflowCanvas(force = false) {
    const off = this.modulesOff(), key = off.join(",");
    if (!force && (this.canvasModules === undefined || this.canvasModules === key)) { this.canvasModules = key; return false; }
    this.canvasModules = key;
    try {
      const ad = this.app.vault.adapter;
      const src = await ad.read("Guide/views/workflow-map.js"), lib = await ad.read("Guide/views/workflow-canvas.js");
      const data = src.slice(src.indexOf("// ---------- data ----------"), src.indexOf("// ---------- index ----------"));
      const map = new Function(`${data}; return { PHASES, ROWS, STATUS, STEPS, LINKS };`)();
      const build = new Function(`${lib}; return buildWorkflowCanvas;`)();
      const text = JSON.stringify(build(map, new Set(off)), null, "\t");
      const file = this.app.vault.getAbstractFileByPath(WORKFLOW_CANVAS);
      if (file instanceof TFile) { if ((await this.app.vault.read(file)) !== text) await this.app.vault.modify(file, text); }
      else await this.app.vault.create(WORKFLOW_CANVAS, text);
      return true;
    } catch (error) {
      console.warn("EX3C AgendA: could not redraw the workflow canvas", error);
      return false;
    }
  }

  // ```agent blocks are Agent Client buttons ("Kick off this project", "Help me set up"). Without the AI module they
  // would show as raw code, so this plugin draws them as nothing until Agent Client is back.
  hideAgentBlocks() {
    const hide = !this.aiOn() && !this.app.plugins.enabledPlugins.has("agent-client");
    if (hide && !this.agentBlocksHidden) {
      try { MarkdownPreviewRenderer.registerCodeBlockPostProcessor("agent", (source, el) => { el.addClass("ex3c-agent-hidden"); }); this.agentBlocksHidden = true; }
      catch (error) { console.warn("EX3C AgendA: could not hide agent blocks", error); }
    } else if (!hide && this.agentBlocksHidden) {
      try { MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor("agent"); } catch (error) { /* already gone */ }
      this.agentBlocksHidden = false;
    }
  }

  syncModuleState(refresh = true) {
    void this.rebuildWorkflowCanvas();
    this.hideAgentBlocks();
    const off = !this.aiOn();
    const was = document.body.hasClass("ex3c-ai-off");
    document.body.toggleClass("ex3c-ai-off", off);
    if (refresh && was !== off) { this.refreshViews(); this.refreshPalettes(); }
  }

  appScale() {
    const v = Number(this.app.loadLocalStorage?.("ex3c-app-scale"));
    return APP_SCALES.includes(v) ? v : 1;
  }
  setAppScale(v) {
    this.app.saveLocalStorage?.("ex3c-app-scale", String(v));
    this.refreshViews();
  }

  widgetShown(id) { return !id.startsWith("ai.") || this.aiOn(); }
  // Areas: one area note per area (type: area), normally 10 Areas/<Name>/<Name>.md. Its area property is the key
  // (the #tag and the area: value notes use), color its colour, enabled: false switches it off (its tab and colour
  // hide; no note changes). Returns true when the list changed.
  loadAreas() {
    const list = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (TASK_EXCLUDED.some((p) => file.path.startsWith(p))) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || String(fm.type ?? "").toLowerCase() !== "area") continue;
      const key = areaSlug(fm.area || file.basename);
      if (!key || list.some((a) => a.key === key)) continue;
      list.push({ key, path: file.path, note: file.basename, color: HEX.test(String(fm.color ?? "")) ? String(fm.color) : null, enabled: fm.enabled !== false && String(fm.enabled).toLowerCase() !== "false" });
    }
    if (!list.length) for (const key of DEFAULT_AREAS) list.push({ key, path: null, note: key[0].toUpperCase() + key.slice(1), color: null, enabled: true });
    // in the order of their tabs, then the rest by name
    const at = (a) => { const i = this.layout.tabs.findIndex((t) => t.area === a.key); return i < 0 ? 999 : i; };
    list.sort((a, b) => at(a) - at(b) || a.note.localeCompare(b.note));
    const theme = this.layout.theme || normalizeTheme(null);
    for (const a of list) a.color ??= theme.areas[a.key] || DEFAULT_AREA_COLORS[a.key] || THEME_PRESETS.mono;
    this.areaList = list;
    AREAS = list.filter((a) => a.enabled).map((a) => a.key);
    AREA_COLORS = Object.fromEntries(list.map((a) => [a.key, a.color]));
    AREA_TAG_RE = new RegExp(`(^|\\s)#(${AREAS.join("|") || "(?!)"})(?=\\s|$)`, "i");
    const sig = JSON.stringify(list);
    const changed = sig !== this.areaSig;
    this.areaSig = sig;
    return changed;
  }

  // for the views (planner, project steps, capture, purchases, projects board)
  areaKeys() { return [...AREAS]; }
  areaColors() { return { ...AREA_COLORS }; }
  area(key) { return this.areaList?.find((a) => a.key === key) || null; }
  areaName(key) {
    return this.layout.tabs.find((t) => t.area === key)?.label || this.area(key)?.note || (key ? key[0].toUpperCase() + key.slice(1) : "");
  }
  areaColor(key) { return AREA_COLORS[key] || DEFAULT_AREA_COLORS[key] || THEME_PRESETS.mono; }

  // the area's note, made when the vault has none for it yet (the three standard areas before their notes exist)
  async areaFile(key) {
    const a = this.area(key);
    const f = a?.path && this.app.vault.getAbstractFileByPath(a.path);
    if (f instanceof TFile) return f;
    return this.writeAreaNote(a?.note || this.areaName(key), key, AREA_COLORS[key], true);
  }

  async writeAreaNote(name, key, color, enabled) {
    const folder = `${AREA_ROOT}/${name}`;
    for (const dir of [AREA_ROOT, folder]) if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    const text = `---\ntype: area\narea: ${key}\ncolor: "${color}"\nenabled: ${enabled}\n---\nThe ${name} area: notes in this folder with \`area: ${key}\` belong here, and so does every task in them and every task tagged \`#${key}\`. The ${name} tab shows everything in the area. Colour, name and the on/off switch: Configure > Areas in EX3C AgendA, or the properties above.\n\n## Tasks\n`;
    return this.app.vault.create(`${folder}/${name}.md`, text);
  }

  async setAreaFields(key, patch) {
    const file = await this.areaFile(key);
    await this.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, patch));
    // show it now; the metadata event confirms it a moment later
    const a = this.area(key);
    if (a) { if ("color" in patch) a.color = patch.color; if ("enabled" in patch) a.enabled = patch.enabled; }
    AREAS = (this.areaList || []).filter((x) => x.enabled).map((x) => x.key);
    AREA_COLORS = Object.fromEntries((this.areaList || []).map((x) => [x.key, x.color]));
    AREA_TAG_RE = new RegExp(`(^|\\s)#(${AREAS.join("|") || "(?!)"})(?=\\s|$)`, "i");
    this.refreshViews();
    this.applyAccent();
  }

  setAreaColor(key, color) { return HEX.test(color) ? this.setAreaFields(key, { color }) : Promise.resolve(); }
  setAreaEnabled(key, enabled) { return this.setAreaFields(key, { enabled }); }

  // A new area: its folder and note in 10 Areas, and a tab after the other area tabs.
  async createArea(name, color, icon) {
    name = String(name || "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
    const key = areaSlug(name);
    if (!key) { new Notice("Give the area a name."); return null; }
    if (this.areaList?.some((a) => a.key === key)) { new Notice(`There is already an area #${key}.`); return null; }
    if (this.app.vault.getAbstractFileByPath(`${AREA_ROOT}/${name}`)) { new Notice(`${AREA_ROOT}/${name} already exists: pick another name, or give the note in it type: area.`); return null; }
    await this.writeAreaNote(name, key, color, true);
    let id = key, n = 2;
    while (this.layout.tabs.some((t) => t.id === id)) id = `${key}-${n++}`;
    await this.changeLayout((layout) => {
      let at = -1;
      layout.tabs.forEach((t, i) => { if (t.area) at = i; });
      layout.tabs.splice(at < 0 ? layout.tabs.length : at + 1, 0, { id, label: name, area: key, icon: icon || "layout-grid", widgets: [...AREA_WIDGETS] });
    });
    // read the new note straight away (the metadata cache follows)
    this.areaList = [...(this.areaList || []), { key, path: `${AREA_ROOT}/${name}/${name}.md`, note: name, color, enabled: true }];
    this.loadAreasFromList();
    const tagged = this.app.metadataCache.getTags?.()[`#${key}`] || 0;
    new Notice(`Area ${name} made: ${AREA_ROOT}/${name}/${name}.md and a ${name} tab.${tagged ? ` ${tagged} place${tagged === 1 ? "" : "s"} already tagged #${key} now belong to it.` : ""}`, 8000);
    return id;
  }

  loadAreasFromList() {
    AREAS = this.areaList.filter((a) => a.enabled).map((a) => a.key);
    AREA_COLORS = Object.fromEntries(this.areaList.map((a) => [a.key, a.color]));
    AREA_TAG_RE = new RegExp(`(^|\\s)#(${AREAS.join("|") || "(?!)"})(?=\\s|$)`, "i");
    this.areaSig = JSON.stringify(this.areaList);
    this.refreshViews();
  }

  // What renaming an area's key would change: task and text lines tagged #old (outside templates, settings and
  // docs), and notes whose area property is old. Read only.
  async areaKeyUses(oldKey) {
    const re = new RegExp(`(^|\\s)#${oldKey}(?=[\\s/]|$)`, "i");
    const lines = [], props = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (TASK_EXCLUDED.some((p) => file.path.startsWith(p))) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      // generated notes (the Work schedule note) are rewritten by the app itself after a rename
      if ([].concat(cache?.frontmatter?.tags ?? []).map(String).includes("generated")) continue;
      if (String(cache?.frontmatter?.area ?? "").toLowerCase() === oldKey) props.push(file.path);
      if (!cache?.tags?.some((t) => t.tag.toLowerCase() === `#${oldKey}` || t.tag.toLowerCase().startsWith(`#${oldKey}/`))) continue;
      const text = await this.app.vault.cachedRead(file);
      const body = cache.frontmatterPosition ? cache.frontmatterPosition.end.line + 1 : 0;
      text.split("\n").forEach((l, i) => { if (i >= body && re.test(l)) lines.push({ path: file.path, line: i, before: l }); });
    }
    return { lines, props };
  }

  // Rename an area: the name of its tab(s); for areas other than Work and Study also its folder and note (links follow),
  // and with changeKey its key: #old becomes #new on every line, area: old becomes area: new. One undo for all of it.
  async renameArea(key, newName, changeKey) {
    const a = this.area(key);
    newName = String(newName || "").replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
    if (!a || !newName) return;
    const locked = LOCKED_AREAS.includes(key);
    const newKey = changeKey && !locked ? areaSlug(newName) : key;
    if (newKey !== key && this.areaList.some((x) => x.key === newKey)) { new Notice(`There is already an area #${newKey}.`); return; }
    const undo = { name: this.areaName(key), newName, key, newKey, labels: [], renames: [], lines: [], props: [] };
    // names on the tabs
    for (const t of this.layout.tabs) if (t.area === key) undo.labels.push({ id: t.id, label: t.label });
    // folder and note
    let file = await this.areaFile(key);
    if (!locked) {
      const folder = file.parent;
      if (folder && folder.name === file.basename && folder.parent?.path === AREA_ROOT && folder.name !== newName && !this.app.vault.getAbstractFileByPath(`${AREA_ROOT}/${newName}`)) {
        const from = folder.path;
        await this.app.fileManager.renameFile(folder, `${AREA_ROOT}/${newName}`);
        undo.renames.push({ from, to: `${AREA_ROOT}/${newName}` });
        file = this.app.vault.getAbstractFileByPath(`${AREA_ROOT}/${newName}/${file.name}`) || file;
      }
      if (file.basename !== newName && !this.app.vault.getAbstractFileByPath(`${file.parent.path}/${newName}.md`)) {
        const from = file.path, to = `${file.parent.path}/${newName}.md`;
        await this.app.fileManager.renameFile(file, to);
        undo.renames.push({ from, to });
        file = this.app.vault.getAbstractFileByPath(to) || file;
      }
    }
    if (newKey !== key) {
      const uses = await this.areaKeyUses(key);
      const re = new RegExp(`(^|\\s)#${key}(?=[\\s/]|$)`, "gi");
      const byFile = new Map();
      for (const u of uses.lines) byFile.set(u.path, [...(byFile.get(u.path) || []), u]);
      for (const [path, us] of byFile) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) continue;
        await this.app.vault.process(f, (data) => {
          const L = data.split("\n");
          for (const u of us) if (L[u.line] === u.before) { L[u.line] = u.before.replace(re, `$1#${newKey}`); undo.lines.push({ path, line: u.line, before: u.before, after: L[u.line] }); }
          return L.join("\n");
        });
      }
      for (const path of new Set([...uses.props, file.path])) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof TFile)) continue;
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          if (String(fm.area ?? "").toLowerCase() === key) { fm.area = newKey; undo.props.push(path); }
        });
      }
    }
    await this.changeLayout((layout) => { for (const t of layout.tabs) if (t.area === key) { t.label = newName; t.area = newKey; } });
    this.areaUndo = undo;
    try { window.localStorage.setItem("ex3c-area-undo", JSON.stringify(undo)); } catch (e) { /* ignore */ }
    const ar = this.area(key);
    if (ar) { ar.key = newKey; ar.note = locked ? ar.note : newName; ar.path = file.path; }
    this.loadAreasFromList();
    const what = [`${undo.name} is now ${newName}`];
    if (undo.renames.length) what.push(`note and folder renamed`);
    if (newKey !== key) what.push(`#${key} became #${newKey} on ${undo.lines.length} line${undo.lines.length === 1 ? "" : "s"}, area: ${newKey} in ${undo.props.length} note${undo.props.length === 1 ? "" : "s"}`);
    const frag = document.createDocumentFragment();
    frag.append(`${what.join("; ")}. `);
    const btn = document.createElement("button");
    btn.textContent = "Undo";
    btn.addEventListener("click", () => void this.undoAreaRename());
    frag.append(btn);
    new Notice(frag, 12000);
  }

  async undoAreaRename() {
    if (this.areaUndo === undefined) { try { this.areaUndo = JSON.parse(window.localStorage.getItem("ex3c-area-undo") || "null"); } catch (e) { this.areaUndo = null; } }
    const u = this.areaUndo;
    if (!u) return;
    this.areaUndo = null;
    try { window.localStorage.removeItem("ex3c-area-undo"); } catch (e) { /* ignore */ }
    let skipped = 0;
    const byFile = new Map();
    for (const l of u.lines) byFile.set(l.path, [...(byFile.get(l.path) || []), l]);
    for (const [path, ls] of byFile) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) { skipped += ls.length; continue; }
      await this.app.vault.process(f, (data) => {
        const L = data.split("\n");
        for (const l of ls) { if (L[l.line] === l.after) L[l.line] = l.before; else skipped++; }
        return L.join("\n");
      });
    }
    for (const path of u.props) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.fileManager.processFrontMatter(f, (fm) => { if (fm.area === u.newKey) fm.area = u.key; });
    }
    for (const r of [...u.renames].reverse()) {
      const f = this.app.vault.getAbstractFileByPath(r.to);
      if (f && !this.app.vault.getAbstractFileByPath(r.from)) await this.app.fileManager.renameFile(f, r.from);
      else skipped++;
    }
    await this.changeLayout((layout) => {
      for (const t of layout.tabs) {
        const was = u.labels.find((x) => x.id === t.id);
        if (was) { t.label = was.label; t.area = u.key; }
      }
    });
    this.areaSig = null;
    this.loadAreas();
    this.refreshViews();
    new Notice(`Rename undone: ${u.newName} is ${u.name} again.${skipped ? ` ${skipped} change${skipped === 1 ? " was" : "s were"} edited since and left as they are.` : ""}`, 8000);
  }


  tabShown(tab) { return (tab.id !== "ai" || this.aiOn()) && !(tab.area && this.areaList?.some((a) => a.key === tab.area && !a.enabled)); }

  // Optional modules widget: what a removed module took away, so Restore can put it back.
  setModuleRecord(id, record) {
    return this.changeLayout((layout) => {
      layout.modules = { ...(layout.modules || {}) };
      if (record) layout.modules[id] = record; else delete layout.modules[id];
      if (!Object.keys(layout.modules).length) delete layout.modules;
    });
  }

  async renderRawTemplate(file) {
    const templater = this.app.plugins?.plugins?.["templater-obsidian"]?.templater;
    if (!templater?.overwrite_file_commands) return;
    const text = await this.app.vault.read(file);
    if (!/<%[\s\S]*?%>/.test(text)) return;
    await templater.overwrite_file_commands(file);
  }

  // Reads Meta/widgets/*.js. A file's first comment lines may say "// label: ..." and "// desc: ...".
  async scanUserWidgets() {
    for (const w of WIDGETS.filter((x) => x.id.startsWith("user:"))) { WIDGETS.splice(WIDGETS.indexOf(w), 1); WIDGET_BY_ID.delete(w.id); }
    const files = this.app.vault.getFiles().filter((file) => file.parent?.path === USER_WIDGET_DIR && file.extension === "js").sort((a, b) => a.basename.localeCompare(b.basename));
    for (const file of files) {
      let head = "";
      try { head = (await this.app.vault.cachedRead(file)).slice(0, 600); } catch (error) { /* unreadable: still list it */ }
      const label = head.match(/^\/\/\s*label:\s*(.+)$/m)?.[1]?.trim() || file.basename;
      const desc = head.match(/^\/\/\s*desc:\s*(.+)$/m)?.[1]?.trim() || `Your widget, from ${file.path}.`;
      const widget = { id: `user:${file.basename}`, label, desc, from: "Your widgets" };
      WIDGETS.push(widget);
      WIDGET_BY_ID.set(widget.id, widget);
    }
  }

  async loadLayout() {
    let text = null;
    for (const path of [LAYOUT_PATH]) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) { text = await this.app.vault.read(file); break; }
    }
    await this.scanUserWidgets();
    let raw = null;
    if (text) {
      try { raw = JSON.parse(text.match(LAYOUT_JSON_RE)?.[1] ?? ""); }
      catch (error) { new Notice("EX3C AgendA: the layout note's json block could not be read, so the default tabs are shown."); }
    }
    this.layout = normalizeLayout(raw);
    if (this.mergeNewDefaults() && text !== null) await this.saveLayout();
  }

  // A saved layout lists the default widgets it has seen (known). A default widget it has not seen yet goes onto the
  // saved tab with the same id, after the default widget it follows; one you remove later stays removed.
  mergeNewDefaults() {
    const layout = this.layout;
    const known = new Set(Array.isArray(layout.known) ? layout.known : [...LEGACY_KNOWN, ...layout.tabs.flatMap((t) => t.widgets)]);
    let changed = !Array.isArray(layout.known);
    for (const std of DEFAULT_LAYOUT.tabs) {
      const tab = layout.tabs.find((t) => t.id === std.id);
      if (!tab) continue;
      std.widgets.forEach((w, i) => {
        if (known.has(w) || tab.widgets.includes(w)) return;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) { const k = tab.widgets.indexOf(std.widgets[j]); if (k >= 0) { at = k + 1; break; } }
        tab.widgets.splice(at, 0, w);
        changed = true;
      });
    }
    for (const w of DEFAULT_LAYOUT.tabs.flatMap((t) => t.widgets)) if (!known.has(w)) { known.add(w); changed = true; }
    layout.known = [...known].sort();
    return changed;
  }

  async saveLayout() {
    const block = "```json\n" + JSON.stringify(this.layout, null, 2) + "\n```";
    this.savingLayout = true;
    try {
      const file = this.app.vault.getAbstractFileByPath(LAYOUT_PATH);
      if (file instanceof TFile) {
        await this.app.vault.process(file, (data) => (LAYOUT_JSON_RE.test(data) ? data.replace(LAYOUT_JSON_RE, () => block) : `${data.trimEnd()}\n\n${block}\n`));
      } else {
        await this.app.vault.create(LAYOUT_PATH, `${LAYOUT_NOTE_HEADER}${block}\n`);
      }
    } catch (error) {
      new Notice(`EX3C AgendA could not save the layout: ${error.message}`);
    } finally {
      window.setTimeout(() => { this.savingLayout = false; }, 600);
    }
  }

  async changeLayout(mutate) {
    mutate(this.layout);
    this.layout = normalizeLayout(this.layout);
    this.refreshViews();
    await this.saveLayout();
  }

  // fromTabId: the tab the widget is dragged out of (null when it comes from the Widgets panel, which adds a copy).
  moveWidget(id, tabId, beforeId = null, fromTabId = null) {
    if (id === beforeId) return Promise.resolve();
    return this.changeLayout((layout) => {
      for (const tab of layout.tabs) if (tab.id === tabId || tab.id === fromTabId) tab.widgets = tab.widgets.filter((w) => w !== id);
      const tab = layout.tabs.find((t) => t.id === tabId);
      if (!tab) return;
      const index = beforeId ? tab.widgets.indexOf(beforeId) : -1;
      if (index >= 0) tab.widgets.splice(index, 0, id);
      else tab.widgets.push(id);
    });
  }

  removeWidget(id, fromTabId) {
    if (!fromTabId) return Promise.resolve();
    return this.changeLayout((layout) => { const tab = layout.tabs.find((t) => t.id === fromTabId); if (tab) tab.widgets = tab.widgets.filter((w) => w !== id); });
  }

  async addTab(label) {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "tab";
    let id = base;
    let n = 2;
    while (this.layout.tabs.some((tab) => tab.id === id)) id = `${base}-${n++}`;
    await this.changeLayout((layout) => layout.tabs.push({ id, label, widgets: [] }));
    return id;
  }

  setTabArea(id, area) {
    return this.changeLayout((layout) => { const tab = layout.tabs.find((t) => t.id === id); if (tab) { if (area) tab.area = area; else delete tab.area; } });
  }

  setAppName(name) {
    return this.changeLayout((layout) => { if (name) layout.appName = name; else delete layout.appName; }).then(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.updateHeader?.();
    });
  }

  setTheme(patch) {
    return this.changeLayout((layout) => { layout.theme = normalizeTheme({ ...(layout.theme || {}), ...patch }); }).then(() => this.applyAccent());
  }

  setTabColor(id, color) {
    return this.changeLayout((layout) => { const tab = layout.tabs.find((t) => t.id === id); if (tab) { if (color) tab.color = color; else delete tab.color; } }).then(() => this.applyAccent());
  }

  setTabIcon(id, icon) {
    return this.changeLayout((layout) => { const tab = layout.tabs.find((t) => t.id === id); if (tab) tab.icon = icon; });
  }

  // Puts a standard page back where it sits in the default layout (after the standard page before it).
  restoreTab(id) {
    const std = DEFAULT_LAYOUT.tabs.find((t) => t.id === id);
    if (!std) return Promise.resolve();
    return this.changeLayout((layout) => {
      if (layout.tabs.some((t) => t.id === id)) return;
      const order = DEFAULT_LAYOUT.tabs.map((t) => t.id);
      let at = 0;
      for (let i = order.indexOf(id) - 1; i >= 0; i--) { const j = layout.tabs.findIndex((t) => t.id === order[i]); if (j >= 0) { at = j + 1; break; } }
      layout.tabs.splice(at, 0, JSON.parse(JSON.stringify(std)));
    });
  }

  renameTab(id, label) {
    return this.changeLayout((layout) => { const tab = layout.tabs.find((t) => t.id === id); if (tab) tab.label = label; });
  }

  deleteTab(id) {
    return this.changeLayout((layout) => { layout.tabs = layout.tabs.filter((t) => t.id !== id); });
  }

  moveTab(id, beforeId) {
    return this.changeLayout((layout) => {
      const from = layout.tabs.findIndex((t) => t.id === id);
      if (from < 0) return;
      const [tab] = layout.tabs.splice(from, 1);
      const to = layout.tabs.findIndex((t) => t.id === beforeId);
      layout.tabs.splice(to < 0 ? layout.tabs.length : to, 0, tab);
    });
  }

  resetLayout() {
    return this.changeLayout((layout) => { layout.tabs = JSON.parse(JSON.stringify(DEFAULT_LAYOUT.tabs.filter((t) => t.id !== "ai" || this.aiOn()))); layout.known = [...new Set(DEFAULT_LAYOUT.tabs.flatMap((t) => t.widgets))].sort(); });
  }

  currentTab() {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    return view instanceof LifeOSHomeView ? view.currentTab() : this.layout.tabs[0] || null;
  }

  refreshPalettes() {
    for (const leaf of this.app.workspace.getLeavesOfType(PALETTE_VIEW)) {
      if (leaf.view instanceof LifeOSWidgetPaletteView) leaf.view.render();
    }
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof LifeOSHomeView) leaf.view.render(true);
    }
    this.refreshPalettes();
  }

  async openPalette() {
    let leaf = this.app.workspace.getLeavesOfType(PALETTE_VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf("split", "vertical");
      await leaf.setViewState({ type: PALETTE_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async setEditing(on) {
    if (on && !this.editing) this.rightWasCollapsed = Boolean(this.app.workspace.rightSplit?.collapsed);
    this.editing = on;
    // On a phone the Widgets panel would cover the whole page (and Configure's Areas): it opens from its button only.
    const narrow = Platform.isPhone || (activeWindow?.innerWidth ?? 1000) < 700;
    if (on && !narrow) {
      await this.openPalette();
      const home = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (home) await this.app.workspace.revealLeaf(home);
    } else {
      this.app.workspace.detachLeavesOfType(PALETTE_VIEW);
      // Give the page its width back if edit mode was what opened the right sidebar.
      if (this.rightWasCollapsed) this.app.workspace.rightSplit?.collapse?.();
      this.rightWasCollapsed = false;
    }
    this.refreshViews();
  }

  async activateView(screen = "home") {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type: VIEW_TYPE,
        active: true,
      });
    }

    if (leaf.view instanceof LifeOSHomeView) {
      leaf.view.activeScreen = screen;
      leaf.view.render(true);
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  openCapture() {
    new LifeOSCaptureModal(this.app, this).open();
  }

  runCommand(commandId, label) {
    const ran = this.app.commands.executeCommandById(commandId);

    if (!ran) {
      new Notice(
        `${label} is unavailable. Check that its supporting plugin is enabled.`
      );
    }

    return ran;
  }

  onunload() {
    if (this.agentBlocksHidden) { try { MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor("agent"); } catch (error) { /* ignore */ } }
    this.app.workspace.detachLeavesOfType("life-os-brain");
    this.app.workspace.detachLeavesOfType(PALETTE_VIEW);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
};

// ---------- built-in widget code: generated by scripts/bundle-views.mjs from views/*.js; edit those files, not this block ----------
const BUILTIN_VIEWS = Object.freeze({
  "birthdays": "// Birthdays from people notes. Usage: await dv.view(\"Meta/views/birthdays\")\n// Reads the birthday property of every person note (type: person, or a note in 05 People): 1990-03-14, or 03-14 when\n// you do not know the year. Lists the coming birthdays with the age they turn; \"Present\" puts a task in the person's\n// note a week before (⏳) with the birthday as its due date (📅). The planner shows birthdays on their day.\nconst DAYS_AHEAD = input?.days ?? 365, SHOW = input?.limit ?? 8;\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst today = new Date(); today.setHours(12, 0, 0, 0);\nconst parseBirthday = v => { const m = String(v ?? \"\").trim().match(/^(?:(\\d{4})-)?(\\d{1,2})-(\\d{1,2})$/); return m ? { y: m[1] ? +m[1] : null, mo: +m[2], d: +m[3] } : null; };\nconst people = dv.pages().where(p => (String(p.type ?? \"\") === \"person\" || p.file.path.startsWith(\"05 People/\")) && !p.file.path.startsWith(\"Templates/\") && !(p.file.tags ?? []).includes(\"#example\")).array();\nconst list = [];\nfor (const p of people) {\n  const b = parseBirthday(p.birthday?.toISODate ? p.birthday.toISODate() : p.birthday);\n  if (!b) continue;\n  let next = new Date(today.getFullYear(), b.mo - 1, b.d, 12);\n  if (next < today) next = new Date(today.getFullYear() + 1, b.mo - 1, b.d, 12);\n  const days = Math.round((next - today) / 86400000);\n  if (days <= DAYS_AHEAD) list.push({ p, next: iso(next), days, age: b.y ? next.getFullYear() - b.y : null });\n}\nlist.sort((a, b) => a.days - b.days);\nconst root = dv.container.createEl(\"div\", { cls: \"bday\" });\nroot.createEl(\"style\", { text: `.bday { font-size: 13px; } .bday h4 { margin: 0 0 4px; } .bday-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); }\n.bday-row .n { flex: 1; cursor: pointer; } .bday-row .w { color: var(--text-muted); font-size: 12px; white-space: nowrap; } .bday-row.is-soon .w { color: var(--text-accent); font-weight: 600; }\n.bday-sub { color: var(--text-muted); font-size: 12px; } .bday button { font-size: 12px; padding: 1px 8px; height: auto; }` });\nroot.createEl(\"h4\", { text: \"Birthdays\" });\nif (!list.length) { root.createEl(\"p\", { cls: \"bday-sub\", text: \"No birthdays yet. Give a person note the property birthday: 1990-03-14 (or 03-14 without the year).\" }); return; }\nconst dm = s => `${s.slice(8, 10)}-${s.slice(5, 7)}`;\nfor (const x of list.slice(0, SHOW)) {\n  const row = root.createEl(\"div\", { cls: `bday-row${x.days <= 7 ? \" is-soon\" : \"\"}` });\n  row.createEl(\"span\", { text: \"🎂\" });\n  const n = row.createEl(\"span\", { cls: \"n\", text: `${x.p.file.name}${x.age ? ` turns ${x.age}` : \"\"}` });\n  n.addEventListener(\"click\", () => app.workspace.openLinkText(x.p.file.path, \"\", false));\n  row.createEl(\"span\", { cls: \"w\", text: x.days === 0 ? \"today\" : x.days === 1 ? \"tomorrow\" : `${dm(x.next)} · in ${x.days} days` });\n  const before = new Date(`${x.next}T12:00:00`); before.setDate(before.getDate() - 7);\n  const plan = iso(before < today ? today : before);\n  const has = x.p.file.tasks.some(t => !t.completed && /present|gift|cadeau/i.test(t.text) && String(t.text).includes(x.next));\n  const b = row.createEl(\"button\", { text: has ? \"Present ✓\" : \"Present\", attr: { title: has ? \"A present task for this birthday is in their note\" : `Adds \"- [ ] Present for ${x.p.file.name} ⏳ ${plan} 📅 ${x.next}\" to their note` } });\n  if (has) b.disabled = true;\n  else b.addEventListener(\"click\", async () => {\n    const f = app.vault.getAbstractFileByPath(x.p.file.path);\n    await app.vault.process(f, d => `${d.trimEnd()}\\n- [ ] Present for ${x.p.file.name} ⏳ ${plan} 📅 ${x.next}\\n`);\n    b.textContent = \"Present ✓\"; b.disabled = true;\n  });\n}\nif (list.length > SHOW) root.createEl(\"div\", { cls: \"bday-sub\", text: `and ${list.length - SHOW} more in the coming year.` });\n",
  "boards": "// EX3C Agenda Boards widget: every Kanban board in the vault with card counts per lane.\n// Usage:\n//   await dv.view(\"Meta/views/boards\")                       all boards, all lanes\n//   await dv.view(\"Meta/views/boards\", { compact: true })    one line per board: open cards + the lane that needs attention\n//   await dv.view(\"Meta/views/boards\", { folder: \"06 Writing\" })\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst FOLDER = input && input.folder ? input.folder : null;\nconst COMPACT = !!(input && input.compact);\nconst DONE_LANES = (cfg.board_done_lanes || \"Done,Published,Archive\").split(\",\").map(s => s.trim().toLowerCase());\n\nconst boards = dv.pages(FOLDER ? `\"${FOLDER}\"` : \"\").where(p => {\n  const fm = p.file.frontmatter || {};\n  return typeof fm[\"kanban-plugin\"] === \"string\";\n}).sort(p => p.file.path).array();\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nif (boards.length === 0) {\n  root.createEl(\"p\", { text: \"No Kanban boards found (a board is any note with `kanban-plugin` in its properties).\" });\n} else {\n  const parsed = [];\n  for (const b of boards) {\n    const tfile = app.vault.getAbstractFileByPath(b.file.path);\n    let text = \"\";\n    try { text = await app.vault.cachedRead(tfile); } catch (e) { continue; }\n    text = text.replace(/^---[\\s\\S]*?---\\n/, \"\");\n    const cut = text.indexOf(\"\\n%% kanban:settings\");\n    if (cut !== -1) text = text.slice(0, cut);\n    const archiveCut = text.indexOf(\"\\n***\");\n    if (archiveCut !== -1) text = text.slice(0, archiveCut);\n    const lanes = [];\n    let cur = null;\n    for (const line of text.split(\"\\n\")) {\n      const h = line.match(/^##\\s+(.*)$/);\n      if (h) { cur = { name: h[1].trim(), cards: [] }; lanes.push(cur); continue; }\n      const c = line.match(/^- \\[( |x)\\]\\s+(.*)$/);\n      if (c && cur) cur.cards.push({ done: c[1] === \"x\", text: c[2].trim() });\n    }\n    const open = lanes.filter(l => !DONE_LANES.includes(l.name.toLowerCase())).reduce((s, l) => s + l.cards.length, 0);\n    const done = lanes.filter(l => DONE_LANES.includes(l.name.toLowerCase())).reduce((s, l) => s + l.cards.length, 0);\n    parsed.push({ page: b, lanes, open, done });\n  }\n\n  if (COMPACT) {\n    const table = root.createEl(\"table\", { cls: \"lifeos-table\" });\n    const tr = table.createEl(\"thead\").createEl(\"tr\");\n    for (const h of [\"Board\", \"Open\", \"Done\", \"Lanes\"]) tr.createEl(\"th\", { text: h });\n    const tb = table.createEl(\"tbody\");\n    for (const b of parsed) {\n      const r = tb.createEl(\"tr\");\n      const td = r.createEl(\"td\");\n      const a = td.createEl(\"a\", { text: b.page.file.name, cls: \"internal-link\", attr: { href: b.page.file.path, \"data-href\": b.page.file.path } });\n      a.addEventListener(\"click\", e => { e.preventDefault(); app.workspace.openLinkText(b.page.file.path, \"\", false); });\n      r.createEl(\"td\", { text: String(b.open) });\n      r.createEl(\"td\", { text: String(b.done) });\n      r.createEl(\"td\", { text: b.lanes.filter(l => !DONE_LANES.includes(l.name.toLowerCase())).map(l => `${l.name} ${l.cards.length}`).join(\"  ·  \") });\n    }\n  } else {\n    for (const b of parsed) {\n      const h = root.createEl(\"h4\");\n      const a = h.createEl(\"a\", { text: b.page.file.name, cls: \"internal-link\", attr: { href: b.page.file.path, \"data-href\": b.page.file.path } });\n      a.addEventListener(\"click\", e => { e.preventDefault(); app.workspace.openLinkText(b.page.file.path, \"\", false); });\n      h.appendText(`  (${b.open} open, ${b.done} done)`);\n      const table = root.createEl(\"table\", { cls: \"lifeos-table\" });\n      const tr = table.createEl(\"thead\").createEl(\"tr\");\n      for (const l of b.lanes) tr.createEl(\"th\", { text: `${l.name} (${l.cards.length})` });\n      const row = table.createEl(\"tbody\").createEl(\"tr\");\n      for (const l of b.lanes) {\n        const td = row.createEl(\"td\");\n        td.style.verticalAlign = \"top\";\n        const items = l.cards.slice(0, 6);\n        for (const c of items) {\n          const d = td.createEl(\"div\", { text: c.text.replace(/@\\{[^}]*\\}/g, \"\").replace(/\\[\\[|\\]\\]/g, \"\").trim() });\n          if (c.done) d.style.opacity = \"0.5\";\n          d.style.fontSize = \"0.85em\";\n        }\n        if (l.cards.length > items.length) td.createEl(\"div\", { text: `+${l.cards.length - items.length} more` }).style.opacity = \"0.6\";\n      }\n    }\n  }\n}\n",
  "calendars": "// Calendar links and local .ics files. Usage: await dv.view(\"Meta/views/calendars\")\n// Calendar links (Google, iCloud, Outlook \"secret address in iCal format\") are kept in Meta/EX3C Agenda Config.md\n// (calendar_links) and fetched by the EX3C AgendA plugin into \"Meta/calendars/<name> (calendar).md\"; the app\n// refreshes them at start-up when older than six hours. With { refresh: \"stale\" | \"all\" } this view only refreshes.\n// Finds every .ics file in the vault and, on Import, writes \"<name> (calendar).md\" next to it: one line per\n// event from 14 days ago to 120 days ahead, as \"- [ ] 09:00 - 10:00 Title #event ⏳ 2026-10-12\", so Day Planner\n// shows the events as blocks and the planner treats them as fixed. Re-importing rewrites that note.\n// Limits: times in a TZID zone are read as local time; recurring events support DAILY, WEEKLY (BYDAY), MONTHLY,\n// YEARLY with INTERVAL, COUNT, UNTIL, and EXDATE.\nconst PAST = 14, AHEAD = 120;\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;\n\nfunction unfold(text) { return text.replace(/\\r\\n/g, \"\\n\").replace(/\\n[ \\t]/g, \"\"); }\nfunction parseDate(value, params) {\n  const v = String(value).trim();\n  const m = v.match(/^(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2})(Z)?)?$/);\n  if (!m) return null;\n  const allDay = !m[4] || /VALUE=DATE(?!-)/.test(params || \"\");\n  if (allDay && !m[4]) return { date: new Date(+m[1], +m[2] - 1, +m[3]), allDay: true };\n  const d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);\n  return { date: d, allDay: false };\n}\nfunction parseIcs(text) {\n  const events = [];\n  let cur = null;\n  for (const line of unfold(text).split(\"\\n\")) {\n    if (line === \"BEGIN:VEVENT\") { cur = { exdates: [] }; continue; }\n    if (line === \"END:VEVENT\") { if (cur?.start) events.push(cur); cur = null; continue; }\n    if (!cur) continue;\n    const i = line.indexOf(\":\"); if (i < 0) continue;\n    const [name, ...params] = line.slice(0, i).split(\";\");\n    const value = line.slice(i + 1);\n    const p = params.join(\";\");\n    if (name === \"SUMMARY\") cur.summary = value.replace(/\\\\,/g, \",\").replace(/\\;/g, \";\").replace(/\\\\n/gi, \" \").trim();\n    else if (name === \"DTSTART\") cur.start = parseDate(value, p);\n    else if (name === \"DTEND\") cur.end = parseDate(value, p);\n    else if (name === \"RRULE\") cur.rrule = Object.fromEntries(value.split(\";\").map(kv => kv.split(\"=\")));\n    else if (name === \"EXDATE\") for (const v of value.split(\",\")) { const d = parseDate(v, p); if (d) cur.exdates.push(iso(d.date)); }\n    else if (name === \"STATUS\") cur.status = value;\n  }\n  return events.filter(e => e.status !== \"CANCELLED\");\n}\nfunction occurrences(ev, from, to) {\n  const out = [];\n  const start = ev.start.date;\n  const durMs = ev.end ? ev.end.date - start : (ev.start.allDay ? 86400000 : 3600000);\n  const push = d => { if (d >= from && d <= to && !ev.exdates.includes(iso(d))) out.push(new Date(d)); };\n  if (!ev.rrule) { push(start); return out.map(d => ({ start: d, end: new Date(d.getTime() + durMs) })); }\n  const r = ev.rrule, interval = Number(r.INTERVAL || 1), count = r.COUNT ? Number(r.COUNT) : Infinity;\n  const until = r.UNTIL ? parseDate(r.UNTIL)?.date : null;\n  const days = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };\n  const byday = r.BYDAY ? r.BYDAY.split(\",\").map(x => days[x.slice(-2)]).filter(x => x !== undefined) : null;\n  let n = 0;\n  for (let i = 0; i < 2000 && n < count; i++) {\n    const base = new Date(start);\n    if (r.FREQ === \"DAILY\") base.setDate(base.getDate() + i * interval);\n    else if (r.FREQ === \"WEEKLY\") base.setDate(base.getDate() + i * 7 * interval);\n    else if (r.FREQ === \"MONTHLY\") base.setMonth(base.getMonth() + i * interval);\n    else if (r.FREQ === \"YEARLY\") base.setFullYear(base.getFullYear() + i * interval);\n    else break;\n    const candidates = r.FREQ === \"WEEKLY\" && byday ? byday.map(wd => { const d = new Date(base); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + ((wd + 6) % 7)); return d; }).filter(d => d >= start).sort((a, b) => a - b) : [base];\n    for (const d of candidates) {\n      if (until && d > until) { n = count; break; }\n      if (n >= count) break;\n      n++;\n      push(d);\n    }\n    if (base > to) break;\n  }\n  return out.map(d => ({ start: d, end: new Date(d.getTime() + durMs) }));\n}\nfunction eventLines(text) {\n  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - PAST);\n  const to = new Date(); to.setHours(23, 59, 59, 0); to.setDate(to.getDate() + AHEAD);\n  const lines = [];\n  for (const ev of parseIcs(text)) {\n    for (const o of occurrences(ev, from, to)) {\n      const title = (ev.summary || \"Untitled event\").replace(/#/g, \"\");\n      if (ev.start.allDay) lines.push({ key: iso(o.start) + \" 00:00\", line: `- [ ] ${title} #event ⏳ ${iso(o.start)}` });\n      else lines.push({ key: iso(o.start) + \" \" + hm(o.start), line: `- [ ] ${hm(o.start)} - ${hm(o.end)} ${title} #event ⏳ ${iso(o.start)}` });\n    }\n  }\n  return lines.sort((a, b) => a.key.localeCompare(b.key)).map(x => x.line);\n}\nfunction calendarNote(source, lines, area = \"\") {\n  const stamp = new Date();\n  return `---\\ntags:\\n  - calendar\\n${area ? `area: ${area}\\n` : \"\"}fetched: ${stamp.toISOString()}\\n---\\nGenerated from ${source} on ${pad(stamp.getDate())}-${pad(stamp.getMonth() + 1)}-${stamp.getFullYear()} ${hm(stamp)}. Refreshed automatically; edits here are overwritten.\\n\\n## Events\\n${lines.join(\"\\n\")}\\n`;\n}\nasync function writeNote(target, body) {\n  const folder = target.split(\"/\").slice(0, -1).join(\"/\");\n  if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);\n  const existing = app.vault.getAbstractFileByPath(target);\n  if (existing) await app.vault.modify(existing, body); else await app.vault.create(target, body);\n}\n// ---- calendar links ----\nconst CFG = \"Meta/EX3C Agenda Config.md\";\nconst LINK_DIR = \"Meta/calendars\";\nconst plugin = app.plugins.plugins[\"ex3c-agenda\"];\n// a link: { name, url, area (one of your areas: its events take that area's colour in the planner), off (switched off) }\nconst AREAS = app.plugins.plugins[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst areaName = a => app.plugins.plugins[\"ex3c-agenda\"]?.areaName?.(a) || a[0].toUpperCase() + a.slice(1);\nconst links = () => (Array.isArray(dv.page(CFG)?.calendar_links) ? dv.page(CFG).calendar_links : []).filter(l => l && l.url).map(l => ({ name: String(l.name || \"Calendar\").replace(/[\\\\/:*?\"<>|#^[\\]]/g, \" \").trim() || \"Calendar\", url: String(l.url), area: /^[a-z0-9-]+$/.test(String(l.area || \"\")) ? String(l.area) : \"\", off: l.off === true }));\nconst plain = l => ({ name: l.name, url: l.url, ...(l.area ? { area: l.area } : {}), ...(l.off ? { off: true } : {}) });\nconst linkTarget = l => `${LINK_DIR}/${l.name} (calendar).md`;\n// The last failed fetch per address, kept on the plugin for this session, so the row can say so after a redraw.\nconst errors = plugin ? (plugin.calendarErrors ??= {}) : {};\nconst friendly = e => /net::|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|Failed to fetch|PROXY|INTERNET_DISCONNECTED/i.test(String(e?.message ?? e)) ? \"no connection, or the address cannot be reached\" : /status (401|403|404)/.test(String(e?.message ?? e)) ? \"the address was refused; copy the secret iCal address again\" : String(e?.message ?? e);\nasync function fetchLink(l) {\n  try {\n    if (!plugin?.fetchText) throw new Error(\"the EX3C AgendA plugin is needed to fetch calendar links\");\n    const text = await plugin.fetchText(l.url);\n    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error(\"that address did not return a calendar (.ics)\");\n    const lines = eventLines(text);\n    await writeNote(linkTarget(l), calendarNote(`the calendar link \"${l.name}\"`, lines, l.area));\n    delete errors[l.url];\n    return lines.length;\n  } catch (e) {\n    errors[l.url] = { at: new Date(), msg: friendly(e) };\n    throw new Error(errors[l.url].msg);\n  }\n}\n// what a link's row says when its last fetch failed: when, why, and which events the planner still shows\nconst failText = (l, page) => { const er = errors[l.url]; if (!er) return \"\"; const t = page?.fetched ? new Date(String(page.fetched)) : null;\n  return `refresh failed at ${hm(er.at)}: ${er.msg}. ${t ? `Still showing the ${page.file.tasks.length} events from ${pad(t.getDate())}-${pad(t.getMonth() + 1)} ${hm(t)}.` : \"No events yet.\"}`; };\n// switched off: the note keeps no events (so the planner and Day Planner show none) until you switch it on again\nconst offNote = l => writeNote(linkTarget(l), `---\\ntags:\\n  - calendar\\n${l.area ? `area: ${l.area}\\n` : \"\"}off: true\\n---\\nThe calendar link \"${l.name}\" is switched off on the Calendars page; switch it on to fetch its events again.\\n\\n## Events\\n`);\nasync function saveLinks(list) {\n  const f = app.vault.getAbstractFileByPath(CFG);\n  if (f) await app.fileManager.processFrontMatter(f, fm => { fm.calendar_links = list.map(plain); });\n}\nconst updateLink = (l, change) => saveLinks(links().map(x => (x.url === l.url ? { ...x, ...change } : x)));\nif (input?.refresh) {\n  for (const l of links().filter(x => !x.off)) {\n    const fetched = dv.page(linkTarget(l))?.fetched;\n    const age = fetched ? Date.now() - new Date(String(fetched)).getTime() : Infinity;\n    if (input.refresh === \"all\" || !(age < 6 * 3600000)) {\n      try { const n = await fetchLink(l); if (input.refresh === \"all\") notify(`${l.name}: ${n} events`); }\n      catch (e) {\n        console.warn(`Calendar link ${l.name}`, e);\n        // the start-up refresh says it once a session; Refresh all says it every time\n        const shown = plugin ? (plugin.calendarErrorShown ??= new Set()) : new Set();\n        if (input.refresh === \"all\" || !shown.has(l.url)) { shown.add(l.url); notify(`Calendar \"${l.name}\" could not be refreshed: ${e.message}. The planner keeps its last events; see Calendars.`); }\n      }\n    }\n  }\n  return;\n}\n\nasync function importFile(file) {\n  const text = await app.vault.read(file);\n  const lines = eventLines(text);\n  const target = `${file.parent?.path && file.parent.path !== \"/\" ? file.parent.path + \"/\" : \"\"}${file.basename} (calendar).md`;\n  await writeNote(target, calendarNote(`[[${file.path}]]`, lines).replace(\"Refreshed automatically\", \"Re-import to update\"));\n  return { target, count: lines.length };\n}\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nroot.createEl(\"h4\", { text: \"Calendar links\" });\nroot.createEl(\"p\", { attr: { style: \"color:var(--text-muted);font-size:12px\" }, text: \"Paste a calendar's secret iCal address (Google: Settings › your calendar › Secret address in iCal format; iCloud: Share › Public calendar; Outlook: Publish › ICS). Events from 14 days back to 120 days ahead become fixed blocks in the planner and in Day Planner, refreshed when the app starts. The address is stored in Meta/EX3C Agenda Config.md and syncs with your vault, so treat that note as private. Use either this or Day Planner's remote calendars for a calendar, not both, or its events show twice.\" });\nconst areaPicker = (parent, value) => {\n  const sel = parent.createEl(\"select\", { attr: { \"aria-label\": \"Area\", title: \"Its events take this area's colour in the planner\" } });\n  for (const a of [\"\", ...AREAS]) sel.createEl(\"option\", { text: a ? areaName(a) : \"No area (grey)\", attr: { value: a } });\n  // an area you have since switched off still shows, so the link keeps it until you pick another\n  if (value && !AREAS.includes(value)) sel.createEl(\"option\", { text: `${areaName(value)} (off)`, attr: { value } });\n  sel.value = value || \"\";\n  return sel;\n};\nfor (const l of links()) {\n  const row = root.createEl(\"div\", { attr: { style: `display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap${l.off ? \";opacity:.6\" : \"\"}` } });\n  const page = dv.page(linkTarget(l));\n  // on/off: off empties its note, on fetches it again\n  const sw = row.createEl(\"input\", { attr: { type: \"checkbox\", title: l.off ? \"Switched off: switch on to fetch its events again\" : \"On: switch off to hide its events everywhere, without losing the link\" } });\n  sw.checked = !l.off;\n  sw.addEventListener(\"change\", async () => {\n    sw.disabled = true;\n    try {\n      if (sw.checked) { await updateLink(l, { off: false }); notify(`${l.name}: ${await fetchLink({ ...l, off: false })} events`); }\n      else { await updateLink(l, { off: true }); await offNote(l); notify(`${l.name} switched off`); }\n    } catch (e) { notify(`${l.name}: ${e.message}`); }\n    sw.disabled = false;\n  });\n  row.createEl(\"strong\", { text: l.name });\n  const status = row.createEl(\"span\", { attr: { style: `flex:1;min-width:10em;color:var(${!l.off && errors[l.url] ? \"--text-error\" : \"--text-muted\"});font-size:12px` }, text: l.off ? \"switched off\" : errors[l.url] ? failText(l, page) : page?.fetched ? (() => { const t = new Date(String(page.fetched)); return `${page.file.tasks.length} events, refreshed ${pad(t.getDate())}-${pad(t.getMonth() + 1)} ${hm(t)}`; })() : \"not fetched yet\" });\n  // its area: the events' colour in the planner (the note's area property), no refetch needed\n  const sel = areaPicker(row, l.area);\n  sel.addEventListener(\"change\", async () => {\n    await updateLink(l, { area: sel.value });\n    const f = app.vault.getAbstractFileByPath(linkTarget(l));\n    if (f) await app.fileManager.processFrontMatter(f, fm => { if (sel.value) fm.area = sel.value; else delete fm.area; });\n  });\n  const ob = row.createEl(\"button\", { text: \"Open note\" });\n  ob.disabled = !page;\n  ob.addEventListener(\"click\", () => app.workspace.openLinkText(linkTarget(l), \"\", false));\n  const rb = row.createEl(\"button\", { text: \"Refresh\" });\n  rb.disabled = l.off;\n  rb.addEventListener(\"click\", async () => {\n    rb.disabled = true; rb.setText(\"Refreshing...\");\n    try { notify(`${l.name}: ${await fetchLink(l)} events`); }\n    catch (e) { notify(`${l.name}: ${e.message}`); status.setText(failText(l, page)); status.style.color = \"var(--text-error)\"; }\n    rb.disabled = false; rb.setText(\"Refresh\");\n  });\n  // Remove asks once more: it forgets the address and moves the note to the trash\n  const xb = row.createEl(\"button\", { text: \"Remove\" });\n  let armed = null;\n  xb.addEventListener(\"click\", async () => {\n    if (!armed) { xb.setText(\"Sure? Remove\"); xb.addClass(\"mod-warning\"); armed = setTimeout(() => { armed = null; xb.setText(\"Remove\"); xb.removeClass(\"mod-warning\"); }, 4000); return; }\n    clearTimeout(armed);\n    await saveLinks(links().filter(x => x.url !== l.url)); const f = app.vault.getAbstractFileByPath(linkTarget(l)); if (f) await app.vault.trash(f, false);\n  });\n}\nconst add = root.createEl(\"div\", { attr: { style: \"display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px\" } });\nconst nameIn = add.createEl(\"input\", { attr: { type: \"text\", placeholder: \"Name, e.g. Work\", style: \"width:9em\" } });\nconst urlIn = add.createEl(\"input\", { attr: { type: \"url\", placeholder: \"https://… or webcal://… .ics address\", style: \"flex:1;min-width:14em\" } });\nconst areaIn = areaPicker(add, \"\");\nconst ab = add.createEl(\"button\", { text: \"Add and fetch\", cls: \"mod-cta\" });\nab.addEventListener(\"click\", async () => {\n  const l = { name: nameIn.value.trim() || \"Calendar\", url: urlIn.value.trim(), area: areaIn.value, off: false };\n  if (!/^(https?|webcal):\\/\\//i.test(l.url)) { notify(\"Paste the calendar's https:// or webcal:// address.\"); return; }\n  ab.disabled = true;\n  try { const n = await fetchLink(l); await saveLinks([...links().filter(x => x.url !== l.url), l]); notify(`${l.name}: ${n} events`); }\n  catch (e) { notify(`Could not add ${l.name}: ${e.message}`); }\n  ab.disabled = false;\n});\nroot.createEl(\"h4\", { text: \"Calendar files (.ics in the vault)\" });\nconst files = app.vault.getFiles().filter(f => f.extension === \"ics\" && !f.path.startsWith(\".trash/\"));\nif (!files.length) root.createEl(\"p\", { text: \"No .ics files in the vault yet. Put one anywhere in the vault (for example in this folder) and reopen this note.\" });\nfor (const f of files) {\n  const row = root.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;align-items:center;margin:6px 0\" } });\n  row.createEl(\"span\", { text: f.path, attr: { style: \"flex:1\" } });\n  const b = row.createEl(\"button\", { text: \"Import\" });\n  b.addEventListener(\"click\", async () => {\n    try { const r = await importFile(f); notify(`Imported ${r.count} events into ${r.target}`); b.setText(`Imported ${r.count}`); }\n    catch (e) { console.error(e); notify(`Could not import ${f.path}: ${e.message}`); }\n  });\n}\n",
  "capture": "// Typed quick capture. Usage: await dv.view(\"Meta/views/capture\")\n// Type a task the way you would say it; the words that mean a date, time, length, priority, project, person,\n// price or repeat become Obsidian Tasks fields, and the rest is the task text. A live preview shows the line\n// before it is written. Tasks go to 08 Tasks/Tasks.md under ## Inbox, or into a project note under ## Inline tasks.\nconst INBOX = { path: \"08 Tasks/Tasks.md\", heading: \"## Inbox\" };\n// On an area tab (Work, Study, Personal, or one you added) a task gets that area's tag unless you typed another area or it goes into\n// a project note that has its own area property.\nconst AREA_KEYS = app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst TAB_AREA = AREA_KEYS.includes(input?.area) ? input.area : null;\nconst PROJECT_HEADING = \"## Inline tasks\";\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));\n\n// ---------- dates ----------\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };\nconst today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };\nconst dmy = s => `${new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { weekday: \"short\" })} ${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;\nconst clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;\nconst DAYS = [\"sunday\", \"monday\", \"tuesday\", \"wednesday\", \"thursday\", \"friday\", \"saturday\"];\nconst dayIndex = w => DAYS.findIndex(d => w.length >= 3 && d.startsWith(w));\nconst slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/(^-|-$)/g, \"\");\n\n// ---------- notes the @ and + words can point at ----------\nconst notesOf = (pred) => dv.pages().where(p => !/^(Templates|\\.trash|scripts|wiki)\\//.test(p.file.path) && !(p.file.tags ?? []).includes(\"#example\") && pred(p)).array()\n  .map(p => ({ name: p.file.name, path: p.file.path, slug: slug(p.file.name) }));\nconst PROJECTS = notesOf(p => String(p.type ?? \"\") === \"project\");\nconst PEOPLE = notesOf(p => p.file.path.startsWith(\"05 People/\"));\nconst match = (list, word) => { const w = slug(word); return list.find(n => n.slug === w) || list.find(n => n.slug.startsWith(w)) || list.find(n => n.slug.includes(w)) || null; };\n\n// ---------- the parser ----------\n// Returns the parts it understood and the task line it would write. Words in \"quotes\" are always kept as text.\nfunction parse(input) {\n  const out = { text: [], tags: [], fields: [], warnings: [] };\n  // the syntax the task line uses is understood too: ⏳ 2026-10-30, 📅, 🛫, ⏫ 🔺 🔽, 🔁 every week, 10:00 - 11:00\n  const PRI_EMOJI = { \"🔺\": \"!!\", \"⏫\": \"!\", \"🔼\": \"!med\", \"🔽\": \"!low\", \"⏬\": \"!lowest\" }, DATE_EMOJI = { \"⏳\": \"do\", \"📅\": \"due\", \"🛫\": \"start\" };\n  input = input\n    .replace(/(^|\\s)(\\d{1,2}:\\d{2})\\s+-\\s+(\\d{1,2}:\\d{2})(?=\\s|$)/g, \"$1$2-$3\")\n    .replace(/(⏳|📅|🛫)\\uFE0F?\\s*(\\d{4})-(\\d{2})-(\\d{2})/gu, (all, e, y, m, d) => ` ${DATE_EMOJI[e]} ${d}-${m}-${y} `)\n    .replace(/🔁\\uFE0F?\\s*/gu, \" \")\n    .replace(/[🔺⏫🔼🔽⏬]\\uFE0F?/gu, e => ` ${PRI_EMOJI[e.replace(/\\uFE0F/, \"\")]} `);\n  // fields typed the Dataview way: \"price:: 12\", \"shop:: ikea\", \"[est:: 1h]\"; price, qty and est are read as below\n  input = input.replace(/\\[([\\w-]+)::\\s*([^\\]]*)\\]|(?<![\\w\"])([\\w-]+)::\\s*(\"[^\"]*\"|\\S+)/g, (all, k1, v1, k2, v2) => {\n    const k = (k1 || k2).toLowerCase(), v = (v1 ?? v2).replace(/^\"|\"$/g, \"\").trim();\n    if ([\"price\", \"qty\", \"est\"].includes(k)) return ` ${k} ${v} `;\n    if (v) out.fields.push(`[${k}:: ${v}]`);\n    return \" \";\n  });\n  const toks = (input.match(/\"[^\"]*\"|\\S+/g) || []);\n  const base = today();\n  const low = i => (toks[i] || \"\").toLowerCase().replace(/[,;]$/, \"\").replace(/\\.$/, \"\");\n  // a date starting at toks[i]: [isoDate, tokensUsed] or null. loose = after a word like due, do or start, where\n  // short forms such as \"1-3\" and \"sun\" are dates too; on their own they stay text\n  const dateAt = (i, loose) => {\n    const w = low(i), w2 = low(i + 1);\n    if ([\"today\", \"tonight\"].includes(w)) return [iso(base), 1];\n    if ([\"tomorrow\", \"tmr\", \"tmrw\"].includes(w)) return [iso(addDays(base, 1)), 1];\n    const toNextMonday = ((8 - base.getDay()) % 7) || 7;\n    if (w === \"next\" && w2 === \"week\") return [iso(addDays(base, toNextMonday)), 2];\n    // \"fri\" is the coming Friday; \"next fri\" is Friday of next week (weeks start on Monday)\n    if (w === \"next\" && dayIndex(w2) >= 0) return [iso(addDays(base, toNextMonday + (dayIndex(w2) + 6) % 7)), 2];\n    // \"sun\" is also an everyday word, so on its own only \"sunday\" counts\n    if (dayIndex(w) >= 0 && /^[a-z]+$/.test(w) && (loose || w !== \"sun\")) return [iso(addDays(base, (dayIndex(w) - base.getDay() + 7) % 7 || 7)), 1];\n    if (w === \"in\" && /^\\d+$/.test(w2)) { const u = low(i + 2); const k = /^days?$/.test(u) ? 1 : /^weeks?$/.test(u) ? 7 : /^months?$/.test(u) ? 30 : 0; if (k) return [iso(addDays(base, Number(w2) * k)), 3]; }\n    const m = w.match(/^(\\d{1,2})[-/.](\\d{1,2})(?:[-/.](\\d{2,4}))?$/);\n    // on its own \"1-3\" is a range (\"chapters 1-3\"); a date needs a year or a two-digit day or month, like 24-10 or 01-03\n    if (m && (loose || m[3] || m[1].length === 2 || m[2].length === 2) && !(m[3] === undefined && w.includes(\".\"))) {\n      let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();\n      let d = new Date(y, Number(m[2]) - 1, Number(m[1]), 12);\n      if (d.getMonth() !== Number(m[2]) - 1) return null;\n      if (!m[3] && d < base) d = new Date(y + 1, Number(m[2]) - 1, Number(m[1]), 12);\n      return [iso(d), 1];\n    }\n    return null;\n  };\n  // a clock time: 14:00, 9:30, 2pm, 2:30pm; bare = also a plain hour like \"14\" or \"5\" (after \"at\", \"from\", \"to\")\n  const clockOf = (s, bare) => {\n    const m = String(s).toLowerCase().match(/^(\\d{1,2})(?::(\\d{2}))?(am|pm)?$/);\n    if (!m || (!m[2] && !m[3] && !bare)) return null;\n    let hh = Number(m[1]); const mm = Number(m[2] || 0);\n    if (m[3]) { if (hh < 1 || hh > 12) return null; hh = hh % 12 + (m[3] === \"pm\" ? 12 : 0); }\n    else if (bare && !m[2] && hh >= 1 && hh <= 6) hh += 12; // \"at 5\" means 17:00\n    return hh < 24 && mm < 60 ? hh * 60 + mm : null;\n  };\n  // a length starting at toks[i]: [minutes, tokensUsed]. 30m, 1h, 1h30, 1.5h, 90min, \"2 h\", \"45 min\", \"1 hour\"\n  const lenAt = i => {\n    const w = low(i), m = w.match(/^(\\d+(?:[.,]\\d+)?)(?:h|hr|hrs|hours?)(?:(\\d{1,2})m?)?$|^(\\d+)(?:m|min|mins|minutes?)$/);\n    if (m) return [m[3] ? Number(m[3]) : Math.round(parseFloat(m[1].replace(\",\", \".\")) * 60 + Number(m[2] || 0)), 1];\n    if (/^\\d+(?:[.,]\\d+)?$/.test(w)) {\n      const u = low(i + 1), n = parseFloat(w.replace(\",\", \".\"));\n      if (/^(h|hr|hrs|hours?)$/.test(u)) return [Math.round(n * 60), 2];\n      if (/^(m|min|mins|minutes?)$/.test(u)) return [Math.round(n), 2];\n    }\n    return null;\n  };\n  // a price starting at toks[i]: [amount, tokensUsed]. €12, 12€, 12 eur, 12eur, eur 12, 12.50, 12,50, $12, price 12\n  const NUM = \"(\\\\d+(?:[.,]\\\\d{1,2})?)\", CUR = \"(?:€|\\\\$|£|eur|euro|euros|usd|gbp)\";\n  const priceAt = (i, loose) => {\n    const w = low(i);\n    let m = w.match(new RegExp(`^${CUR}${NUM}$|^${NUM}${CUR}$`));\n    if (m) return [m[1] || m[2], 1];\n    if (new RegExp(`^${NUM}$`).test(w) && new RegExp(`^${CUR}$`).test(low(i + 1))) return [w, 2];\n    if (new RegExp(`^${CUR}$`).test(w) && new RegExp(`^${NUM}$`).test(low(i + 1))) return [low(i + 1), 2];\n    if (loose && new RegExp(`^${NUM}$`).test(w)) return [w, 1];\n    if (/^\\d+[.,]\\d{2}$/.test(w)) return [w, 1]; // 12.50: two decimals is always money\n    return null;\n  };\n  const PRI = { \"!!!\": \"🔺\", \"!!\": \"🔺\", \"!urgent\": \"🔺\", \"!highest\": \"🔺\", \"!\": \"⏫\", \"!high\": \"⏫\", \"!med\": \"🔼\", \"!medium\": \"🔼\", \"!low\": \"🔽\", \"!lowest\": \"⏬\" };\n  const PRIW = { urgent: \"🔺\", highest: \"🔺\", high: \"⏫\", med: \"🔼\", medium: \"🔼\", normal: \"\", low: \"🔽\", lowest: \"⏬\" };\n  const DO = [\"do\", \"on\", \"plan\", \"sched\", \"scheduled\"], DUE = [\"by\", \"due\", \"before\", \"deadline\"], START = [\"start\", \"starts\", \"from\"];\n  const UNIT = /^(day|week|month|year|weekday|days|weeks|months|years)$/;\n  let lastLen = false;\n  for (let i = 0; i < toks.length; i++) {\n    const raw = toks[i], w = low(i), n1 = low(i + 1), n2 = low(i + 2);\n    const wasLen = lastLen; lastLen = false;\n    if (/^\".*\"$/.test(raw)) { out.text.push(raw.slice(1, -1)); continue; }\n    // dates after a word: \"do fri\" (⏳), \"due 24-10\" / \"by fri\" (📅), \"start 1-11\" (🛫)\n    const kd = DO.includes(w) ? \"date\" : DUE.includes(w) ? \"due\" : START.includes(w) ? \"startDate\" : null;\n    if (kd && dateAt(i + 1, true)) { const [d, n] = dateAt(i + 1, true); out[kd] = d; i += n; continue; }\n    // repeat: \"every week\", \"every 2 days\", \"every monday\", \"every weekday\"\n    if (w === \"every\" && (UNIT.test(n1) || dayIndex(n1) >= 0 && /^[a-z]+$/.test(n1))) { out.repeat = `every ${dayIndex(n1) >= 0 ? DAYS[dayIndex(n1)] : n1}`; i += 1; continue; }\n    if (w === \"every\" && /^\\d+$/.test(n1) && UNIT.test(n2)) { out.repeat = `every ${n1} ${n2}`; i += 2; continue; }\n    // time: 14:00, 2pm, 9:30-11, 2-4pm, \"at 14\", \"from 9 to 11\", \"until 16:00\"\n    if ([\"at\", \"from\"].includes(w) && /^[\\d:]+(am|pm)?-[\\d:]+(am|pm)?$/.test(n1) && /:|am|pm/.test(n1)) continue; // \"at 14:30-15\"\n    const rg = w.match(/^([\\d:]+(?:am|pm)?)-([\\d:]+(?:am|pm)?)$/);\n    if (rg) {\n      const sfx = (rg[2].match(/(am|pm)$/) || [\"\"])[0];\n      let a = clockOf(rg[1], !!sfx) ?? null, b = clockOf(rg[2], true);\n      if (sfx && !/(am|pm)$/.test(rg[1])) { const a2 = clockOf(rg[1] + sfx, false); if (a2 !== null && a2 < b) a = a2; }\n      if (a !== null && b !== null && (/:|am|pm/.test(rg[1]) || sfx)) { out.start = a; out.end = b; continue; }\n    }\n    let t = clockOf(w, false), used = 0;\n    if (t === null && [\"at\", \"from\"].includes(w) && clockOf(n1, true) !== null) { t = clockOf(n1, true); used = 1; }\n    if (t !== null) {\n      out.start = t; i += used;\n      if ([\"to\", \"until\", \"till\"].includes(low(i + 1)) && clockOf(low(i + 2), true) !== null) { out.end = clockOf(low(i + 2), true); i += 2; }\n      continue;\n    }\n    if ([\"until\", \"till\"].includes(w) && out.start !== undefined && clockOf(n1, true) !== null) { out.end = clockOf(n1, true); i++; continue; }\n    // length: 30m, 1h30, \"2 h\", \"45 min\"; \"1h 30m\" adds up; \"for 2 h\" and \"est 2h\" too\n    const lk = [\"for\", \"est\", \"takes\"].includes(w) && lenAt(i + 1) ? 1 : 0;\n    const ln = lenAt(i + lk);\n    if (ln) { out.est = (wasLen ? out.est || 0 : 0) + ln[0]; i += lk + ln[1] - 1; lastLen = true; continue; }\n    // priority: !, !!, !low, or \"prio high\", \"priority low\"\n    if (PRI[w]) { out.pri = PRI[w]; continue; }\n    if ([\"prio\", \"priority\"].includes(w) && n1 in PRIW) { out.pri = PRIW[n1]; i++; continue; }\n    // project and person: @cpmx, +alex, or \"project cpmx\" and \"with alex\" when such a note exists\n    if (/^@[\\w-]+$/.test(raw)) { const p = match(PROJECTS, raw.slice(1)); out.project = p || { name: raw.slice(1), slug: slug(raw.slice(1)), path: null }; if (!p) out.warnings.push(`No project note matches \"${raw.slice(1)}\": the task gets the tag and goes to the inbox.`); continue; }\n    if (w === \"project\" && n1 && match(PROJECTS, n1)) { out.project = match(PROJECTS, n1); i++; continue; }\n    if (/^\\+[\\w-]+$/.test(raw)) { const p = match(PEOPLE, raw.slice(1)); out.person = p || { name: raw.slice(1), slug: slug(raw.slice(1)) }; if (!p) out.warnings.push(`No person note matches \"${raw.slice(1)}\".`); continue; }\n    if (w === \"with\" && n1.length >= 3 && PEOPLE.find(n => n.slug === slug(n1) || n.slug.startsWith(`${slug(n1)}-`))) { out.person = PEOPLE.find(n => n.slug === slug(n1) || n.slug.startsWith(`${slug(n1)}-`)); out.text.push(raw, toks[i + 1]); i++; continue; } // \"Lunch with Alex\" keeps its words\n    // area: #work, or \"area work\"\n    if (w === \"area\" && AREA_KEYS.includes(n1)) { out.tags.push(`#${n1}`); i++; continue; }\n    // price and quantity: €12, 12 eur, price 12, 12.50; x3, 3x, qty 3, 3 pcs\n    const pk = [\"price\", \"cost\", \"costs\"].includes(w) && priceAt(i + 1, true) ? 1 : 0;\n    const pr = priceAt(i + pk, pk === 1);\n    if (pr) { out.price = String(pr[0]).replace(\",\", \".\"); i += pk + pr[1] - 1; continue; }\n    const q = w.match(/^x(\\d+)$|^(\\d+)x$/);\n    if (q) { out.qty = q[1] || q[2]; continue; }\n    if ([\"qty\", \"quantity\"].includes(w) && /^\\d+$/.test(n1)) { out.qty = n1; i++; continue; }\n    if (/^\\d+$/.test(w) && /^(pcs|pieces?|pack|packs)$/.test(n1)) { out.qty = w; i++; continue; }\n    // a date on its own: today, fri, next mon, in 3 days, 24-10 (writes ⏳)\n    const d = dateAt(i, false);\n    if (d) { out.date = d[0]; i += d[1] - 1; continue; }\n    // the tags the task line uses for a project and a person route the task the same way as @ and +\n    if (/^#project\\/[\\w-]+$/.test(raw)) { const p = match(PROJECTS, raw.slice(9)); out.project = p || { name: raw.slice(9), slug: slug(raw.slice(9)), path: null }; if (!p) out.warnings.push(`No project note matches \"${raw.slice(9)}\": the task gets the tag and goes to the inbox.`); continue; }\n    if (/^#p\\/[\\w-]+$/.test(raw)) { const p = match(PEOPLE, raw.slice(3)); out.person = p || { name: raw.slice(3), slug: slug(raw.slice(3)) }; continue; }\n    if (/^#[\\w/-]+$/.test(raw)) { out.tags.push(raw); continue; }\n    out.text.push(raw);\n  }\n  // the Tasks plugin needs a date to repeat from\n  if (out.repeat && !out.date && !out.due) out.date = iso(base);\n  if (out.start !== undefined) {\n    if (!out.date) out.date = iso(base);\n    if (out.end === undefined) out.end = out.start + (out.est || 30);\n    if (out.end <= out.start) out.warnings.push(\"The end time is before the start time.\");\n  }\n  const title = out.text.join(\" \").trim();\n  if (!title) out.warnings.push(\"The task has no text yet.\");\n  const bits = [];\n  if (out.start !== undefined) bits.push(`${clock(out.start)} - ${clock(out.end)}`);\n  bits.push(title);\n  const typedArea = out.tags.some(t => AREA_KEYS.includes(t.slice(1).toLowerCase()));\n  const projectArea = out.project?.path ? String(dv.page(out.project.path)?.area ?? \"\").toLowerCase() : \"\";\n  if (TAB_AREA && !typedArea && !AREA_KEYS.includes(projectArea)) out.tags.push(`#${TAB_AREA}`);\n  bits.push(...out.tags);\n  if (out.project) bits.push(`#project/${out.project.slug}`);\n  if (out.person) bits.push(`#p/${out.person.slug}`);\n  if (out.est) bits.push(`[est:: ${out.est >= 60 ? `${Math.floor(out.est / 60)}h${out.est % 60 ? ` ${out.est % 60}m` : \"\"}` : `${out.est}m`}]`);\n  if (out.price) bits.push(`[price:: ${out.price}]`);\n  if (out.qty) bits.push(`[qty:: ${out.qty}]`);\n  bits.push(...out.fields);\n  // a study task is 🔺 highest unless you gave it a priority (\"prio normal\" keeps it without one)\n  const isStudy = out.tags.some(t => t.toLowerCase() === \"#study\") || (!typedArea && projectArea === \"study\");\n  if (out.pri === undefined && isStudy) out.pri = \"🔺\";\n  if (out.pri) bits.push(out.pri);\n  if (out.repeat) bits.push(`🔁 ${out.repeat}`);\n  // the Tasks plugin only repeats a task that has a date, so a repeat without one starts on its first day\n  // and a repeat on a weekday starts on the first such day (a time alone means today, which may be the wrong day)\n  if (out.repeat && !out.due) {\n    const d = out.date ? new Date(`${out.date}T12:00:00`) : new Date(base), wd = DAYS.findIndex(x => out.repeat === `every ${x}`);\n    if (wd >= 0) d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));\n    else if (out.repeat === \"every weekday\") while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);\n    out.date = iso(d);\n  }\n  bits.push(`➕ ${iso(base)}`);\n  if (out.startDate) bits.push(`🛫 ${out.startDate}`);\n  if (out.date) bits.push(`⏳ ${out.date}`);\n  if (out.due) bits.push(`📅 ${out.due}`);\n  out.title = title;\n  out.line = `- [ ] ${bits.filter(Boolean).join(\" \")}`;\n  out.target = out.project?.path ? { path: out.project.path, heading: PROJECT_HEADING, label: `${out.project.name} › Inline tasks` } : { ...INBOX, label: \"Tasks › Inbox\" };\n  return out;\n}\n\n// ---------- writing ----------\nasync function append(target, lines) {\n  let file = app.vault.getAbstractFileByPath(target.path);\n  if (!file) { notify(`Note not found: ${target.path}`); return false; }\n  await app.vault.process(file, data => {\n    const L = data.split(\"\\n\");\n    let h = L.findIndex(l => l.trim() === target.heading);\n    if (h < 0) { while (L.length && L[L.length - 1].trim() === \"\") L.pop(); L.push(\"\", target.heading); h = L.length - 1; }\n    const level = target.heading.match(/^#+/)[0].length;\n    let end = L.length;\n    for (let i = h + 1; i < L.length; i++) { const m = L[i].match(/^(#+)\\s/); if (m && m[1].length <= level) { end = i; break; } }\n    let at = end;\n    while (at > h + 1 && (L[at - 1].trim() === \"\" || /^\\s*[-*+] \\[ \\]\\s*$/.test(L[at - 1]))) at--;\n    L.splice(at, 0, ...lines);\n    return L.join(\"\\n\");\n  });\n  return true;\n}\n\n// ---------- page ----------\nfunction h(tag, attrs = {}, parent, text) {\n  const el = document.createElement(tag);\n  for (const [k, v] of Object.entries(attrs)) { if (k === \"class\") el.className = v; else if (k === \"style\") el.style.cssText = v; else el.setAttribute(k, v); }\n  if (text !== undefined) el.textContent = text;\n  if (parent) parent.appendChild(el);\n  return el;\n}\nconst KEEP = (window.__compassCapture ??= { draft: \"\", added: [] });\nconst root = h(\"div\", { class: \"qc\" }, dv.container);\nh(\"style\", {}, root, `\n.qc { font-size: 13px; }\n.qc textarea { width: 100%; min-height: 2.6em; font-size: 15px; padding: 8px 10px; border-radius: 8px; resize: vertical; box-sizing: border-box; }\n.qc-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 6px 0; }\n.qc-chip { font-size: 11px; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); }\n.qc-chip b { font-weight: 600; }\n.qc-line { font-family: var(--font-monospace); font-size: 11px; color: var(--text-muted); overflow-wrap: anywhere; margin: 4px 0; }\n.qc-warn { color: var(--color-orange); font-size: 12px; }\n.qc-help { font-size: 12px; color: var(--text-muted); }\n.qc-help code { font-size: 11px; }\n.qc-props { border-collapse: collapse; width: 100%; margin: 6px 0; }\n.qc-props th, .qc-props td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid var(--background-modifier-border); }\n.qc-props code { white-space: nowrap; line-height: 2; margin: 0 4px 0 0; padding: 1px 5px; border-radius: 4px; background: var(--code-background, var(--background-secondary)); }\n.qc-props td:first-child { width: 8em; } .qc-props td:last-child { width: 30%; }\n.qc-ins { cursor: pointer; } .qc-ins:hover, .qc-ins:focus-visible { color: var(--text-accent); outline: 1px solid var(--interactive-accent); }\n.qc-note { color: var(--text-faint); }\n.qc-props { table-layout: fixed; } .qc-props td { overflow-wrap: anywhere; } .qc-props code.qc-ins { display: inline-block; white-space: normal; } .qc-props td:last-child .qc-note { display: block; font-size: 11px; }\n@media (max-width: 560px) { .qc-props, .qc-props tbody { display: block; table-layout: auto; } .qc-props colgroup, .qc-props thead { display: none; } .qc-props tr { display: block; padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border); } .qc-props td, .qc-props td:first-child, .qc-props td:last-child { display: block; width: auto; border: 0; padding: 1px 0; } .qc-props td:last-child::before { content: \"writes \"; color: var(--text-faint); } }\n.qc-added { font-size: 12px; margin: 2px 0; cursor: pointer; }\n.qc-added:hover { color: var(--text-accent); }\n`);\nconst ta = h(\"textarea\", { placeholder: \"e.g. Call the dentist fri 14:00 30m !\", rows: \"1\", \"aria-label\": \"Type a task\" }, root);\nta.value = KEEP.draft;\nconst preview = h(\"div\", {}, root);\nconst bar = h(\"div\", { class: \"qc-row\" }, root);\nconst add = h(\"button\", { class: \"mod-cta\" }, bar, \"Add\");\nh(\"span\", { class: \"qc-help\" }, bar, \"Enter adds · Shift+Enter for another task on a new line\");\nconst help = h(\"details\", { class: \"qc-help\" }, root);\nh(\"summary\", {}, help, \"Available properties\");\nh(\"p\", { style: \"margin:4px 0\" }, help, \"Type the words, or click any example to put it in the box. Both ways end up as the syntax on the right.\");\n// one row per property: what it is, what you can type (no special keys needed), the syntax it writes in the task line.\n// An example is [shown text, text to insert]; a string inserts itself.\nconst TOMORROW_ISO = iso(addDays(today(), 1));\nconst ROWS = [\n  [\"Do on (plan)\", [\"today\", \"tomorrow\", \"fri\", \"next mon\", \"in 3 days\", \"24-10\", \"do 1-11\"], \"\", [`⏳ ${TOMORROW_ISO}`], \"scheduled\"],\n  [\"Deadline\", [\"due fri\", \"by 24-10\", \"deadline 1-11-2026\"], \"\", [`📅 ${TOMORROW_ISO}`], \"due\"],\n  [\"Start\", [\"start mon\", \"from 24-10\"], \"hidden until then\", [`🛫 ${TOMORROW_ISO}`], \"start\"],\n  [\"Time\", [\"14:00\", \"2pm\", \"9:30-11\", \"2-4pm\", \"at 14\", \"from 9 to 11\"], \"\", [\"10:00 - 11:00\"], \"at the start; today if no day\"],\n  [\"Length\", [\"30m\", \"1h30\", \"2 h\", \"45 min\", \"for 1 hour\"], \"\", [\"[est:: 30m]\"], \"\"],\n  [\"Priority\", [[\"!\", \"!\"], [\"!!\", \"!!\"], \"!low\", \"prio high\", \"prio low\"], \"! high, !! urgent\", [\"🔺\", \"⏫\", \"🔼\", \"🔽\", \"⏬\"], \"urgent to lowest\"],\n  [\"Price\", [\"12 eur\", \"price 12\", \"12.50\", \"12,50\", \"€12\"], \"price of one\", [[\"[price:: 12]\", \"[price:: ]\"]], \"\"],\n  [\"Quantity\", [\"x3\", \"qty 3\", \"3 pcs\"], \"\", [[\"[qty:: 3]\", \"[qty:: ]\"]], \"\"],\n  [\"Project\", [[\"@name\", \"@\"], [\"project name\", \"project \"]], \"a project note's name\", [[\"#project/name\", \"#project/\"]], \"and goes into that note\"],\n  [\"Person\", [[\"+name\", \"+\"], [\"with name\", \"with \"]], \"keeps the words\", [[\"#p/name\", \"#p/\"]], \"\"],\n  [\"Area\", [...AREA_KEYS.map(k => `#${k}`), `area ${AREA_KEYS[0] || \"work\"}`], \"\", AREA_KEYS.map(k => `#${k}`), \"\"],\n  [\"Repeat\", [\"every week\", \"every 2 days\", \"every monday\", \"every weekday\"], \"\", [\"🔁 every week\"], \"\"],\n  [\"Your own field\", [[\"shop:: ikea\", \"shop:: \"], [\"link:: https://…\", \"link:: https://\"]], \"any name you make up, then :: and the value\", [[\"[shop:: ikea]\", \"[shop:: ]\"], [\"[link:: https://…]\", \"[link:: https://]\"]], \"the purchases list shows and sorts by them\"],\n];\n// put text into the box at the cursor; the cursor lands where the value goes (in [price:: ] before the ], on a date: the date selected)\nfunction insert(text) {\n  const s0 = ta.selectionStart ?? ta.value.length, e0 = ta.selectionEnd ?? s0;\n  const before = ta.value.slice(0, s0), after = ta.value.slice(e0);\n  const open = /::/.test(text) && text.endsWith(\"]\");\n  const glue = /[@+/]$|:: (https:\\/\\/)?$|\\s$/.test(text); // the value is typed right after it\n  const pre = before && !/\\s$/.test(before) ? \" \" : \"\", post = glue || /^\\s/.test(after) ? \"\" : \" \";\n  ta.value = before + pre + text + post + after;\n  const at = before.length + pre.length, d = text.match(/\\d{4}-\\d{2}-\\d{2}/);\n  let cs, ce;\n  if (open) cs = ce = at + text.length - 1; // inside [name:: ]\n  else if (d) { cs = at + d.index; ce = cs + 10; }\n  else cs = ce = at + text.length + post.length;\n  ta.focus(); ta.setSelectionRange(cs, ce); grow(); showPreview();\n}\nconst codes = (parent, list) => {\n  for (const ex of list) {\n    const [shown, ins] = Array.isArray(ex) ? ex : [ex, ex];\n    const c = h(\"code\", { class: \"qc-ins\", role: \"button\", tabindex: \"0\", title: `Click to add ${ins.trim() || shown}` }, parent, shown);\n    c.addEventListener(\"mousedown\", e => e.preventDefault()); // keep the cursor where it is in the box\n    c.addEventListener(\"click\", () => insert(ins));\n    c.addEventListener(\"keydown\", e => { if (e.key === \"Enter\" || e.key === \" \") { e.preventDefault(); insert(ins); } });\n  }\n};\nconst tbl = h(\"table\", { class: \"qc-props\" }, help);\nconst cg = h(\"colgroup\", {}, tbl); h(\"col\", { style: \"width:7.5em\" }, cg); h(\"col\", {}, cg); h(\"col\", { style: \"width:34%\" }, cg);\nconst hr = h(\"tr\", {}, h(\"thead\", {}, tbl));\nfor (const t of [\"Property\", \"Type\", \"Writes (syntax)\"]) h(\"th\", {}, hr, t);\nconst tb = h(\"tbody\", {}, tbl);\nfor (const [name, typed, typedNote, syntax, syntaxNote] of ROWS) {\n  const tr = h(\"tr\", {}, tb);\n  h(\"b\", {}, h(\"td\", {}, tr), name);\n  const t1 = h(\"td\", {}, tr); codes(t1, typed); if (typedNote) h(\"span\", { class: \"qc-note\" }, t1, ` ${typedNote}`);\n  const t2 = h(\"td\", {}, tr); codes(t2, syntax); if (syntaxNote) h(\"span\", { class: \"qc-note\" }, t2, ` ${syntaxNote}`);\n}\nhelp.insertAdjacentHTML(\"beforeend\", `<p>Words in \"quotes\" always stay text, for example <code>\"Friday meeting notes\"</code>. On their own, <code>1-3</code> and <code>sun</code> stay text; write <code>do 1-3</code> or <code>on sun</code> for a date. To change a task later, right-click it in the planner (on a phone: press and hold it, then let go) and pick <b>Edit task</b>, or put the cursor on it in a note and run <b>Tasks: Create or edit task</b>. Its Fields section sets the length, price, shop, link and your own fields.</p>`);\nconst addedBox = h(\"div\", {}, root);\n\nconst linesOf = () => ta.value.split(\"\\n\").map(s => s.trim()).filter(Boolean);\nfunction showPreview() {\n  KEEP.draft = ta.value;\n  preview.replaceChildren();\n  for (const text of linesOf()) {\n    const p = parse(text);\n    const row = h(\"div\", { class: \"qc-row\" }, preview);\n    const chip = (k, v) => { const c = h(\"span\", { class: \"qc-chip\" }, row); h(\"b\", {}, c, `${k} `); c.appendChild(document.createTextNode(v)); };\n    if (p.startDate) chip(\"Start\", dmy(p.startDate));\n    if (p.date) chip(\"Do\", dmy(p.date));\n    if (p.start !== undefined) chip(\"Time\", `${clock(p.start)} - ${clock(p.end)}`);\n    if (p.due) chip(\"Due\", dmy(p.due));\n    if (p.est) chip(\"Length\", p.est >= 60 ? `${Math.floor(p.est / 60)}h${p.est % 60 ? ` ${p.est % 60}m` : \"\"}` : `${p.est}m`);\n    if (p.pri) chip(\"Priority\", p.pri);\n    if (p.project) chip(\"Project\", p.project.name);\n    if (p.person) chip(\"Person\", p.person.name);\n    if (p.price) chip(\"Price\", `€${p.price}${p.qty ? ` x${p.qty}` : \"\"}`);\n    else if (p.qty) chip(\"Qty\", p.qty);\n    if (p.repeat) chip(\"Repeats\", p.repeat);\n    for (const f of p.fields) chip(\"Field\", f.slice(1, -1));\n    chip(\"Goes to\", p.target.label);\n    h(\"div\", { class: \"qc-line\" }, preview, p.line);\n    for (const w of p.warnings) h(\"div\", { class: \"qc-warn\" }, preview, w);\n  }\n  add.disabled = !linesOf().length;\n}\nasync function commit() {\n  const parsed = linesOf().map(parse).filter(p => p.title);\n  if (!parsed.length) return;\n  const groups = new Map();\n  for (const p of parsed) { const k = `${p.target.path}|${p.target.heading}`; if (!groups.has(k)) groups.set(k, { target: p.target, items: [] }); groups.get(k).items.push(p); }\n  for (const { target, items } of groups.values()) {\n    if (await append(target, items.map(p => p.line))) for (const p of items) KEEP.added.unshift({ title: p.title, path: target.path, label: target.label });\n  }\n  KEEP.added = KEEP.added.slice(0, 5);\n  notify(parsed.length === 1 ? `Added to ${parsed[0].target.label}` : `Added ${parsed.length} tasks`);\n  ta.value = \"\"; KEEP.draft = \"\";\n  grow(); showPreview(); showAdded(); ta.focus();\n}\nfunction showAdded() {\n  addedBox.replaceChildren();\n  if (!KEEP.added.length) return;\n  h(\"div\", { class: \"qc-help\", style: \"margin-top:6px\" }, addedBox, \"Just added (click to open):\");\n  for (const a of KEEP.added) h(\"div\", { class: \"qc-added\" }, addedBox, `✓ ${a.title}  →  ${a.label}`).addEventListener(\"click\", () => app.workspace.openLinkText(a.path, \"\", false));\n}\nconst grow = () => { ta.style.height = \"auto\"; ta.style.height = `${ta.scrollHeight + 2}px`; };\nta.addEventListener(\"input\", () => { grow(); showPreview(); });\nta.addEventListener(\"keydown\", ev => { if (ev.key === \"Enter\" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void commit(); } });\nadd.addEventListener(\"click\", () => void commit());\n// EX3C Agenda and Dataview redraw this box after every note change; if you were typing in it, keep typing.\nta.addEventListener(\"focus\", () => { KEEP.focused = true; });\nta.addEventListener(\"blur\", () => setTimeout(() => { if (ta.isConnected) KEEP.focused = false; }, 0)); // a redraw removes the box: not a real blur\nif (KEEP.focused) setTimeout(() => { if (ta.isConnected) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 0);\ngrow(); showPreview(); showAdded();\nwindow.__compassCaptureParse = parse; // for tests\n",
  "checklists": "// Reusable checklists. Usage: await dv.view(\"Meta/views/checklists\", { folder: \"09 Checklists\" })\n// A checklist is a note with type: checklist. Tick items in the note (or here); Reset unticks every item for next time.\n// Resetting writes several lines, so it asks first (count and list) and can be undone.\nconst FOLDER = input?.folder ?? \"09 Checklists\";\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));\nconst BOX = /^(\\s*[-*+] )\\[([^\\]])\\]( .*)?$/;\nconst UNDO = (window.__ex3cChecklistUndo ??= {});\nconst dmy = s => (s ? moment(s, [\"YYYY-MM-DD HH:mm\", \"YYYY-MM-DD\"]).format(\"DD-MM-YYYY HH:mm\") : \"never\");\nconst lists = () => dv.pages().where(p => String(p.type ?? \"\") === \"checklist\" && !p.file.path.startsWith(\"Templates/\") && !p.file.path.startsWith(\".trash/\")).sort(p => p.file.name).array();\nfunction confirmBox(title, lines, yesText) {\n  return new Promise(resolve => {\n    const back = document.body.createEl(\"div\", { attr: { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" } });\n    const card = back.createEl(\"div\", { attr: { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:520px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" } });\n    card.createEl(\"div\", { text: `${title}?`, attr: { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" } });\n    const ul = card.createEl(\"ul\", { attr: { style: \"max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px\" } });\n    for (const l of lines) ul.createEl(\"li\", { text: l });\n    card.createEl(\"div\", { text: \"You can undo this right after with Undo on the checklist's card.\", attr: { style: \"color:var(--text-muted);font-size:12px;margin:6px 0 10px\" } });\n    const row = card.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;justify-content:flex-end\" } });\n    const no = row.createEl(\"button\", { text: \"Cancel\" }), yes = row.createEl(\"button\", { text: yesText, cls: \"mod-cta\" });\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(false); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(false)); yes.addEventListener(\"click\", () => done(true));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(false); });\n    yes.focus();\n  });\n}\n// the note's checkbox lines, read fresh from the file (Dataview's cache can lag a tick behind)\nasync function items(path) {\n  const f = app.vault.getAbstractFileByPath(path);\n  const text = f ? await app.vault.cachedRead(f) : \"\";\n  const body = text.replace(/^---\\n[\\s\\S]*?\\n---\\n?/, \"\");\n  const off = text.length - body.length ? text.slice(0, text.length - body.length).split(\"\\n\").length - 1 : 0;\n  const lr = text.match(/^---\\n[\\s\\S]*?^last_reset:[ \\t]*[\"']?([^\"'\\n]*)/m)?.[1]?.trim() || null;\n  const out = body.split(\"\\n\").map((l, i) => { const m = l.match(BOX); return m ? { line: i + off, raw: l, done: m[2] !== \" \", text: (m[3] ?? \"\").trim(), depth: (l.match(/^\\s*/)[0].replace(/ {4}/g, \"\\t\").length) } : null; }).filter(Boolean);\n  out.lastReset = lr;\n  return out;\n}\nasync function reset(p) {\n  const its = await items(p.file.path), ticked = its.filter(x => x.done);\n  if (!ticked.length) return notify(`${p.file.name}: nothing ticked.`);\n  if (ticked.length > 1 && !(await confirmBox(`Reset ${p.file.name}: untick ${ticked.length} items`, ticked.map(x => x.text), `Untick ${ticked.length}`))) return;\n  const f = app.vault.getAbstractFileByPath(p.file.path), changes = [];\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    for (const x of ticked) { if (L[x.line] !== x.raw) continue; const next = x.raw.replace(BOX, (m, a, c, b) => `${a}[ ]${b ?? \"\"}`); changes.push({ line: x.line, before: x.raw, after: next }); L[x.line] = next; }\n    return L.join(\"\\n\");\n  });\n  const prevReset = p.last_reset ?? null;\n  await app.fileManager.processFrontMatter(f, fm => { fm.last_reset = moment().format(\"YYYY-MM-DD HH:mm\"); });\n  UNDO[p.file.path] = { changes, prevReset, at: Date.now() };\n  notify(`${p.file.name}: ${changes.length} item${changes.length === 1 ? \"\" : \"s\"} unticked.`);\n  setTimeout(render, 300);\n}\nasync function undo(p) {\n  const u = UNDO[p.file.path]; if (!u) return;\n  const f = app.vault.getAbstractFileByPath(p.file.path); let back = 0, skipped = 0;\n  await app.vault.process(f, data => { const L = data.split(\"\\n\"); for (const c of u.changes) { const i = L[c.line] === c.after ? c.line : L.indexOf(c.after); if (i < 0) { skipped++; continue; } L[i] = c.before; back++; } return L.join(\"\\n\"); });\n  await app.fileManager.processFrontMatter(f, fm => { fm.last_reset = u.prevReset ?? null; });\n  delete UNDO[p.file.path];\n  notify(`Undone: ${back} item${back === 1 ? \"\" : \"s\"} ticked again${skipped ? `; ${skipped} had changed and were left alone` : \"\"}.`);\n  setTimeout(render, 300);\n}\nasync function toggle(path, x) {\n  const f = app.vault.getAbstractFileByPath(path);\n  await app.vault.process(f, data => { const L = data.split(\"\\n\"); if (L[x.line] === x.raw) L[x.line] = x.raw.replace(BOX, (m, a, c, b) => `${a}[${x.done ? \" \" : \"x\"}]${b ?? \"\"}`); return L.join(\"\\n\"); });\n  setTimeout(render, 150);\n}\nasync function newList() {\n  const name = await new Promise(res => {\n    const back = document.body.createEl(\"div\", { attr: { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" } });\n    const card = back.createEl(\"div\", { attr: { style: \"background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:420px;width:100%;padding:14px 16px\" } });\n    card.createEl(\"div\", { text: \"Name of the new checklist\", attr: { style: \"font-weight:600;margin-bottom:8px\" } });\n    const inp = card.createEl(\"input\", { type: \"text\", attr: { style: \"width:100%\", placeholder: \"Packing list\" } });\n    const row = card.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;justify-content:flex-end;margin-top:10px\" } });\n    const no = row.createEl(\"button\", { text: \"Cancel\" }), yes = row.createEl(\"button\", { text: \"Create\", cls: \"mod-cta\" });\n    const done = v => { back.remove(); res(v); };\n    no.addEventListener(\"click\", () => done(null)); yes.addEventListener(\"click\", () => done(inp.value.trim()));\n    inp.addEventListener(\"keydown\", e => { if (e.key === \"Enter\") done(inp.value.trim()); if (e.key === \"Escape\") done(null); });\n    setTimeout(() => inp.focus(), 0);\n  });\n  if (!name) return;\n  const safe = name.replace(/[\\\\/:*?\"<>|#^[\\]]/g, \"\").trim(), path = `${FOLDER}/${safe}.md`;\n  if (app.vault.getAbstractFileByPath(path)) return notify(`${safe} already exists.`);\n  if (!app.vault.getAbstractFileByPath(FOLDER)) await app.vault.createFolder(FOLDER);\n  const f = await app.vault.create(path, \"---\\ntype: checklist\\nlast_reset:\\n---\\n- [ ] \\n\");\n  await app.workspace.getLeaf(false).openFile(f, { state: { mode: \"source\" } });\n}\nconst root = dv.container.createEl(\"div\", { cls: \"ckl\" });\nroot.createEl(\"style\", { text: `.ckl-card { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: var(--background-primary); }\n.ckl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .ckl-head strong { cursor: pointer; } .ckl-sub { color: var(--text-muted); font-size: 12px; }\n.ckl-bar { height: 5px; border-radius: 3px; background: var(--background-modifier-border); overflow: hidden; margin: 6px 0; } .ckl-bar > div { height: 100%; background: var(--interactive-accent); }\n.ckl-items { list-style: none; padding-left: 0; margin: 4px 0; font-size: 13px; } .ckl-items li { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; } .ckl-items li.is-done span { color: var(--text-faint); text-decoration: line-through; }\n.ckl-tools { margin-left: auto; display: flex; gap: 6px; } .ckl button { font-size: 12px; padding: 2px 10px; height: auto; } .ckl-undo { font-size: 12px; margin-top: 4px; }` });\nasync function render() {\n  const all = lists(), data = await Promise.all(all.map(p => items(p.file.path)));\n  root.querySelectorAll(\":scope > :not(style)\").forEach(e => e.remove());\n  const top = root.createEl(\"div\", { cls: \"ckl-head\" });\n  top.createEl(\"span\", { cls: \"ckl-sub\", text: all.length ? `${all.length} checklist${all.length === 1 ? \"\" : \"s\"}` : `No checklists yet. New ones go in ${FOLDER}/.` });\n  const nb = top.createEl(\"button\", { text: \"+ New checklist\", cls: \"mod-cta\" }); nb.style.marginLeft = \"auto\"; nb.addEventListener(\"click\", () => void newList());\n  all.forEach((p, k) => {\n    const its = data[k], done = its.filter(x => x.done).length;\n    const card = root.createEl(\"div\", { cls: \"ckl-card\" });\n    const head = card.createEl(\"div\", { cls: \"ckl-head\" });\n    const t = head.createEl(\"strong\", { text: p.file.name }); t.addEventListener(\"click\", () => app.workspace.openLinkText(p.file.path, \"\", false));\n    head.createEl(\"span\", { cls: \"ckl-sub\", text: `${done} of ${its.length} ticked · last reset ${dmy(its.lastReset)}` });\n    const tools = head.createEl(\"span\", { cls: \"ckl-tools\" });\n    const rb = tools.createEl(\"button\", { text: \"Reset\" }); rb.disabled = !done; rb.addEventListener(\"click\", () => void reset(p));\n    card.createEl(\"div\", { cls: \"ckl-bar\" }).createEl(\"div\", { attr: { style: `width:${its.length ? (100 * done / its.length) : 0}%` } });\n    const det = card.createEl(\"details\"); if (done && done < its.length) det.open = true;\n    det.createEl(\"summary\", { cls: \"ckl-sub\", text: \"Items\" });\n    const ul = det.createEl(\"ul\", { cls: \"ckl-items\" });\n    for (const x of its) {\n      const li = ul.createEl(\"li\", { cls: x.done ? \"is-done\" : \"\", attr: { style: `padding-left:${x.depth * 16}px` } });\n      const cb = li.createEl(\"input\", { type: \"checkbox\", cls: \"task-list-item-checkbox\" }); cb.checked = x.done;\n      cb.addEventListener(\"click\", e => { e.preventDefault(); void toggle(p.file.path, x); });\n      li.createEl(\"span\", { text: x.text || \"(empty)\" });\n    }\n    const u = UNDO[p.file.path];\n    if (u && Date.now() - u.at < 86400000) { const ub = card.createEl(\"div\", { cls: \"ckl-undo\" }); ub.appendText(`Reset ${u.changes.length} item${u.changes.length === 1 ? \"\" : \"s\"}. `); const b = ub.createEl(\"button\", { text: \"Undo\" }); b.addEventListener(\"click\", () => void undo(p)); }\n  });\n}\nawait render();\n",
  "course": "// One course. Usage, in a course note: await dv.view(\"Meta/views/course\")\n// Shows the term, the exam countdown and every lecture note of this course (notes whose course property links here)\n// with its recall questions and open Unclear items. Two buttons:\n// - New lecture note: makes \"<date> <topic>.md\" next to the course from the lecture template and lists it under Lectures.\n// - Plan backwards from the exam: two review steps per lecture, spread over the weeks before the exam (answer the\n//   recall questions first, then reread), written under ## Exam prep after you confirm. Undo puts it back.\nlet page = input?.path ? dv.page(input.path) : dv.current();\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst asDate = s => new Date(`${s}T12:00:00`);\nconst addDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return iso(d); };\nconst days = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);\nconst TODAY = iso(new Date());\nconst dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : \"not set\");\nconst str = v => (v == null ? \"\" : typeof v === \"object\" && v.toFormat ? v.toFormat(\"yyyy-MM-dd\") : String(v)).slice(0, 10);\nconst TEMPLATE = \"Templates/Lecture.md\";\nconst UNDO_KEY = \"compass-proto-planner-undo\"; // shared with the planner, so its Undo bar covers this too\n\nfunction h(tag, attrs = {}, parent, text) {\n  const el = document.createElement(tag);\n  for (const [k, v] of Object.entries(attrs)) { if (k === \"class\") el.className = v; else if (k === \"style\") el.style.cssText = v; else el.setAttribute(k, v); }\n  if (text !== undefined) el.textContent = text;\n  if (parent) parent.appendChild(el);\n  return el;\n}\n// The same confirm overlay as the planner: count, list, Yes or Cancel.\nfunction confirmBox(title, lines, yesText = \"Yes, add them\") {\n  return new Promise(resolve => {\n    const back = h(\"div\", { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" }, document.body);\n    const card = h(\"div\", { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" }, back);\n    h(\"div\", { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" }, card, `${title}?`);\n    const ul = h(\"ul\", { style: \"max-height:45vh;overflow:auto;font-size:13px;margin:4px 0;padding-left:18px\" }, card);\n    for (const l of lines) h(\"li\", {}, ul, l);\n    h(\"div\", { style: \"color:var(--text-muted);font-size:12px;margin:6px 0 10px\" }, card, \"You can undo this afterwards with Undo here or at the top of the planner.\");\n    const row = h(\"div\", { style: \"display:flex;gap:8px;justify-content:flex-end\" }, card);\n    const no = h(\"button\", {}, row, \"Cancel\"), yes = h(\"button\", { class: \"mod-cta\" }, row, yesText);\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(false); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(false)); yes.addEventListener(\"click\", () => done(true));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(false); });\n    yes.focus();\n  });\n}\nfunction askText(title, placeholder) {\n  return new Promise(resolve => {\n    const back = h(\"div\", { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" }, document.body);\n    const card = h(\"div\", { style: \"background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:440px;width:100%;padding:14px 16px\" }, back);\n    h(\"div\", { style: \"font-weight:600;margin-bottom:8px\" }, card, title);\n    const inp = h(\"input\", { type: \"text\", placeholder, style: \"width:100%;margin-bottom:10px\" }, card);\n    const row = h(\"div\", { style: \"display:flex;gap:8px;justify-content:flex-end\" }, card);\n    const no = h(\"button\", {}, row, \"Cancel\"), yes = h(\"button\", { class: \"mod-cta\" }, row, \"Create\");\n    const done = v => { back.remove(); resolve(v); };\n    no.addEventListener(\"click\", () => done(null));\n    yes.addEventListener(\"click\", () => done(inp.value.trim() || null));\n    inp.addEventListener(\"keydown\", e => { if (e.key === \"Enter\") done(inp.value.trim() || null); if (e.key === \"Escape\") done(null); });\n    back.addEventListener(\"click\", e => { if (e.target === back) done(null); });\n    setTimeout(() => inp.focus(), 0);\n  });\n}\n// Lines of a \"## Heading\" section of a note's text.\nconst section = (text, name) => { const L = text.split(\"\\n\"); const i = L.findIndex(l => l.trim() === `## ${name}`); if (i < 0) return []; const out = []; for (let j = i + 1; j < L.length && !/^#{1,2}\\s/.test(L[j]); j++) out.push(L[j]); return out; };\nconst recallCount = text => section(text, \"Recall questions\").filter(l => /\\S::\\S/.test(l) && !/^\\s*[-*] \\[/.test(l)).length;\nasync function appendUnder(path, heading, lines) {\n  const f = app.vault.getAbstractFileByPath(path);\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    let i = L.findIndex(l => l.trim() === heading);\n    if (i < 0) { L.push(\"\", heading); i = L.length - 1; }\n    let end = i + 1; while (end < L.length && !/^#{1,2}\\s/.test(L[end])) end++;\n    let at = end; while (at > i + 1 && L[at - 1].trim() === \"\") at--;\n    L.splice(at, 0, ...lines);\n    return L.join(\"\\n\");\n  });\n}\nfunction saveUndo(title, path, lines) {\n  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items: lines.map(l => ({ path, before: null, after: l })) })); } catch (e) {}\n}\nasync function undoLast() {\n  let u = null; try { u = JSON.parse(localStorage.getItem(UNDO_KEY) || \"null\"); } catch (e) {}\n  if (!u?.items?.length) return;\n  let back = 0;\n  for (const [path, its] of Object.entries(u.items.reduce((m, it) => ((m[it.path] ??= []).push(it), m), {}))) {\n    const f = app.vault.getAbstractFileByPath(path); if (!f) continue;\n    await app.vault.process(f, data => { const L = data.split(\"\\n\"); for (const it of its) { const i = L.indexOf(it.after); if (i < 0) continue; if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; } return L.join(\"\\n\"); });\n  }\n  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}\n  notify(`Undone: ${back} line${back === 1 ? \"\" : \"s\"} put back.`);\n}\n\nconst root = h(\"div\", { class: \"crs\" }, dv.container);\nh(\"style\", {}, root, `\n.crs { font-size: 13px; }\n.crs-head { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; margin-bottom: 6px; }\n.crs-chip { font-size: 11px; padding: 1px 8px; border-radius: 9px; border: 1px solid var(--background-modifier-border); }\n.crs-chip.is-soon { color: var(--color-orange); border-color: var(--color-orange); }\n.crs table { width: 100%; border-collapse: collapse; font-size: 12px; }\n.crs td, .crs th { padding: 3px 6px; border-top: 1px solid var(--background-modifier-border); text-align: left; }\n.crs .is-missing { color: var(--color-red); }\n.crs-bar { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }\n.crs-sub { color: var(--text-muted); font-size: 11px; }\n`);\n\nasync function render() {\n  root.querySelectorAll(\":scope > :not(style)\").forEach(e => e.remove());\n  if (!page) { h(\"p\", {}, root, \"Open this in a course note.\"); return; }\n  page = dv.page(page.file.path) ?? page; // fresh index data after our own writes\n  const exam = str(page.exam), ts = str(page[\"term-start\"]), te = str(page[\"term-end\"]);\n  const head = h(\"div\", { class: \"crs-head\" }, root);\n  h(\"span\", {}, head, `Term ${dmy(ts)} to ${dmy(te)}`);\n  if (exam) { const d = days(TODAY, exam); h(\"span\", { class: `crs-chip${d <= 21 ? \" is-soon\" : \"\"}` }, head, d >= 0 ? `Exam ${dmy(exam)}, in ${d} day${d === 1 ? \"\" : \"s\"}` : `Exam was ${dmy(exam)}`); }\n  else h(\"span\", { class: \"crs-chip\" }, head, \"No exam date yet (set exam: YYYY-MM-DD)\");\n  if (page[\"hours-per-week\"]) h(\"span\", { class: \"crs-sub\" }, head, `${page[\"hours-per-week\"]}h a week`);\n\n  const lectures = dv.pages().where(p => p.course?.path === page.file.path && (p.file.tags ?? []).includes(\"#lecture\")).sort(p => `${str(p.date) || \"9999\"} ${String(p.lecture ?? \"\").padStart(3, \"0\")} ${p.file.name}`).array();\n  const prep = (page.file.tasks ?? []).where(t => t.section?.subpath === \"Exam prep\").array();\n  const table = h(\"table\", {}, root);\n  const hr = h(\"tr\", {}, table); for (const t of [\"Date\", \"Lecture\", \"Recall questions\", \"Unclear\", \"Review steps\"]) h(\"th\", {}, hr, t);\n  const info = [];\n  for (const p of lectures) {\n    const text = await app.vault.cachedRead(app.vault.getAbstractFileByPath(p.file.path));\n    const q = recallCount(text);\n    const unclear = p.file.tasks.where(t => !t.completed && t.section?.subpath === \"Unclear\" && t.text.trim()).length;\n    const planned = prep.filter(t => t.text.includes(`[[${p.file.name}]]`) || t.outlinks?.some?.(l => l.path === p.file.path)).length;\n    info.push({ p, q, planned });\n    const tr = h(\"tr\", {}, table);\n    h(\"td\", {}, tr, dmy(str(p.date)));\n    const a = h(\"a\", { class: \"internal-link\" }, h(\"td\", {}, tr), p.file.name.replace(/^\\d{4}-\\d{2}-\\d{2}\\s*/, \"\"));\n    a.addEventListener(\"click\", () => app.workspace.openLinkText(p.file.path, \"\", false));\n    h(\"td\", { class: q ? \"\" : \"is-missing\" }, tr, q ? String(q) : \"none yet\");\n    h(\"td\", {}, tr, unclear ? `${unclear} open` : \"\");\n    h(\"td\", {}, tr, planned ? `${planned} planned` : \"\");\n  }\n  if (!lectures.length) h(\"p\", { class: \"crs-sub\" }, root, \"No lecture notes yet. Use New lecture note.\");\n\n  const bar = h(\"div\", { class: \"crs-bar\" }, root);\n  const nl = h(\"button\", {}, bar, \"New lecture note\");\n  nl.addEventListener(\"click\", newLecture);\n  const pb = h(\"button\", { class: \"mod-cta\" }, bar, \"Plan backwards from the exam\");\n  pb.addEventListener(\"click\", () => planBackwards(info, exam));\n  let u = null; try { u = JSON.parse(localStorage.getItem(UNDO_KEY) || \"null\"); } catch (e) {}\n  if (u?.items?.some(it => it.path === page.file.path)) {\n    const ub = h(\"button\", { class: \"mod-warning\" }, bar, `Undo: ${u.title}`);\n    ub.addEventListener(\"click\", async () => { ub.disabled = true; await undoLast(); setTimeout(render, 400); });\n  }\n  h(\"div\", { class: \"crs-sub\" }, root, \"Review steps: answer the lecture's recall questions from memory first, then reread what you missed.\");\n}\n\nasync function newLecture() {\n  const topic = await askText(\"New lecture note: topic\", \"e.g. Eigenvalues\");\n  if (!topic) return;\n  const folder = page.file.folder, name = `${TODAY} ${topic.replace(/[\\\\/:*?\"<>|#^[\\]]/g, \"\")}`;\n  const path = `${folder}/${name}.md`;\n  if (app.vault.getAbstractFileByPath(path)) { notify(\"That lecture note already exists.\"); return; }\n  const tpl = app.vault.getAbstractFileByPath(TEMPLATE);\n  const templater = app.plugins.plugins[\"templater-obsidian\"]?.templater;\n  let file;\n  if (tpl && templater?.create_new_note_from_template) file = await templater.create_new_note_from_template(tpl, app.vault.getAbstractFileByPath(folder), name, false);\n  else file = await app.vault.create(path, tpl ? await app.vault.read(tpl) : \"\");\n  const n = dv.pages().where(p => p.course?.path === page.file.path && (p.file.tags ?? []).includes(\"#lecture\")).length + 1;\n  await app.fileManager.processFrontMatter(file, fm => { fm.course = `[[${page.file.name}]]`; fm.lecture = n; fm.area = \"study\"; });\n  await appendUnder(page.file.path, \"## Lectures\", [`- [ ] Recall questions for [[${file.basename}]] [est:: 15m] 🔺 📅 ${addDays(TODAY, 1)}`]);\n  await app.workspace.getLeaf(false).openFile(file);\n}\n\nasync function planBackwards(info, exam) {\n  if (!exam) { notify(\"Set the course's exam date first (exam: YYYY-MM-DD in the properties).\"); return; }\n  const start = addDays(TODAY, 1), end = addDays(exam, -3);\n  const span = days(start, end);\n  if (span < 4) { notify(\"The exam is too close to spread reviews out. Plan the last days by hand in the planner.\"); return; }\n  const todo = info.filter(x => !x.planned);\n  if (!todo.length) { notify(info.length ? \"Every lecture already has review steps.\" : \"No lecture notes yet.\"); return; }\n  // first review in the first 70% of the time left, a second, shorter one in the last 30%, both spread evenly\n  const cut = Math.floor(span * 0.7);\n  const at = (i, n, from, len) => addDays(start, from + Math.floor((i + 0.5) * len / n));\n  const lines = [];\n  todo.forEach((x, i) => {\n    const q = x.q ? `answer its ${x.q} recall question${x.q === 1 ? \"\" : \"s\"} first, then reread what you missed` : \"write its recall questions first, then answer them\";\n    lines.push(`- [ ] Review [[${x.p.file.name}]]: ${q} [est:: 30m] 🔺 ⏳ ${at(i, todo.length, 0, cut)}`);\n  });\n  todo.forEach((x, i) => lines.push(`- [ ] Review again [[${x.p.file.name}]]: recall questions only [est:: 15m] 🔺 ⏳ ${at(i, todo.length, cut + 1, span - cut - 1)}`));\n  const pretty = l => l.replace(/^- \\[ \\] /, \"\").replace(/\\[\\[(?:\\d{4}-\\d{2}-\\d{2} )?([^\\]]+)\\]\\]/, \"$1\").replace(/ \\[est:: ([^\\]]+)\\]/, \" ($1)\").replace(/⏳ (\\d{4})-(\\d{2})-(\\d{2})/, \"on $3-$2-$1\");\n  const title = `Add ${lines.length} review steps to ${page.file.name}, between ${dmy(start)} and ${dmy(end)}`;\n  if (!(await confirmBox(title, lines.map(pretty)))) return;\n  await appendUnder(page.file.path, \"## Exam prep\", lines);\n  saveUndo(`${lines.length} review steps in ${page.file.name}`, page.file.path, lines);\n  notify(`Added ${lines.length} review steps under Exam prep. Undo is here and at the top of the planner.`);\n  setTimeout(render, 600);\n}\n\nawait render();\n",
  "courses": "// Courses widget for the Study tab. Usage: await dv.view(\"Meta/views/courses\")\n// One row per course note (kind: course, status not done): exam countdown, next deadline, progress, this week's\n// planned study time against hours-per-week, lectures without recall questions, open Unclear items.\n// Below: every study deadline in the next four weeks. Sample courses (tagged example) are left out.\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst asDate = s => new Date(`${s}T12:00:00`);\nconst addDays = (s, n) => { const d = asDate(s); d.setDate(d.getDate() + n); return iso(d); };\nconst days = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);\nconst TODAY = iso(new Date());\nconst MONDAY = addDays(TODAY, -((asDate(TODAY).getDay() + 6) % 7)), SUNDAY = addDays(MONDAY, 6);\nconst dmy = s => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : \"\");\nconst str = v => (v == null ? \"\" : typeof v === \"object\" && v.toFormat ? v.toFormat(\"yyyy-MM-dd\") : String(v)).slice(0, 10);\nconst parseEst = s => { const v = String(s ?? \"\").trim().toLowerCase().replace(\",\", \".\"); if (/^\\d+(\\.\\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith(\"h\") ? 60 : 1); } return hit ? m : null; };\nconst fmt = m => { const h = Math.floor(m / 60), r = Math.round(m % 60); return [h ? `${h}h` : \"\", r ? `${r}m` : \"\"].filter(Boolean).join(\" \") || \"0h\"; };\nconst label = t => t.text.replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\").replace(/\\s*(📅|⏳|🛫|➕|✅) \\d{4}-\\d{2}-\\d{2}/gu, \"\").replace(/\\[\\[(?:\\d{4}-\\d{2}-\\d{2} )?([^\\]|]+)(\\|[^\\]]+)?\\]\\]/g, \"$1\").replace(/[🔺⏫🔼🔽⏬]/gu, \"\").replace(/\\s+/g, \" \").trim();\nconst due = t => t.text.match(/📅 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null;\nconst sched = t => t.text.match(/⏳ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null;\nconst open = p => app.workspace.openLinkText(p, \"\", false);\n\nconst all = dv.pages().where(p => p.kind === \"course\" && !/(^|\\/)(templates|\\.trash)\\//i.test(p.file.path) && !/^(done|archived)$/i.test(String(p.status ?? \"\"))).array();\nconst real = all.filter(p => !(p.file.tags ?? []).includes(\"#example\"));\nconst courses = real.sort((a, b) => (str(a.exam) || \"9999\").localeCompare(str(b.exam) || \"9999\"));\nconst root = dv.container.createEl(\"div\", { cls: \"crsw\" });\nconst newBtn = root.createEl(\"button\", { text: \"+ New course\", attr: { title: \"QuickAdd New course: a course note in 10 Areas/Study/<name>/ from Templates/Course.md\" } });\nnewBtn.addEventListener(\"click\", () => app.commands.executeCommandById(\"quickadd:choice:lifeos-new-course\"));\nroot.createEl(\"style\", { text: `\n.crsw { font-size: 13px; }\n.crsw-row { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 6px 0; background: var(--background-primary); cursor: pointer; }\n.crsw-row:hover { border-color: var(--interactive-accent); }\n.crsw-top { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }\n.crsw-name { font-weight: 600; font-size: 14px; }\n.crsw-sub { color: var(--text-muted); font-size: 12px; }\n.crsw-warn { color: var(--color-orange); font-size: 12px; }\n.crsw-bar { height: 5px; border-radius: 3px; background: var(--background-modifier-border); margin: 5px 0 3px; overflow: hidden; }\n.crsw-bar > div { height: 5px; background: var(--interactive-accent); }\n.crsw table { width: 100%; border-collapse: collapse; font-size: 12px; }\n.crsw td { padding: 3px 6px; border-top: 1px solid var(--background-modifier-border); }\n.crsw .is-soon { color: var(--color-orange); }\n.crsw .is-late { color: var(--color-red); }\n` });\nif (!courses.length) { root.createEl(\"p\", { text: \"No courses yet. Press + New course to make one; how it works: Guide, 25 Workflow - Study.\", cls: \"crsw-sub\" }); return; }\n\nconst upcoming = [];\nfor (const c of courses) {\n  const lectures = dv.pages().where(p => p.course?.path === c.file.path && (p.file.tags ?? []).includes(\"#lecture\")).array();\n  const tasks = [...c.file.tasks.array(), ...lectures.flatMap(l => l.file.tasks.array())].filter(t => t.text.trim());\n  const done = tasks.filter(t => t.completed).length;\n  const next = tasks.filter(t => !t.completed && due(t)).sort((a, b) => due(a).localeCompare(due(b)))[0];\n  const week = tasks.filter(t => !t.completed && sched(t) && sched(t) >= MONDAY && sched(t) <= SUNDAY).reduce((s, t) => s + (parseEst(t.est ?? t.text.match(/\\[est::\\s*([^\\]]+)\\]/)?.[1]) ?? 15), 0);\n  const unclear = lectures.flatMap(l => l.file.tasks.array()).filter(t => !t.completed && t.section?.subpath === \"Unclear\" && t.text.trim()).length;\n  let noRecall = 0;\n  for (const l of lectures.filter(l => str(l.date) >= addDays(TODAY, -7))) {\n    const text = await app.vault.cachedRead(app.vault.getAbstractFileByPath(l.file.path));\n    const i = text.indexOf(\"## Recall questions\"), rest = i < 0 ? \"\" : text.slice(i).split(/\\n## /)[0];\n    if (!/\\S::\\S/.test(rest.split(\"\\n\").slice(1).join(\"\\n\"))) noRecall++;\n  }\n  for (const t of tasks) if (!t.completed && due(t) && due(t) <= addDays(TODAY, 28)) upcoming.push({ t, c });\n  const exam = str(c.exam);\n  if (exam && exam >= TODAY && exam <= addDays(TODAY, 28)) upcoming.push({ exam, c });\n\n  const row = root.createEl(\"div\", { cls: \"crsw-row\" });\n  row.addEventListener(\"click\", () => open(c.file.path));\n  const top = row.createEl(\"div\", { cls: \"crsw-top\" });\n  top.createEl(\"span\", { cls: \"crsw-name\", text: c.course ?? c.file.name });\n  if (exam) { const d = days(TODAY, exam); top.createEl(\"span\", { cls: d <= 21 ? \"is-soon\" : \"crsw-sub\", text: d >= 0 ? `exam ${dmy(exam)}, ${d} day${d === 1 ? \"\" : \"s\"}` : `exam was ${dmy(exam)}` }); }\n  top.createEl(\"span\", { cls: \"crsw-sub\", text: `term ${dmy(str(c[\"term-start\"]))} to ${dmy(str(c[\"term-end\"]))}` });\n  const bar = row.createEl(\"div\", { cls: \"crsw-bar\" }); bar.createEl(\"div\", { attr: { style: `width:${tasks.length ? Math.round(100 * done / tasks.length) : 0}%` } });\n  const nd = next ? days(TODAY, due(next)) : null;\n  row.createEl(\"div\", { cls: \"crsw-sub\", text: `${done} of ${tasks.length} steps done${next ? ` · next: ${label(next)}, ${dmy(due(next))} (${nd < 0 ? `${-nd} days late` : nd === 0 ? \"today\" : `${nd} day${nd === 1 ? \"\" : \"s\"}`})` : \"\"}` });\n  const target = Number(c[\"hours-per-week\"]) || 0;\n  row.createEl(\"div\", { cls: \"crsw-sub\", text: `this week planned: ${fmt(week)}${target ? ` of ${target}h` : \"\"}` });\n  if (noRecall) row.createEl(\"div\", { cls: \"crsw-warn\", text: `${noRecall} lecture${noRecall === 1 ? \"\" : \"s\"} from the last week without recall questions` });\n  if (unclear) row.createEl(\"div\", { cls: \"crsw-warn\", text: `${unclear} unclear item${unclear === 1 ? \"\" : \"s\"} to ask` });\n}\n\nroot.createEl(\"h4\", { text: \"Coming up, next four weeks\", attr: { style: \"margin:12px 0 4px\" } });\nif (!upcoming.length) root.createEl(\"div\", { cls: \"crsw-sub\", text: \"No study deadlines in the next four weeks.\" });\nconst table = root.createEl(\"table\");\nfor (const u of upcoming.sort((a, b) => (a.exam ?? due(a.t)).localeCompare(b.exam ?? due(b.t)))) {\n  const d = u.exam ?? due(u.t), n = days(TODAY, d);\n  const tr = table.createEl(\"tr\");\n  tr.createEl(\"td\", { text: dmy(d), cls: n < 0 ? \"is-late\" : n <= 3 ? \"is-soon\" : \"\" });\n  const td = tr.createEl(\"td\"); const a = td.createEl(\"a\", { cls: \"internal-link\", text: u.exam ? \"Exam\" : label(u.t) });\n  a.addEventListener(\"click\", () => (u.t ? app.workspace.openLinkText(u.t.path, \"\", false, { eState: { line: u.t.line } }) : open(u.c.file.path)));\n  tr.createEl(\"td\", { cls: \"crsw-sub\", text: u.c.course ?? u.c.file.name });\n}\n",
  "dailyquestions": "// EX3C Agenda Daily Questions widget: lines + averages of every dq_* number property.\n// Usage:\n//   await dv.view(\"Meta/views/dailyquestions\", { days: 30 })              interactive (dropdown + toggles)\n//   await dv.view(\"Meta/views/dailyquestions\", { from: \"2026-07-01\", to: \"2026-09-30\" })  fixed range\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst FOLDER = cfg.daily_folder || \"01 Journal/Daily\";\nconst PREFIX = cfg.dq_prefix || \"dq_\";\nconst DEFAULT_RANGE = (input && input.days) || 30;\nconst FIXED_FROM = input && input.from ? moment(input.from) : null;\nconst FIXED_TO = input && input.to ? moment(input.to) : null;\nconst COLORS = [\"#e6194b\", \"#3cb44b\", \"#4363d8\", \"#f58231\", \"#911eb4\", \"#42d4f4\", \"#f032e6\", \"#9a6324\", \"#469990\", \"#800000\"];\n\nconst pages = dv.pages(`\"${FOLDER}\"`).where(p => /^\\d{4}-\\d{2}-\\d{2}$/.test(p.file.name)).array();\nconst series = {};\nfor (const p of pages) {\n  const fm = p.file.frontmatter || {};\n  for (const k of Object.keys(fm)) {\n    if (!k.startsWith(PREFIX)) continue;\n    if (fm[k] === null || fm[k] === \"\" || fm[k] === undefined) continue;\n    const v = Number(fm[k]);\n    if (isNaN(v)) continue;\n    (series[k] ||= []).push({ date: p.file.name, t: moment(p.file.name).valueOf(), v });\n  }\n}\nconst keys = Object.keys(series).sort();\nconst label = k => k.slice(PREFIX.length).replace(/[_-]+/g, \" \").replace(/\\b\\w/g, c => c.toUpperCase());\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nif (keys.length === 0) {\n  root.createEl(\"p\", { text: `No number properties starting with \"${PREFIX}\" found in ${FOLDER} yet. Answer your daily questions (Templates/Daily Questions Prompt.md) and they will show up here.` });\n} else {\n  const controls = root.createEl(\"div\", { cls: \"lifeos-controls\" });\n  let sel = null;\n  if (!FIXED_FROM) {\n    sel = controls.createEl(\"select\");\n    for (const [v, l] of [[7, \"Last 7 days\"], [30, \"Last 30 days\"], [90, \"Last 90 days\"], [365, \"Last year\"], [0, \"All time\"]]) {\n      const o = sel.createEl(\"option\", { text: l });\n      o.value = String(v);\n      if (v === DEFAULT_RANGE) o.selected = true;\n    }\n    sel.addEventListener(\"change\", render);\n  } else {\n    controls.createEl(\"span\", { text: `${FIXED_FROM.format(\"YYYY-MM-DD\")} → ${FIXED_TO ? FIXED_TO.format(\"YYYY-MM-DD\") : \"today\"}` });\n  }\n  const toggles = {};\n  keys.forEach((k, i) => {\n    const lab = controls.createEl(\"label\");\n    const cb = lab.createEl(\"input\", { attr: { type: \"checkbox\" } });\n    cb.checked = true;\n    lab.appendText(\" \" + label(k));\n    lab.style.color = COLORS[i % COLORS.length];\n    toggles[k] = cb;\n    cb.addEventListener(\"change\", render);\n  });\n  const chart = root.createEl(\"div\", { cls: \"lifeos-chart\" });\n  const tableEl = root.createEl(\"div\");\n\n  function render() {\n    const today = moment().startOf(\"day\");\n    let from, to = FIXED_TO ? FIXED_TO.clone().endOf(\"day\") : today.clone().endOf(\"day\");\n    if (FIXED_FROM) from = FIXED_FROM.clone().startOf(\"day\");\n    else {\n      const days = Number(sel.value);\n      if (days > 0) from = today.clone().subtract(days - 1, \"day\");\n      else { const all = keys.flatMap(k => series[k].map(x => x.t)); from = moment(Math.min(...all)).startOf(\"day\"); }\n    }\n    const t0 = from.valueOf(), t1 = to.valueOf();\n    const W = 720, H = 260, ml = 32, mr = 12, mt = 12, mb = 28;\n    const iw = W - ml - mr, ih = H - mt - mb;\n    const x = t => t1 === t0 ? ml + iw / 2 : ml + (t - t0) / (t1 - t0) * iw;\n    const y = v => mt + (10 - v) / 9 * ih;\n    let svg = `<svg viewBox=\"0 0 ${W} ${H}\" xmlns=\"http://www.w3.org/2000/svg\">`;\n    for (let g = 1; g <= 10; g++) {\n      svg += `<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(g)}\" y2=\"${y(g)}\" stroke=\"currentColor\" stroke-opacity=\"${g === 1 || g === 10 ? 0.35 : 0.12}\" />`;\n      if (g === 1 || g === 5 || g === 10) svg += `<text x=\"${ml - 6}\" y=\"${y(g) + 4}\" font-size=\"11\" text-anchor=\"end\" fill=\"currentColor\" opacity=\"0.7\">${g}</text>`;\n    }\n    svg += `<text x=\"${ml}\" y=\"${H - 8}\" font-size=\"11\" fill=\"currentColor\" opacity=\"0.7\">${from.format(\"MMM D, YYYY\")}</text>`;\n    svg += `<text x=\"${W - mr}\" y=\"${H - 8}\" font-size=\"11\" text-anchor=\"end\" fill=\"currentColor\" opacity=\"0.7\">${to.format(\"MMM D, YYYY\")}</text>`;\n    const rows = [];\n    keys.forEach((k, i) => {\n      if (!toggles[k].checked) return;\n      const pts = series[k].filter(p => p.t >= t0 && p.t <= t1).sort((a, b) => a.t - b.t);\n      if (pts.length === 0) { rows.push([label(k), \"-\", \"-\", \"-\", 0, \"-\"]); return; }\n      const color = COLORS[i % COLORS.length];\n      const poly = pts.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(\" \");\n      svg += `<polyline points=\"${poly}\" fill=\"none\" stroke=\"${color}\" stroke-width=\"2\" stroke-linejoin=\"round\" stroke-linecap=\"round\" />`;\n      for (const p of pts) svg += `<circle cx=\"${x(p.t).toFixed(1)}\" cy=\"${y(p.v).toFixed(1)}\" r=\"2.5\" fill=\"${color}\"><title>${p.date}: ${p.v}</title></circle>`;\n      const vals = pts.map(p => p.v);\n      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;\n      svg += `<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(avg)}\" y2=\"${y(avg)}\" stroke=\"${color}\" stroke-opacity=\"0.35\" stroke-dasharray=\"4 4\" />`;\n      rows.push([label(k), avg.toFixed(1), Math.min(...vals), Math.max(...vals), vals.length, vals[vals.length - 1]]);\n    });\n    svg += `</svg>`;\n    chart.innerHTML = svg;\n    let html = `<table class=\"lifeos-table\"><thead><tr><th>Question</th><th>Average</th><th>Min</th><th>Max</th><th>Days answered</th><th>Latest</th></tr></thead><tbody>`;\n    for (const r of rows) html += `<tr>${r.map(c => `<td>${c}</td>`).join(\"\")}</tr>`;\n    html += `</tbody></table>`;\n    tableEl.innerHTML = html;\n  }\n  render();\n}\n",
  "habits": "// EX3C Agenda Habit Canvas widget.\n// Usage:  await dv.view(\"Meta/views/habits\", { days: 14 })\n// Reads every daily note, finds checkbox properties starting with habit_prefix and\n// renders: last N days grid, current streak, best streak, longest break, completion %, total.\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst FOLDER = cfg.daily_folder || \"01 Journal/Daily\";\nconst PREFIX = cfg.habit_prefix || \"habit_\";\nconst DAYS = (input && input.days) || 14;\n\nconst isDaily = n => /^\\d{4}-\\d{2}-\\d{2}$/.test(n);\nconst pages = dv.pages(`\"${FOLDER}\"`).where(p => isDaily(p.file.name)).array();\nconst byDate = new Map();\nconst habits = new Set();\nfor (const p of pages) {\n  const fm = p.file.frontmatter || {};\n  const vals = {};\n  for (const k of Object.keys(fm)) {\n    if (!k.startsWith(PREFIX)) continue;\n    habits.add(k);\n    vals[k] = fm[k] === true;\n  }\n  byDate.set(p.file.name, vals);\n}\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nif (habits.size === 0) {\n  root.createEl(\"p\", { text: `No checkbox properties starting with \"${PREFIX}\" found in ${FOLDER} yet. Add some to Templates/Daily Note.md and start checking them off.` });\n} else {\n  const today = moment().startOf(\"day\");\n  const fmt = d => d.format(\"YYYY-MM-DD\");\n  const label = k => k.slice(PREFIX.length).replace(/[_-]+/g, \" \").replace(/\\b\\w/g, c => c.toUpperCase());\n  const dates = [...byDate.keys()].sort();\n  const first = moment(dates[0]);\n  const rows = [];\n  for (const h of [...habits].sort()) {\n    const rec = d => byDate.get(fmt(d));\n    const tracked = d => { const v = rec(d); return !!v && (h in v); };\n    const done = d => { const v = rec(d); return !!v && v[h] === true; };\n\n    // current streak: count back from today; if today is not done yet, start from yesterday\n    let cur = 0;\n    let d = today.clone();\n    if (!done(d)) d.subtract(1, \"day\");\n    while (done(d)) { cur++; d.subtract(1, \"day\"); }\n\n    // best streak, longest break, totals (calendar days from first daily note to today)\n    let best = 0, run = 0, brk = 0, gap = 0, total = 0, trackedDays = 0;\n    for (let x = first.clone(); !x.isAfter(today); x.add(1, \"day\")) {\n      if (tracked(x)) trackedDays++;\n      if (done(x)) { total++; run++; if (run > best) best = run; if (gap > brk) brk = gap; gap = 0; }\n      else if (tracked(x)) { run = 0; gap++; }   // tracked and missed: breaks the streak, extends the break\n      else { run = 0; }                          // no daily note: breaks the streak, does not count as a break day\n    }\n    if (gap > brk) brk = gap;\n    const pct = trackedDays ? Math.round(100 * total / trackedDays) : 0;\n\n    const grid = [];\n    for (let i = DAYS - 1; i >= 0; i--) {\n      const x = today.clone().subtract(i, \"day\");\n      grid.push(done(x) ? \"●\" : (tracked(x) ? \"○\" : \"·\"));\n    }\n    rows.push({ name: label(h), grid: grid.join(\"\"), cur, best, brk, pct, total });\n  }\n\n  const table = root.createEl(\"table\", { cls: \"lifeos-table\" });\n  const thead = table.createEl(\"thead\").createEl(\"tr\");\n  for (const h of [\"Habit\", `Last ${DAYS} days`, \"Current\", \"Best\", \"Longest break\", \"Completion\", \"Total\"]) thead.createEl(\"th\", { text: h });\n  const tbody = table.createEl(\"tbody\");\n  for (const r of rows) {\n    const tr = tbody.createEl(\"tr\");\n    tr.createEl(\"td\", { text: r.name });\n    tr.createEl(\"td\", { text: r.grid, cls: \"lifeos-grid\" });\n    tr.createEl(\"td\", { text: String(r.cur) });\n    tr.createEl(\"td\", { text: String(r.best) });\n    tr.createEl(\"td\", { text: String(r.brk) });\n    tr.createEl(\"td\", { text: r.pct + \"%\" });\n    tr.createEl(\"td\", { text: String(r.total) });\n  }\n  root.createEl(\"p\", { text: \"● done   ○ tracked but missed   · no daily note\", cls: \"lifeos-legend\" }).style.opacity = \"0.6\";\n}\n",
  "idealweek": "// The Ideal Week drawn as a week of blocks. Usage: await dv.view(\"Meta/views/idealweek\")\n// Reads the lines under \"## Blocks\" in 03 Planning/Ideal Week.md, one block per line:\n//   - Mon-Fri 08:00 - 10:00 Deep work #tasks\n// Days: Mon ... Sun, a range (Mon-Fri), a list (Mon,Wed,Fri), Daily, Weekdays or Weekend. #tasks marks time for\n// tasks: while \"Use this week in the planner\" is on, the planner uses those hours as each weekday's capacity and\n// shows the blocks behind its week view.\nconst PATH = input?.path ?? \"03 Planning/Ideal Week.md\";\nconst DAYN = [\"mon\", \"tue\", \"wed\", \"thu\", \"fri\", \"sat\", \"sun\"];\nconst LABEL = [\"Mon\", \"Tue\", \"Wed\", \"Thu\", \"Fri\", \"Sat\", \"Sun\"];\nconst pad = n => String(n).padStart(2, \"0\");\nconst clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;\nconst fmt = m => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h}h` : \"\", r ? `${r}m` : \"\"].filter(Boolean).join(\" \") || \"0h\"; };\nfunction daysOf(spec) {\n  const out = new Set();\n  for (const part of String(spec).toLowerCase().split(/\\s*,\\s*/)) {\n    if (part === \"daily\" || part === \"every day\") DAYN.forEach((d, i) => out.add(i));\n    else if (part === \"weekdays\") [0, 1, 2, 3, 4].forEach(i => out.add(i));\n    else if (part === \"weekend\") [5, 6].forEach(i => out.add(i));\n    else {\n      const [a, b] = part.split(/\\s*-\\s*/).map(x => DAYN.indexOf(x.slice(0, 3)));\n      if (a < 0) continue;\n      if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }\n    }\n  }\n  return [...out];\n}\nconst page = dv.page(PATH);\nconst blocks = [], bad = [];\nfor (const l of page?.file.lists.array() ?? []) {\n  if (l.task || (l.section?.subpath && l.section.subpath !== \"Blocks\")) continue;\n  const m = String(l.text).match(/^\\s*([A-Za-z][A-Za-z, -]*?)\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+(.+)$/);\n  if (!m) { if (String(l.text).trim()) bad.push(l.text); continue; }\n  const days = daysOf(m[1]), s = +m[2] * 60 + +m[3], e = +m[4] * 60 + +m[5];\n  if (!days.length || e <= s) { bad.push(l.text); continue; }\n  blocks.push({ days, s, e, line: l.line, what: m[6].replace(/(^|\\s)#(tasks|work)\\b/gi, \" \").trim(), tasks: /(^|\\s)#tasks\\b/i.test(m[6]), work: /(^|\\s)#work\\b/i.test(m[6]) });\n}\n\nconst root = dv.container.createEl(\"div\", { cls: \"iw\" });\nroot.createEl(\"style\", { text: `\n.iw { font-size: 12px; }\n.iw-scroll { overflow-x: auto; }\n.iw-grid { display: grid; grid-template-columns: 40px repeat(7, minmax(72px, 1fr)); min-width: 560px; }\n.iw-head { font-weight: 600; padding: 2px 4px; border-left: 1px solid var(--background-modifier-border); }\n.iw-head .iw-sub { font-weight: normal; color: var(--text-muted); font-size: 11px; }\n.iw-col, .iw-hours { position: relative; }\n.iw-col { border-left: 1px solid var(--background-modifier-border); }\n.iw-hr { position: absolute; left: 0; right: 0; border-top: 1px dotted var(--background-modifier-border); }\n.iw-hours span { position: absolute; right: 4px; transform: translateY(-6px); font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }\n.iw-b { position: absolute; left: 2px; right: 2px; box-sizing: border-box; border-radius: 5px; padding: 1px 4px; overflow: hidden; line-height: 1.2; cursor: pointer;\n  background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); }\n.iw-b.is-tasks { background: color-mix(in srgb, var(--interactive-accent) 22%, var(--background-primary)); border-color: var(--interactive-accent); }\n.iw-b.is-work { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-faint) 22%, var(--background-primary)) 0 6px, var(--background-primary) 6px 12px); border-color: var(--text-muted); }\n.iw-b.is-commute { background: transparent; border-style: dashed; color: var(--text-muted); font-size: 10px; }\n.iw-b small { color: var(--text-muted); display: block; font-variant-numeric: tabular-nums; }\n.iw-note { color: var(--text-muted); margin: 4px 0 8px; }\n.iw-warn { color: var(--color-orange); margin: 4px 0 8px; }\n` });\n\n// work blocks get the commute (commute_minutes in this note) before and after them, drawn but not editable on their own\nconst COMMUTE = Number(page?.commute_minutes ?? 0) || 0;\nif (COMMUTE) for (const b of blocks.filter(b => b.work)) blocks.push({ days: b.days, s: b.s - COMMUTE, e: b.s, line: b.line, what: \"Commute\", commute: true }, { days: b.days, s: b.e, e: b.e + COMMUTE, line: b.line, what: \"Commute\", commute: true });\nconst workMin = blocks.filter(b => b.work).reduce((t, b) => t + (b.e - b.s) * b.days.length, 0);\nconst taskMin = i => blocks.filter(b => b.tasks && b.days.includes(i)).reduce((t, b) => t + b.e - b.s, 0);\nconst week = DAYN.reduce((t, d, i) => t + taskMin(i), 0);\n// the same switch as in the planner's settings (Meta/EX3C Agenda Config.md, planner_use_ideal_week)\nconst CFG = \"Meta/EX3C Agenda Config.md\";\nconst using = dv.page(CFG)?.planner_use_ideal_week === true;\nconst sw = root.createEl(\"label\", { cls: \"iw-note\", attr: { style: \"display:block\" } });\nconst box = sw.createEl(\"input\", { attr: { type: \"checkbox\" } });\nbox.checked = using;\nsw.appendText(\" Use this week in the planner\");\nbox.addEventListener(\"change\", async () => { const f = app.vault.getAbstractFileByPath(CFG); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.planner_use_ideal_week = box.checked; }); });\nif (page?.example === true) root.createEl(\"p\", { cls: \"iw-note\", text: \"These are example blocks: change the lines under Blocks to your own week, then delete the example property.\" });\nif (!blocks.length) root.createEl(\"p\", { cls: \"iw-note\", text: \"No blocks yet. Add lines under ## Blocks, like: - Mon-Fri 09:00 - 12:00 Deep work #tasks\" });\nelse root.createEl(\"p\", { cls: \"iw-note\", text: `Time for tasks (#tasks): ${fmt(week)} a week.${workMin ? ` Work (#work): ${fmt(workMin)} a week${COMMUTE ? `, with ${fmt(COMMUTE)} commute each way` : \"\"}.` : \"\"} ${using ? \"The planner uses each day's task time as that day's hours and shows these blocks behind its week view.\" : \"Switched off: the planner uses your Hours per day and does not show these blocks.\"} ${workMin ? \"Work and commute always show in the planner as blocks, switch or not.\" : \"\"} Click a block to edit its line; the Work tab's Work schedule edits the #work lines.` });\nif (bad.length) root.createEl(\"p\", { cls: \"iw-warn\", text: `Not understood (${bad.length}): ${bad.slice(0, 3).join(\" · \")}. Write lines as \"Mon-Fri 08:00 - 10:00 Deep work\".` });\nif (!blocks.length) return;\n\nconst g0 = Math.floor(Math.min(...blocks.map(b => b.s)) / 60) * 60, g1 = Math.ceil(Math.max(...blocks.map(b => b.e)) / 60) * 60, PX = 0.6;\nconst grid = root.createEl(\"div\", { cls: \"iw-scroll\" }).createEl(\"div\", { cls: \"iw-grid\" });\ngrid.createEl(\"div\");\nLABEL.forEach((d, i) => { const hd = grid.createEl(\"div\", { cls: \"iw-head\", text: d }); hd.createEl(\"div\", { cls: \"iw-sub\", text: taskMin(i) ? `${fmt(taskMin(i))} tasks` : \"no task time\" }); });\nconst hours = grid.createEl(\"div\", { cls: \"iw-hours\", attr: { style: `height:${(g1 - g0) * PX}px` } });\nfor (let t = g0; t < g1; t += 60) hours.createEl(\"span\", { text: clock(t), attr: { style: `top:${(t - g0) * PX}px` } });\nconst open = line => app.workspace.openLinkText(PATH, \"\", false, { eState: { line } });\nDAYN.forEach((d, i) => {\n  const col = grid.createEl(\"div\", { cls: \"iw-col\", attr: { style: `height:${(g1 - g0) * PX}px` } });\n  for (let t = g0; t < g1; t += 60) col.createEl(\"div\", { cls: \"iw-hr\", attr: { style: `top:${(t - g0) * PX}px` } });\n  for (const b of blocks.filter(b => b.days.includes(i))) {\n    const el = col.createEl(\"div\", { cls: `iw-b${b.tasks ? \" is-tasks\" : \"\"}${b.work ? \" is-work\" : \"\"}${b.commute ? \" is-commute\" : \"\"}`, attr: { style: `top:${(b.s - g0) * PX}px;height:${Math.max(14, (b.e - b.s) * PX - 2)}px`, title: `${b.what} ${clock(b.s)} - ${clock(b.e)}${b.tasks ? \" (time for tasks)\" : \"\"}` } });\n    el.createSpan({ text: b.what });\n    if ((b.e - b.s) * PX >= 26) el.createEl(\"small\", { text: `${clock(b.s)} - ${clock(b.e)}` });\n    el.addEventListener(\"click\", () => open(b.line));\n  }\n});\n",
  "modules": "// Optional modules. Usage: await dv.view(\"Meta/views/modules\")\n// Each module is a set of standard notes and folders you may not need. Remove shows the exact list first and\n// moves everything to the vault's .trash folder after you confirm. The layout remembers what went where (and any\n// tab it took), so a removed module's card offers Restore, which puts it all back and can be undone once.\nconst MODULES = [\n  { id: \"wiki\", label: \"Research wiki (claude-obsidian)\", desc: \"The optional add-on where Claude Code files saved answers and researched sources. EX3C Agenda does not use it.\",\n    paths: [\"wiki\", \"Inbox (uncategorised)\", \".raw\", \".claude-obsidian.json\", \"Guide/15 claude-obsidian.md\", \"scripts/template/defaults/wiki\"],\n    after: \"CLAUDE.md still mentions the add-on; remove those lines when you edit it next.\" },\n  { id: \"retreats\", label: \"Personal retreats\", desc: \"The quarterly retreat notes, their template, guide and AI prompts.\",\n    paths: [\"02 Retreats\", \"Templates/Personal Retreat.md\", \"Guide/04 Workflow - Personal Retreat.md\", \"Prompts/04 Retreat Prep.md\", \"Prompts/05 Retreat Facilitation.md\"],\n    after: \"The Life areas widget and the Retreat buttons will show nothing to open; take them off in Configure.\" },\n  { id: \"writing\", label: \"Writing boards\", desc: \"Posts, Video scripts and Reviews: their folders, boards, templates, guide and prompt.\",\n    paths: [\"06 Writing\", \"Templates/Post.md\", \"Templates/Video Script.md\", \"Templates/Review.md\", \"Guide/09 Workflow - Writing.md\", \"00 Dashboards/Boards.md\", \"Prompts/10 Writing Pipeline.md\"],\n    plugins: [\"obsidian-kanban\"], follows: true,\n    after: \"The Create widgets will be empty; they are not on any tab in your layout. Kanban is switched off with it (only the Writing boards use it); Restore switches it back on.\" },\n  { id: \"ai\", label: \"Prompts and the AI page\", desc: \"The prompt library, the Assistant dashboard, the AI guides and the AI tab.\",\n    paths: [\"Prompts\", \"00 Dashboards/Assistant.md\", \"Guide/14 Agent Client and Claude Code.md\", \"Guide/19 Obsidian MCP Bridge.md\", \"Guide/20 Prompt Library.md\"],\n    tabs: [\"ai\"], plugins: [\"agent-client\", \"obsidian-local-rest-api\"], strip: true, after: \"Every AI button in your notes and templates, the links to the Assistant page and the AI setup keys are taken out too. Restore puts each one back where it was.\" },\n  { id: \"examples\", label: \"Example notes\", desc: \"Seed notes tagged example (sample journal days, the example project and person, the sample retreat and book).\",\n    dynamic: () => dv.pages().where(p => (p.file.tags ?? []).includes(\"#example\")).file.path.array() },\n];\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));\nconst life = app.plugins.plugins[\"ex3c-agenda\"];\nfunction h(tag, attrs = {}, parent, text) {\n  const el = document.createElement(tag);\n  for (const [k, v] of Object.entries(attrs)) { if (k === \"class\") el.className = v; else if (k === \"style\") el.style.cssText = v; else el.setAttribute(k, v); }\n  if (text !== undefined) el.textContent = text;\n  if (parent) parent.appendChild(el);\n  return el;\n}\nfunction confirmBox(title, lines, yesText, note) {\n  return new Promise(resolve => {\n    const back = h(\"div\", { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" }, document.body);\n    const card = h(\"div\", { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" }, back);\n    h(\"div\", { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" }, card, `${title}?`);\n    const ul = h(\"ul\", { style: \"max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px\" }, card);\n    for (const l of lines) h(\"li\", {}, ul, l);\n    h(\"div\", { style: \"color:var(--text-muted);font-size:12px;margin:6px 0 10px\" }, card, note || \"\");\n    const row = h(\"div\", { style: \"display:flex;gap:8px;justify-content:flex-end\" }, card);\n    const no = h(\"button\", {}, row, \"Cancel\"), yes = h(\"button\", { class: /^Restore/.test(yesText) ? \"mod-cta\" : \"mod-warning\" }, row, yesText);\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(false); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(false)); yes.addEventListener(\"click\", () => done(true));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(false); });\n    no.focus();\n  });\n}\n// What a module would remove right now: existing files and folders (a folder counts its notes).\nfunction contents(m) {\n  const out = [];\n  for (const p of m.dynamic ? m.dynamic() : m.paths) {\n    const f = app.vault.getAbstractFileByPath(p);\n    if (!f) continue;\n    const notes = f.children ? app.vault.getFiles().filter(x => x.path.startsWith(`${p}/`)).length : 1;\n    out.push({ f, label: f.children ? `${p}/ (folder, ${notes} file${notes === 1 ? \"\" : \"s\"})` : p, notes });\n  }\n  return out;\n}\nconst ad = app.vault.adapter, TRASH = \".trash\";\nconst trashNames = async () => (await ad.exists(TRASH)) ? (await ad.list(TRASH)).files.concat((await ad.list(TRASH)).folders).map(p => p.slice(TRASH.length + 1)) : [];\nasync function countFiles(path) {\n  const st = await ad.stat(path); if (!st) return 0; if (st.type === \"file\") return 1;\n  const l = await ad.list(path); let n = l.files.length; for (const f of l.folders) n += await countFiles(f); return n;\n}\nconst records = () => life?.layout?.modules || {};\n// Plugins a module switches off with it (AI: Agent Client and Local REST API; Writing: Kanban), and back on when restored.\n// follows: the plugin is only there for this module, so while the module is in the vault the card offers to switch it on.\nconst PLUGIN_NAMES = { \"agent-client\": \"Agent Client\", \"obsidian-local-rest-api\": \"Local REST API\", \"obsidian-kanban\": \"Kanban\" };\nconst pluginsOff = m => (m.plugins || []).filter(id => app.plugins.manifests?.[id] && !app.plugins.enabledPlugins.has(id));\nconst pluginsOn = m => (m.plugins || []).filter(id => app.plugins.enabledPlugins.has(id));\nconst pluginsInstalled = m => (m.plugins || []).filter(id => app.plugins.manifests?.[id]);\n// What Restore would bring back: from the record kept at removal, or (for modules removed before records existed)\n// the best match by name at the top of .trash (\"Prompts\", \"Prompts 2\", ...; a folder: the one holding most files).\nasync function restorable(m) {\n  const rec = records()[m.id], items = [], full = rec && !rec.legacy;\n  if (full) {\n    for (const x of rec.moved || []) if (await ad.exists(`${TRASH}/${x.to}`)) items.push({ ...x, files: await countFiles(`${TRASH}/${x.to}`), there: !!app.vault.getAbstractFileByPath(x.from) });\n  } else if (!m.dynamic) {\n    const names = await trashNames(), used = new Set();\n    for (const p of m.paths) {\n      if (app.vault.getAbstractFileByPath(p)) continue;\n      const base = p.split(\"/\").pop(), ext = base.includes(\".\") ? base.slice(base.lastIndexOf(\".\")) : \"\", stem = ext ? base.slice(0, -ext.length) : base;\n      const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")}( \\\\d+)?${ext.replace(\".\", \"\\\\.\")}$`);\n      const cands = [];\n      for (const n of names.filter(n => re.test(n) && !used.has(n))) cands.push({ n, files: await countFiles(`${TRASH}/${n}`) });\n      if (!cands.length) continue;\n      cands.sort((a, b) => b.files - a.files || a.n.length - b.n.length);\n      used.add(cands[0].n);\n      items.push({ from: p, to: cands[0].n, files: cands[0].files, guessed: true, there: false });\n    }\n  }\n  const tabs = full ? (rec.tabs || []).filter(t => !life?.layout?.tabs?.some(x => x.id === t.tab.id)) : (m.tabs || []).filter(id => !life?.layout?.tabs?.some(x => x.id === id)).map(id => ({ std: id }));\n  return { rec, items, tabs };\n}\nasync function ensureFolder(path) {\n  const parts = path.split(\"/\"); parts.pop();\n  for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join(\"/\"); if (p && !app.vault.getAbstractFileByPath(p)) await app.vault.createFolder(p).catch(() => {}); }\n}\n// Moves one trashed file or folder back, through the vault API so Obsidian (desktop and phone) indexes it at once.\nasync function moveBack(src, dest) {\n  const st = await ad.stat(src);\n  if (st.type === \"folder\") {\n    if (!app.vault.getAbstractFileByPath(dest)) await ensureFolder(`${dest}/x`);\n    const l = await ad.list(src);\n    for (const f of [...l.files, ...l.folders]) await moveBack(f, `${dest}/${f.split(\"/\").pop()}`);\n    const left = await ad.list(src);\n    if (!left.files.length && !left.folders.length) await ad.rmdir(src, true).catch(e => console.error(e));\n    return;\n  }\n  await ensureFolder(dest);\n  await app.vault.createBinary(dest, await ad.readBinary(src), { ctime: st.ctime, mtime: st.mtime });\n  await ad.remove(src);\n}\n// Moves the given vault paths to .trash and returns where each one landed.\nasync function toTrash(paths) {\n  const moved = [];\n  for (const p of paths) {\n    const f = app.vault.getAbstractFileByPath(p); if (!f) continue;\n    const before = new Set(await trashNames());\n    try { await app.vault.trash(f, false); } catch (e) { console.error(e); continue; }\n    const to = (await trashNames()).find(n => !before.has(n));\n    if (to) moved.push({ from: p, to });\n  }\n  return moved;\n}\n// AI leftovers inside notes: Agent Client buttons (```agent blocks), lines linking the removed Assistant page, and\n// Setup's AI keys. Removing the AI module takes them out and records each one (note, line, text) so Restore can\n// put it back where it was.\nconst SETUP = \"00 Dashboards/Setup.md\", AI_KEYS = [\"setup_claude_login\", \"setup_mcp_registered\"];\nasync function leftovers() {\n  const out = [];\n  for (const f of app.vault.getMarkdownFiles()) {\n    // journal and retreat notes keep their text (vault rule); their buttons stay hidden by the app while AI is off\n    if (/^(\\.trash|Prompts|01 Journal|02 Retreats|Meta)\\//.test(f.path)) continue;\n    const text = await app.vault.cachedRead(f);\n    if (!/```agent|\\[\\[Assistant[\\]|#]|%%ai%%/.test(text)) continue;\n    const L = text.split(\"\\n\"), blocks = [];\n    // a section that holds nothing but AI buttons and Assistant links goes as a whole, heading included\n    const isHead = l => /^#{1,6}\\s/.test(l);\n    const removable = new Set();\n    for (let i = 0; i < L.length; i++) {\n      if (/^\\s*```agent\\s*$/.test(L[i])) { let j = i + 1; while (j < L.length && !/^\\s*```\\s*$/.test(L[j])) j++; for (let k = i; k <= j; k++) removable.add(k); i = j; }\n      else if (/\\[\\[Assistant[\\]|#]|%%ai%%/.test(L[i])) removable.add(i); // %%ai%% marks a line that is only about AI\n    }\n    for (let i = 0; i < L.length; i++) {\n      if (!isHead(L[i])) continue;\n      let j = i + 1; while (j < L.length && !isHead(L[j])) j++;\n      const body = [...Array(j - i - 1).keys()].map(k => i + 1 + k);\n      if (body.some(k => removable.has(k)) && body.every(k => removable.has(k) || L[k].trim() === \"\")) {\n        blocks.push({ at: i, text: L.slice(i, j).join(\"\\n\"), kind: L.slice(i, j).some(l => /```agent/.test(l)) ? \"button\" : \"link\" });\n        i = j - 1;\n      }\n    }\n    const taken = new Set(blocks.flatMap(b => [...Array(b.text.split(\"\\n\").length).keys()].map(k => b.at + k)));\n    for (let i = 0; i < L.length; i++) {\n      if (taken.has(i)) continue;\n      if (/^\\s*```agent\\s*$/.test(L[i])) {\n        let j = i + 1; while (j < L.length && !/^\\s*```\\s*$/.test(L[j])) j++;\n        let end = j; if (end + 1 < L.length && L[end + 1].trim() === \"\" && (i === 0 || L[i - 1].trim() === \"\")) end++; // and one blank line after it\n        blocks.push({ at: i, text: L.slice(i, end + 1).join(\"\\n\"), kind: \"button\" }); i = end;\n      } else if (/\\[\\[Assistant[\\]|#]|%%ai%%/.test(L[i])) blocks.push({ at: i, text: L[i], kind: \"link\" });\n    }\n    if (blocks.length) out.push({ path: f.path, blocks: blocks.sort((x, y) => x.at - y.at) });\n  }\n  const fm = app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(SETUP) ?? {})?.frontmatter ?? {};\n  const keys = AI_KEYS.filter(k => k in fm).map(k => ({ key: k, value: fm[k] }));\n  return { notes: out, keys };\n}\nasync function stripLeftovers(found) {\n  const done = [];\n  for (const n of found.notes) {\n    const f = app.vault.getAbstractFileByPath(n.path); if (!f) continue;\n    let ok = true;\n    await app.vault.process(f, data => {\n      const L = data.split(\"\\n\");\n      // remove from the bottom up, each only if it is still exactly there\n      for (const b of [...n.blocks].sort((a, c) => c.at - a.at)) {\n        const len = b.text.split(\"\\n\").length;\n        if (L.slice(b.at, b.at + len).join(\"\\n\") !== b.text) { ok = false; continue; }\n        L.splice(b.at, len);\n      }\n      return L.join(\"\\n\");\n    });\n    done.push({ path: n.path, blocks: n.blocks, partial: !ok });\n  }\n  const sf = app.vault.getAbstractFileByPath(SETUP);\n  if (sf && found.keys.length) await app.fileManager.processFrontMatter(sf, fm => { for (const k of found.keys) delete fm[k.key]; });\n  return { notes: done, keys: found.keys };\n}\nasync function putBackLeftovers(rec) {\n  // the Setup keys first: the recorded line numbers count them\n  const sf0 = app.vault.getAbstractFileByPath(SETUP);\n  if (sf0 && rec?.keys?.length) await app.fileManager.processFrontMatter(sf0, fm => { for (const k of rec.keys) fm[k.key] = k.value; });\n  for (const n of rec?.notes || []) {\n    const f = app.vault.getAbstractFileByPath(n.path); if (!f) continue;\n    await app.vault.process(f, data => {\n      const L = data.split(\"\\n\");\n      for (const b of [...n.blocks].sort((a, c) => a.at - c.at)) L.splice(Math.min(b.at, L.length), 0, ...b.text.split(\"\\n\"));\n      return L.join(\"\\n\");\n    });\n  }\n}\nconst UNDO = (window.__ex3cModulesUndo ??= {});\nconst root = h(\"div\", { class: \"mods\" }, dv.container);\nh(\"style\", {}, root, `.mods { font-size: 13px; } .mods-card { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 8px 10px; margin: 8px 0; background: var(--background-primary); }\n.mods-card h4 { margin: 0 0 2px; } .mods-sub { color: var(--text-muted); font-size: 12px; } .mods-card details { font-size: 12px; margin: 4px 0; } .mods-card.is-gone h4 { color: var(--text-muted); }\n.mods-card button { margin: 4px 6px 0 0; } .mods-undo { margin-top: 6px; padding: 4px 8px; border-radius: 6px; background: var(--background-secondary); font-size: 12px; }`);\nconst tabName = id => ({ ai: \"AI\" })[id] || id[0].toUpperCase() + id.slice(1);\nconst fileWord = n => `${n} file${n === 1 ? \"\" : \"s\"}`;\nasync function render() {\n  const cards = [];\n  for (const m of MODULES) {\n    const items = contents(m), tabs = (m.tabs ?? []).filter(t => life?.layout?.tabs?.some(x => x.id === t));\n    const back = await restorable(m);\n    const left = m.strip ? await leftovers() : { notes: [], keys: [] };\n    cards.push({ m, items, tabs, back, left });\n  }\n  root.querySelectorAll(\":scope > div\").forEach(e => e.remove());\n  for (const { m, items, tabs, back, left } of cards) {\n    const nLeft = left.notes.length + (left.keys.length ? 1 : 0);\n    const present = items.length || tabs.length || nLeft, canRestore = back.items.some(x => !x.there) || back.tabs.length || (back.rec?.stripped?.notes?.length && !nLeft);\n    const card = h(\"div\", { class: `mods-card${present ? \"\" : \" is-gone\"}` }, root);\n    h(\"h4\", {}, card, present ? m.label : `${m.label} (removed)`);\n    h(\"div\", { class: \"mods-sub\" }, card, m.desc);\n    if (present) {\n      const total = items.reduce((s, x) => s + x.notes, 0);\n      const det = h(\"details\", {}, card);\n      const buttons = left.notes.filter(n => n.blocks.some(b => b.kind === \"button\")), links = left.notes.filter(n => n.blocks.some(b => b.kind === \"link\"));\n      const leftLines = [...(buttons.length ? [`AI buttons in ${buttons.length} note${buttons.length === 1 ? \"\" : \"s\"} and templates: ${buttons.map(n => n.path.split(\"/\").pop().replace(/\\.md$/, \"\")).join(\", \")}`] : []),\n        ...(links.length ? [`Links to the removed Assistant page in ${links.map(n => n.path.split(\"/\").pop().replace(/\\.md$/, \"\")).join(\", \")}`] : []),\n        ...(left.keys.length ? [`Setup's AI keys: ${left.keys.map(k => k.key).join(\", \")}`] : [])];\n      h(\"summary\", {}, det, [total ? fileWord(total) : \"\", tabs.length ? `the ${tabs.map(tabName).join(\", \")} tab` : \"\", nLeft ? `AI leftovers in ${left.notes.length} note${left.notes.length === 1 ? \"\" : \"s\"}` : \"\"].filter(Boolean).join(\", \"));\n      const ul = h(\"ul\", {}, det); for (const x of items) h(\"li\", {}, ul, x.label); for (const l of leftLines) h(\"li\", {}, ul, l);\n      const b = h(\"button\", { class: \"mod-warning\" }, card, \"Remove…\");\n      b.addEventListener(\"click\", async () => {\n        const lines = [...items.map(x => x.label), ...tabs.map(t => `The ${tabName(t)} tab in EX3C Agenda`), ...pluginsOn(m).map(id => `Switch off the ${PLUGIN_NAMES[id] || id} plugin`), ...leftLines];\n        if (!(await confirmBox(`Remove ${m.label}`, lines, total ? `Move ${fileWord(total)} to .trash` : \"Remove them\", \"Files go to the .trash folder in your vault; buttons and links are taken out of the notes. This card then offers Restore, which puts it all back where it was.\"))) return;\n        const moved = await toTrash(items.map(x => x.f.path));\n        const stripped = nLeft ? await stripLeftovers(left) : null;\n        const tabRecs = tabs.map(id => ({ tab: JSON.parse(JSON.stringify(life.layout.tabs.find(t => t.id === id))), index: life.layout.tabs.findIndex(t => t.id === id) }));\n        const old = records()[m.id];\n        const offed = pluginsOn(m);\n        for (const id of offed) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }\n        await life?.setModuleRecord?.(m.id, { removed: old?.removed || moment().format(\"YYYY-MM-DD HH:mm\"), moved: [...(old?.moved || []), ...moved], tabs: [...(old?.tabs || []).filter(t => !tabRecs.some(x => x.tab.id === t.tab.id)), ...tabRecs], plugins: [...new Set([...(old?.plugins || []), ...offed])],\n          ...(stripped || old?.stripped ? { stripped: { notes: [...(old?.stripped?.notes || []), ...(stripped?.notes || [])], keys: [...(old?.stripped?.keys || []), ...(stripped?.keys || [])] } } : {}) });\n        for (const t of tabs) await life?.deleteTab?.(t);\n        delete UNDO[m.id];\n        notify(`${m.label}: ${fileWord(moved.length ? total : 0)} moved to .trash.${m.after ? ` ${m.after}` : \"\"}`);\n        setTimeout(render, 400);\n      });\n      if (m.after) h(\"div\", { class: \"mods-sub\", style: \"margin-top:4px\" }, card, `After removing: ${m.after}`);\n      const offNow = m.follows ? pluginsOff(m) : [];\n      if (offNow.length) {\n        const names = offNow.map(id => PLUGIN_NAMES[id] || id);\n        h(\"div\", { class: \"mods-sub\", style: \"margin-top:4px\" }, card, `${names.join(\" and \")} ${names.length === 1 ? \"is\" : \"are\"} switched off, so the boards open as plain notes.`);\n        const on = h(\"button\", { class: \"mod-cta\" }, card, `Switch ${names.join(\" and \")} on`);\n        on.addEventListener(\"click\", async () => {\n          for (const id of offNow) { try { await app.plugins.enablePluginAndSave(id); } catch (e) { console.error(e); notify(`Could not switch on ${PLUGIN_NAMES[id] || id}: ${e.message}`); } }\n          notify(`${names.join(\" and \")} switched on for ${m.label}.`);\n          setTimeout(render, 600);\n        });\n      }\n    }\n    if (canRestore) {\n      const todo = back.items.filter(x => !x.there), n = todo.reduce((s, x) => s + x.files, 0);\n      h(\"div\", { class: \"mods-sub\", style: \"margin-top:4px\" }, card, back.rec && !back.rec.legacy ? `Removed ${moment(back.rec.removed, \"YYYY-MM-DD HH:mm\").format(\"DD-MM-YYYY HH:mm\")}. In .trash: ${fileWord(n)}${back.tabs.length ? ` and the ${back.tabs.map(t => t.tab?.label || tabName(t.std)).join(\", \")} tab` : \"\"}.` : `Found in .trash: ${fileWord(n)}${back.tabs.length ? `, and the ${back.tabs.map(t => tabName(t.std)).join(\", \")} page can be added back` : \"\"}.`);\n      const r = h(\"button\", { class: \"mod-cta\" }, card, \"Restore…\");\n      r.addEventListener(\"click\", async () => {\n        const backOn = [...new Set([...(back.rec?.plugins || []), ...(m.follows ? m.plugins : [])])].filter(id => app.plugins.manifests?.[id] && !app.plugins.enabledPlugins.has(id));\n        const lines = [...todo.map(x => `.trash/${x.to} → ${x.from}${x.files > 1 ? ` (${fileWord(x.files)})` : \"\"}`), ...(back.rec?.stripped?.notes || []).map(n => `AI buttons and links back into ${n.path}`), ...backOn.map(id => `Switch the ${PLUGIN_NAMES[id] || id} plugin back on`), ...back.tabs.map(t => `The ${t.tab?.label || tabName(t.std)} tab back in EX3C Agenda`), ...back.items.filter(x => x.there).map(x => `Skipped: ${x.from} already exists`)];\n        if (!(await confirmBox(`Restore ${m.label}`, lines, `Restore ${fileWord(n)}`, back.rec && !back.rec.legacy ? \"Each item goes back to where it was when you removed it.\" : \"These were removed before Restore existed, so they were matched by name in .trash. Check the list.\"))) return;\n        const restored = [];\n        for (const x of todo) { try { await moveBack(`${TRASH}/${x.to}`, x.from); restored.push(x.from); } catch (e) { console.error(e); notify(`Could not restore ${x.from}: ${e.message}`); } }\n        const addedTabs = [];\n        for (const t of back.tabs) {\n          if (t.std) { await life?.restoreTab?.(t.std); addedTabs.push(t.std); continue; }\n          await life?.changeLayout?.(layout => { if (!layout.tabs.some(x => x.id === t.tab.id)) layout.tabs.splice(Math.min(t.index, layout.tabs.length), 0, t.tab); });\n          addedTabs.push(t.tab.id);\n        }\n        for (const id of backOn) { try { await app.plugins.enablePluginAndSave(id); } catch (e) { console.error(e); } }\n        if (back.rec?.stripped) await putBackLeftovers(back.rec.stripped);\n        await life?.setModuleRecord?.(m.id, null);\n        UNDO[m.id] = { paths: restored, tabs: addedTabs, plugins: backOn };\n        notify(`${m.label}: ${fileWord(n)} restored.`);\n        setTimeout(render, 400);\n      });\n    }\n    if (!present && pluginsOn(m).length) {\n      const names = pluginsOn(m).map(id => PLUGIN_NAMES[id] || id);\n      h(\"div\", { class: \"mods-sub\", style: \"margin-top:4px\" }, card, `${names.join(\" and \")} ${names.length === 1 ? \"is\" : \"are\"} still switched on.`);\n      const off = h(\"button\", {}, card, `Switch ${names.length === 1 ? \"it\" : \"them\"} off`);\n      off.addEventListener(\"click\", async () => {\n        if (!(await confirmBox(`Switch off ${names.join(\" and \")}`, names.map(n => `The ${n} plugin`), \"Switch off\", \"Restore switches them back on.\"))) return;\n        const ids = pluginsOn(m);\n        for (const id of ids) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }\n        const rec = records()[m.id];\n        if (rec) await life?.setModuleRecord?.(m.id, { ...rec, plugins: [...new Set([...(rec.plugins || []), ...ids])] });\n        else await life?.setModuleRecord?.(m.id, { removed: moment().format(\"YYYY-MM-DD HH:mm\"), moved: [], tabs: [], plugins: ids, legacy: true });\n        setTimeout(render, 400);\n      });\n    }\n    if (canRestore) {} else if (!present) {\n      h(\"div\", { class: \"mods-sub\", style: \"margin-top:4px\" }, card, \"Removed, and nothing of it is left in .trash to restore.\");\n    }\n    const u = UNDO[m.id];\n    if (u && present) {\n      const box = h(\"div\", { class: \"mods-undo\" }, card, `Restored ${u.paths.length} item${u.paths.length === 1 ? \"\" : \"s\"}. `);\n      const ub = h(\"button\", {}, box, \"Undo restore\");\n      ub.addEventListener(\"click\", async () => {\n        if (!(await confirmBox(`Undo restoring ${m.label}`, [...u.paths, ...u.tabs.map(t => `The ${tabName(t)} tab`)], \"Move back to .trash\", \"Puts these back in .trash; Restore stays available.\"))) return;\n        const moved = await toTrash(u.paths);\n        for (const id of u.plugins || []) { try { await app.plugins.disablePluginAndSave(id); } catch (e) { console.error(e); } }\n        const tabRecs = u.tabs.map(id => ({ tab: JSON.parse(JSON.stringify(life.layout.tabs.find(t => t.id === id) || { id })), index: life.layout.tabs.findIndex(t => t.id === id) })).filter(t => t.index >= 0);\n        await life?.setModuleRecord?.(m.id, { removed: moment().format(\"YYYY-MM-DD HH:mm\"), moved, tabs: tabRecs, plugins: u.plugins || [] });\n        for (const t of u.tabs) await life?.deleteTab?.(t);\n        delete UNDO[m.id];\n        setTimeout(render, 400);\n      });\n    }\n  }\n}\nawait render();\n",
  "planner": "// The planner. Usage: await dv.view(\"Meta/views/planner\", { folders: [\"\"], area: null })\n// Long list: the next step of every project (indentation and [mode:: parallel] decide what is next) plus\n// loose tasks. Short list: one click puts a task on a day by writing ⏳ YYYY-MM-DD on its line, the same\n// scheduled date the Tasks plugin and the daily note's Today section already use. Each day shows its\n// estimated time ([est::]) plus a buffer against your capacity. The timeline shows one day as hours: drag tasks onto\n// it to write a Day Planner time range (- [ ] 10:00 - 11:30 Task ⏳ date), drag blocks to move or resize them.\nconst SCOPE = input?.folders ?? [\"\"];\nconst EXCL = [\"Templates/\", \"scripts/\", \"wiki/\", \".trash/\"];\nconst KEY = \"compass-proto-planner\";\nlet GUESS = 30; // the default estimate: minutes counted for a task without [est::], shown as ~30m (set in ⚙; the project steps chart uses the same)\nconst SOON = 3; // a due date this many days away (or less) counts as urgent, here and in Needs attention\n// Sample notes (tagged example) are left out unless a note passes samples: true.\nconst SAMPLES = input?.samples ?? false;\nconst isSample = p => p.example === true || (p.file.tags ?? []).includes(\"#example\");\n\n// ---------- state ----------\nconst DEFAULTS = { capacity: 4, buffer: 25, weekOffset: 0, sort: \"suggested\", quick: false, dueSoon: false, wholeVault: false, dayStart: \"07:00\", dayEnd: \"21:00\" };\nlet state = { ...DEFAULTS };\ntry { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || \"{}\")); } catch (e) {}\nconst save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };\n// Hours per day, buffer and the day's start and end live in the config note, so the phone and the desktop agree.\nconst CFG_PATH = \"Meta/EX3C Agenda Config.md\";\nconst CFG_KEYS = { defaultEst: \"default_estimate\", capacity: \"planner_hours_per_day\", buffer: \"planner_buffer\", dayStart: \"planner_day_start\", dayEnd: \"planner_day_end\", useIdeal: \"planner_use_ideal_week\" };\n{\n  const cfg = dv.page(CFG_PATH) ?? {};\n  for (const [k, ck] of Object.entries(CFG_KEYS)) {\n    const v = cfg[ck];\n    if (v === undefined || v === null || v === \"\") continue;\n    // a time written without quotes can come back as minutes (YAML reads 07:00 as 420)\n    if (k === \"useIdeal\") state[k] = v === true || v === \"true\";\n    else if (k === \"defaultEst\") state[k] = String(v);\n    else if (k.startsWith(\"day\")) state[k] = typeof v === \"number\" ? `${String(Math.floor(v / 60)).padStart(2, \"0\")}:${String(v % 60).padStart(2, \"0\")}` : String(v);\n    else if (!isNaN(Number(v))) state[k] = Number(v);\n  }\n}\n// The Ideal Week (03 Planning/Ideal Week.md, section Blocks): one line per block, \"Mon-Fri 08:00 - 10:00 Deep work #tasks\".\n// Blocks marked #tasks are the time for tasks. Only while \"Use my Ideal Week\" is on (planner settings, or the switch\n// on the Ideal Week note) do they set each weekday's hours instead of Hours per day and show behind the week view.\nconst IDEAL_PATH = \"03 Planning/Ideal Week.md\";\nconst DAYN = [\"mon\", \"tue\", \"wed\", \"thu\", \"fri\", \"sat\", \"sun\"];\nfunction daysOf(spec) {\n  const out = new Set();\n  for (const part of String(spec).toLowerCase().split(/\\s*,\\s*/)) {\n    if (part === \"daily\" || part === \"every day\") DAYN.forEach((d, i) => out.add(i));\n    else if (part === \"weekdays\") [0, 1, 2, 3, 4].forEach(i => out.add(i));\n    else if (part === \"weekend\") [5, 6].forEach(i => out.add(i));\n    else {\n      const [a, b] = part.split(/\\s*-\\s*/).map(x => DAYN.indexOf(x.slice(0, 3)));\n      if (a < 0) continue;\n      if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }\n    }\n  }\n  return [...out];\n}\nconst IDEAL = (() => {\n  const page = dv.page(IDEAL_PATH);\n  if (!page) return [];\n  const out = [];\n  for (const l of page.file.lists.array()) {\n    if (l.task) continue;\n    const m = String(l.text).match(/^\\s*([A-Za-z][A-Za-z, -]*?)\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+(.+)$/);\n    if (!m) continue;\n    const days = daysOf(m[1]), s = +m[2] * 60 + +m[3], e = +m[4] * 60 + +m[5];\n    if (days.length && e > s) out.push({ days, s, e, what: m[6].replace(/(^|\\s)#(tasks|work)\\b/gi, \" \").trim(), tasks: /(^|\\s)#tasks\\b/i.test(m[6]), work: /(^|\\s)#work\\b/i.test(m[6]) });\n  }\n  return out;\n})();\nconst IDEAL_ON = !!state.useIdeal && IDEAL.some(b => b.tasks);\nconst weekdayOf = date => (asDate(date).getDay() + 6) % 7;\nconst idealOn = date => (state.useIdeal ? IDEAL.filter(b => b.days.includes(weekdayOf(date)) && !b.work) : []);\n// Work is part of the Ideal Week: its blocks marked #work (the Work tab's Work schedule writes them), with the\n// note's commute_minutes before and after each. They are always busy time, whether or not the Ideal Week is used:\n// solid blocks on the hours that tasks are planned around.\nconst WORK = (() => {\n  const c = Number(dv.page(IDEAL_PATH)?.commute_minutes ?? 0) || 0, out = {};\n  for (const b of IDEAL.filter(b => b.work)) for (const i of b.days) (out[i] ??= []).push(...(c ? [{ s: b.s - c, e: b.s, what: \"Commute\", busy: true }] : []), { s: b.s, e: b.e, what: b.what || \"Work\", busy: true, work: true }, ...(c ? [{ s: b.e, e: b.e + c, what: \"Commute\", busy: true }] : []));\n  return out;\n})();\nconst workOn = date => WORK[weekdayOf(date)] ?? [];\n// Birthdays: the birthday property of person notes (1990-03-14, or 03-14), shown on their day every year.\nconst BIRTHDAYS = dv.pages().where(p => (String(p.type ?? \"\") === \"person\" || p.file.path.startsWith(\"05 People/\")) && !p.file.path.startsWith(\"Templates/\") && (SAMPLES || !isSample(p))).array()\n  .map(p => { const v = p.birthday?.toISODate ? p.birthday.toISODate() : String(p.birthday ?? \"\"); const m = v.trim().match(/^(?:(\\d{4})-)?(\\d{1,2})-(\\d{1,2})$/); return m ? { name: p.file.name, path: p.file.path, y: m[1] ? +m[1] : null, md: `${String(+m[2]).padStart(2, \"0\")}-${String(+m[3]).padStart(2, \"0\")}` } : null; }).filter(Boolean);\nconst birthdaysOn = date => BIRTHDAYS.filter(b => b.md === date.slice(5)).map(b => ({ ...b, age: b.y ? +date.slice(0, 4) - b.y : null }));\nfunction birthdayMarks(parent, date) {\n  for (const b of birthdaysOn(date)) {\n    const el = h(\"div\", { class: \"pln-bday\", title: `${b.name}'s birthday${b.age ? `, turns ${b.age}` : \"\"}` }, parent, `🎂 ${b.name}${b.age ? ` (${b.age})` : \"\"}`);\n    el.addEventListener(\"click\", () => app.workspace.openLinkText(b.path, \"\", false));\n  }\n}\n// Project deadlines: the due property of project notes that are not done, on their day (on an area tab, that area's).\nlet PROJECT_DUES = null;\nconst projectDuesOn = date => (PROJECT_DUES ??= dv.pages().where(p => String(p.type ?? \"\") === \"project\" && !/^(Templates|\\.trash|scripts|wiki)\\//.test(p.file.path) && (SAMPLES || !isSample(p))\n  && ![\"done\", \"complete\", \"completed\", \"archived\", \"dropped\"].includes(String(p.status ?? \"\").toLowerCase().trim()) && (!AREA || String(p.area ?? \"\").toLowerCase() === AREA)).array()\n  .map(p => { const v = p.due?.toISODate ? p.due.toISODate() : String(p.due ?? \"\").slice(0, 10); return /^\\d{4}-\\d{2}-\\d{2}$/.test(v) ? { name: p.file.name, path: p.file.path, due: v } : null; }).filter(Boolean))\n  .filter(d => d.due === date);\nfunction projectDueMarks(parent, date, short) {\n  for (const d of projectDuesOn(date)) {\n    const el = h(\"div\", { class: \"pln-due\", title: \"Project deadline (the due property of the project note)\" }, parent, short ? `⚑ ${d.name}` : `⚑ Project due: ${d.name}`);\n    el.addEventListener(\"click\", () => app.workspace.openLinkText(d.path, \"\", false));\n  }\n}\nconst bandsOn = date => idealOn(date);\n{ const m = String(state.defaultEst ?? \"\").trim().toLowerCase(), n = /^\\d+(\\.\\d+)?$/.test(m) ? parseFloat(m) : (() => { let t = 0, hit = false; for (const x of m.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|m)/g)) { hit = true; t += parseFloat(x[1]) * (x[2] === \"h\" ? 60 : 1); } return hit ? t : null; })(); if (n > 0) GUESS = n; }\nasync function saveSetting(k, v) {\n  state[k] = v; save();\n  const f = app.vault.getAbstractFileByPath(CFG_PATH);\n  if (f) await app.fileManager.processFrontMatter(f, fm => { fm[CFG_KEYS[k]] = v; });\n}\n\n// ---------- dates and estimates ----------\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };\nconst NOW = new Date();\nconst TODAY_D = new Date(NOW); TODAY_D.setHours(12, 0, 0, 0);\nconst TODAY = iso(TODAY_D), TOMORROW = iso(addDays(TODAY_D, 1));\nconst mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));\nconst asDate = s => new Date(`${s}T12:00:00`);\nconst dayLabel = s => `${asDate(s).toLocaleDateString(undefined, { weekday: \"short\" })} ${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`; // e.g. Sun 11-10-2026\nconst daysUntil = s => Math.round((asDate(s) - TODAY_D) / 86400000);\nconst parseEst = s => { const v = String(s ?? \"\").trim().toLowerCase().replace(\",\", \".\"); if (/^\\d+(\\.\\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith(\"h\") ? 60 : 1); } return hit ? m : null; };\nconst fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : \"\", m ? `${m}m` : \"\"].filter(Boolean).join(\" \") || \"0m\"; };\nconst clock = min => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min % 60))}`;\nconst parseClock = s => { const m = String(s || \"\").match(/^(\\d{1,2}):(\\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };\n\n// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----\nconst tasksApi = app.plugins.plugins[\"obsidian-tasks-plugin\"]?.apiV1;\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));\nconst TASK_RE = /^(\\s*)[-*+] \\[(.)\\] /;\nconst strip = s => s.replace(TASK_RE, \"\").replace(/\\s*✅ \\d{4}-\\d{2}-\\d{2}/, \"\").trim();\nconst isDoneLine = s => /^\\s*[-*+] \\[[xX-]\\]/.test(s);\nconst parseFields = s => { const f = {}; for (const m of s.matchAll(/\\[([\\w-]+)::\\s*([^\\]]*)\\]/g)) f[m[1]] = m[2].trim(); return f; };\nconst num = v => (v === undefined || v === \"\" || isNaN(Number(v)) ? undefined : Number(v));\nfunction findLine(lines, r) {\n  const key = strip(r.raw);\n  if (lines[r.line] !== undefined && TASK_RE.test(lines[r.line]) && strip(lines[r.line]) === key) return r.line;\n  let best = -1;\n  lines.forEach((l, i) => { if (TASK_RE.test(l) && strip(l) === key && (best < 0 || Math.abs(i - r.line) < Math.abs(best - r.line))) best = i; });\n  return best;\n}\n// mode: \"toggle\" (Tasks plugin done/undone), \"edit\" (Tasks edit dialog), or a function(line) => new line\nasync function writeTask(r, mode) {\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) { notify(`Note not found: ${r.path}`); return false; }\n  const lines = (await app.vault.read(f)).split(\"\\n\");\n  const i = findLine(lines, r);\n  if (i < 0) { notify(\"That task changed in its note. Reopen this page to refresh.\"); return false; }\n  const line = lines[i];\n  let next;\n  if (mode === \"edit\") {\n    if (!tasksApi?.editTaskLineModal) { notify(\"The Tasks plugin edit dialog is not available.\"); return false; }\n    next = await tasksApi.editTaskLineModal(line);\n    if (!next) return false;\n    const ind = line.match(/^\\s*/)[0];\n    next = next.split(\"\\n\").map(l => (l.startsWith(ind) ? l : ind + l.trimStart())).join(\"\\n\");\n  } else if (mode === \"toggle\") {\n    next = tasksApi?.executeToggleTaskDoneCommand\n      ? tasksApi.executeToggleTaskDoneCommand(line, r.path)\n      : line.replace(/\\[(.)\\]/, (m, c) => (c === \" \" ? \"[x]\" : \"[ ]\"));\n  } else {\n    next = mode(line);\n  }\n  if (next === line) return true;\n  let ok = false;\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    const j = findLine(L, r);\n    if (j < 0) return data;\n    const parts = next.split(\"\\n\");\n    L.splice(j, 1, ...parts);\n    r.line = j + parts.length - 1; // Tasks puts a new recurrence above the completed task\n    r.raw = parts[parts.length - 1];\n    ok = true;\n    return L.join(\"\\n\");\n  });\n  if (!ok) notify(\"That task changed in its note. Reopen this page to refresh.\");\n  return ok;\n}\n// ---- end shared ----\n\nfunction setDate(line, emoji, date) {\n  const out = line.replace(new RegExp(`\\\\s*${emoji} \\\\d{4}-\\\\d{2}-\\\\d{2}`, \"u\"), \"\");\n  if (!date) return out;\n  const m = out.match(/\\s\\^[\\w-]+\\s*$/);\n  return m ? `${out.slice(0, m.index)} ${emoji} ${date}${out.slice(m.index)}` : `${out.trimEnd()} ${emoji} ${date}`;\n}\n// A task planned on one day gets ⏳ that day. A task longer than a day's hours is spread over several days:\n// 🛫 on the first day and ⏳ on the last, the same dates the project steps chart draws as one bar.\nfunction setScheduled(line, date) {\n  const m = meta(line);\n  if (m.spread) line = setDate(line, \"🛫\", null); // a spread task planned on one day stops being spread\n  return setDate(line, \"⏳\", date);\n}\n// days a task needs at your hours per day, buffer included (the project steps chart counts the same way)\nconst spanDays = est => (est && capMin() ? Math.max(1, Math.ceil(withBuffer(est) / capMin() - 1e-9)) : 1);\nfunction planLine(line, date) {\n  const m = meta(line);\n  if (!date || m.recur) return setScheduled(line, date);\n  const n = spanDays(m.est);\n  if (n <= 1) return setScheduled(line, date);\n  return setDate(setDate(line, \"🛫\", date), \"⏳\", iso(addDays(asDate(date), n - 1)));\n}\n// Moves a planned task by whole days, keeping a spread task's length.\nfunction shiftLine(line, n) {\n  const m = meta(line);\n  if (m.spread) return setDate(setDate(line, \"🛫\", iso(addDays(asDate(m.start0), n))), \"⏳\", iso(addDays(asDate(m.sched), n)));\n  return setDate(line, \"⏳\", iso(addDays(asDate(m.sched), n)));\n}\nconst PRI = { \"🔺\": 0, \"⏫\": 1, \"🔼\": 2, \"🔽\": 4, \"⏬\": 5 };\nconst PRI_LABEL = [\"highest\", \"high\", \"medium\", \"\", \"low\", \"lowest\"];\n// Day Planner writes a time range right after the checkbox: \"- [ ] 10:00 - 11:30 Task ⏳ 2026-10-12\".\nconst TIME_RE = /^(\\s*[-*+] \\[.\\] )(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+/;\nconst EVENT_RE = /(^|\\s)#event(?=\\s|$)/;\nfunction setTime(line, start, end) {\n  const plain = line.replace(TIME_RE, \"$1\");\n  if (start === null) return plain;\n  return plain.replace(/^(\\s*[-*+] \\[.\\] )/, `$1${clock(start)} - ${clock(end)} `);\n}\nfunction meta(raw) {\n  const f = parseFields(raw);\n  const tm = raw.match(TIME_RE);\n  const start = tm ? Number(tm[2]) * 60 + Number(tm[3]) : null;\n  const end = tm ? Number(tm[4]) * 60 + Number(tm[5]) : null;\n  const pm = raw.match(/[🔺⏫🔼🔽⏬]/u);\n  const price = num(f.price);\n  const sched = raw.match(/⏳ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null, start0 = raw.match(/🛫 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null;\n  const spread = !!(sched && start0 && start0 < sched);\n  const est = parseEst(f.est) ?? (start !== null && end > start ? end - start : null);\n  const ndays = spread ? daysUntil(sched) - daysUntil(start0) + 1 : 1;\n  return {\n    start, end, event: EVENT_RE.test(raw), est, due: raw.match(/📅 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null, sched, start0, spread, ndays,\n    share: est === null ? null : est / ndays, // work per day for a task spread over days\n    commute: parseEst(f.commute) ?? 0, // minutes of travel before and after (drawn on the hours)\n    recur: /🔁/u.test(raw), soon: SOON_LINES.has(raw.trim()) || /(^|\\s)#soon\\b/i.test(raw), created: raw.match(/➕ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null, id: raw.match(/🆔 ([\\w-]+)/u)?.[1] ?? null,\n    deps: (raw.match(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u)?.[1] ?? \"\").split(/\\s*,\\s*/).filter(Boolean),\n    // a priority written on the line wins; unwritten, a Soon task is 🔼 medium and a study task 🔺 highest\n    pri: pm ? PRI[pm[0]] : SOON_LINES.has(raw.trim()) || /(^|\\s)#soon\\b/i.test(raw) ? 2 : STUDY_LINES.has(raw.trim()) ? 0 : 3, ownPri: pm ? PRI[pm[0]] : 3, cost: price !== undefined ? price * (num(f.qty) ?? 1) : null, done: isDoneLine(raw), mode: (f.mode ?? \"\").toLowerCase(),\n    shops: shopsOf(raw),\n  };\n}\n// [shop:: Ikea, Gamma] or the field written twice: the shops where a task can be bought.\nfunction shopsOf(raw) { return [...raw.matchAll(/\\[shop::\\s*([^\\]]*)\\]/g)].flatMap(m => m[1].split(\",\")).map(s => s.trim().replace(/^\"(.*)\"$/, \"$1\")).filter(Boolean); }\n// One errand per shop: tasks with a shop are bought on one trip. A task with several shops joins the shop that\n// already has the most of the list (ties: the first shop written). Returns the trips and the tasks without a shop.\nfunction errands(list) {\n  const trips = new Map(), loose = [], multi = [];\n  for (const r of list) { const s = meta(r.raw).shops; if (!s.length) loose.push(r); else if (s.length === 1) (trips.get(s[0]) ?? trips.set(s[0], []).get(s[0])).push(r); else multi.push(r); }\n  for (const r of multi) { const s = meta(r.raw).shops, best = s.reduce((b, x) => ((trips.get(x)?.length ?? 0) > (trips.get(b)?.length ?? 0) ? x : b), s[0]); (trips.get(best) ?? trips.set(best, []).get(best)).push(r); }\n  return { trips, loose };\n}\n// A trip counts as one task of your default estimate, or its items' own estimates added up when that is more.\nfunction errandMin(list) { return Math.max(GUESS, list.reduce((t, r) => t + (meta(r.raw).share ?? 0), 0)); }\n// Is the task on this day? A spread task is on every day from 🛫 to ⏳.\nconst onDate = (m, date) => (m.spread ? m.start0 <= date && date <= m.sched : m.sched === date);\n// One meaning of urgent everywhere: overdue, then due within SOON days (a Soon task's month ending counts as its\n// due date), then 🔺 highest, ⏫ high, 🔼 medium (Soon tasks), then the rest.\nconst soonLeft = m => (m.soon && m.created ? daysUntil(m.created) + 30 : null);\nconst urgency = m => { if (m.due) { const d = daysUntil(m.due); if (d <= 0) return 0; if (d <= SOON) return 1; } if (m.soon) { const l = soonLeft(m); if (l !== null && l <= SOON) return 1; } return 2 + Math.min(m.pri, 3); };\n// A purchase never holds up the steps after it: buying can happen any time.\nconst isPurchase = r => r.kids.every(k => meta(k.raw).done) && (\"price\" in parseFields(r.raw) || /^(buy|order|purchase)\\b/i.test(label(r.raw)));\nconst label = raw => strip(raw)\n  .replace(/^\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}\\s+/, \"\")\n  .replace(/(^|\\s)#event(?=\\s|$)/g, \" \")\n  .replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\")\n  .replace(/\\s*(📅|⏳|🛫|➕|✅|❌) \\d{4}-\\d{2}-\\d{2}/gu, \"\")\n  .replace(/\\s*🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#^]*/u, \"\")\n  .replace(/[🔺⏫🔼🔽⏬]/gu, \"\")\n  .replace(/#project\\/\\S+/g, \"\")\n  .replace(/\\s*(🆔|⛔) [\\w-]+(?:\\s*,\\s*[\\w-]+)*/gu, \"\")\n  .replace(/(^|\\s)#(work|study|personal|soon|someday)(?=\\s|$)/gi, \" \")\n  .replace(/\\s+/g, \" \").trim();\n\n// ---------- read tasks ----------\nconst SOON_LINES = new Set(); // task lines in the master list's ## Soon\nconst STUDY_LINES = new Set(); // task lines in the study area (#study, or a note with area: study)\nconst pages = dv.pages()\n  .where(p => !EXCL.some(e => p.file.path.startsWith(e)) && p.file.path !== \"10 Areas/Work/Work schedule.md\" /* drawn from the Work schedule itself */ && !/(^|\\/)templates\\//i.test(p.file.path) && String(p.type ?? \"\") !== \"checklist\"\n    && (SAMPLES || !isSample(p)) && (state.wholeVault || SCOPE.some(s => p.file.path.startsWith(s))))\n  .array();\n// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).\nconst AREA = input?.area || null;\n// Area colours from Configure (Meta/EX3C Agenda Layout.md): a task's block takes its area's colour, so work, study and\n// personal stay apart on Home too. Tasks without an area keep the page colour; calendar events stay grey.\nconst AREA_COLORS = { work: \"#4a7fd4\", study: \"#8f6bdc\", personal: \"#4bb38a\", ...(app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaColors?.() ?? {}) };\nconst areaStyle = area => (AREA_COLORS[area] ? `;--blk:${AREA_COLORS[area]}` : \"\");\nconst AREA_KEYS = app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst AREA_TAG = new RegExp(`(^|\\\\s)#(${AREA_KEYS.join(\"|\") || \"(?!)\"})(?=\\\\s|$)`, \"i\");\nconst areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? \"\").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };\nconst ALL = [];\nconst ROWS = new Map(); // page path -> its task rows\nfor (const page of pages) {\n  const rows = [];\n  const walk = (items, depth, parent) => {\n    for (const it of items) {\n      if (!it.task) { walk(it.children ?? [], depth, parent); continue; }\n      const tag = (it.tags ?? []).find(t => t.startsWith(\"#project/\"));\n      // only the task's own line (a missing blank line before a heading must not pull the heading in)\n      const text = String(it.text).split(\"\\n\")[0].replace(/\\s+#{1,6}\\s.*$/, \"\");\n      // a lecture note's tasks belong to its course\n      const owner = page.course?.path ? page.course.path.split(\"/\").pop().replace(/\\.md$/, \"\") : typeof page.course === \"string\" && page.course.trim() ? page.course.trim() : page.file.name;\n      // the master list's ## Soon and ## Eventually (inbox triage); ## Someday counts as Eventually\n      const listName = page.file.path === \"08 Tasks/Tasks.md\" ? String(it.section?.subpath ?? \"\").toLowerCase() : \"\";\n      const someday = listName === \"eventually\" || listName === \"someday\" || /(^|\\s)#someday\\b/i.test(text);\n      const inSoon = listName === \"soon\";\n      const r = { path: it.path, line: it.line, raw: `${\"\\t\".repeat(depth)}- [${it.status}] ${text}`, depth, kids: [], isNext: false, someday, inSoon,\n        project: tag ? tag.slice(9) : owner, area: areaOf(text, page) };\n      r.key = `${r.path}|${label(r.raw)}`;\n      if (rows.some(x => x.key === r.key)) r.key += `|${rows.filter(x => x.key.startsWith(`${r.key}|`)).length + 2}`; // the same text twice in a note (a repeat purchase) stays two tasks\n      if (inSoon) SOON_LINES.add(r.raw.trim());\n      if (r.area === \"study\") STUDY_LINES.add(r.raw.trim());\n      rows.push(r);\n      if (parent) parent.kids.push(r);\n      walk(it.children ?? [], depth + 1, r);\n    }\n  };\n  walk(page.file.lists.where(l => l.parent === undefined || l.parent === null).array(), 0, null);\n  ALL.push(...rows);\n  ROWS.set(page.file.path, { rows, isProject: String(page.type ?? \"\") === \"project\" });\n}\n// ⛔ waits for the open task with that 🆔 (anywhere in the vault, as in the Tasks plugin).\nconst BY_ID = new Map();\nfor (const r of ALL) { const m = meta(r.raw); if (m.id && !m.done) BY_ID.set(m.id, r); }\nconst blockers = r => meta(r.raw).deps.map(id => BY_ID.get(id)).filter(b => b && !meta(b.raw).done);\n// On an area tab only that area's tasks are shown (what counts as \"next\" still uses the whole outline).\n// (calendar events are fixed times whatever the area, so they show on every area tab)\n// The day's load, capacity and Suggest's budget still count every area (EVERY): one day, one person.\nconst EVERY = [...ALL];\nif (AREA) ALL.splice(0, ALL.length, ...ALL.filter((r) => r.area === AREA || EVENT_RE.test(r.raw)));\n// What is \"next\": in a project note the top-level steps run in order; elsewhere every top-level task stands alone.\n// Purchases never hold up the steps after them, a ⏫ or 🔺 step is next wherever it sits, and a step waiting\n// for a ⛔ is never next. Every other open step is \"later\" and says what it waits for.\nfunction markNext() {\n  for (const r of ALL) { r.isNext = false; r.after = null; r.blockedBy = null; }\n  const done = r => meta(r.raw).done;\n  const actionable = r => (done(r) ? [] : r.kids.some(k => !done(k)) ? fromList(r.kids, meta(r.raw).mode === \"parallel\") : [r]);\n  // [with:: previous] on a step: it is next together with the step above it\n  const withPrev = r => /\\[with::\\s*previous\\s*\\]/i.test(r.raw);\n  const fromList = (list, par) => {\n    const open = list.filter(k => !done(k));\n    if (par) return open.flatMap(actionable);\n    const group = [];\n    let i = 0;\n    for (; i < open.length; i++) { group.push(open[i]); if (!isPurchase(open[i])) break; }\n    for (i++; i < open.length && withPrev(open[i]); i++) group.push(open[i]);\n    return group.flatMap(actionable);\n  };\n  for (const { rows, isProject } of ROWS.values()) {\n    const top = rows.filter(r => r.depth === 0);\n    const nexts = isProject ? fromList(top, false) : top.flatMap(actionable);\n    const leaves = rows.filter(r => !done(r) && !r.kids.some(k => !done(k)));\n    for (const r of leaves) if (meta(r.raw).ownPri <= 1 && !nexts.includes(r)) nexts.push(r);\n    for (const r of nexts) r.isNext = true;\n    const first = nexts.find(r => !blockers(r).length);\n    for (const r of leaves) if (!r.isNext) r.after = first ? label(first.raw) : null;\n  }\n  for (const r of ALL) if (r.isNext && blockers(r).length) { r.isNext = false; r.blockedBy = blockers(r).map(b => label(b.raw)); }\n}\n\n// ---------- dom ----------\nfunction h(tag, attrs = {}, parent, text) {\n  const el = document.createElement(tag);\n  for (const [k, v] of Object.entries(attrs)) {\n    if (k === \"class\") el.className = v; else if (k === \"style\") el.style.cssText = v; else el.setAttribute(k, v);\n  }\n  if (text !== undefined) el.textContent = text;\n  if (parent) parent.appendChild(el);\n  return el;\n}\nconst root = h(\"div\", { class: \"pln\" }, dv.container);\nh(\"style\", {}, root, `\n.pln { font-size: 13px; }\n.pln button.pln-btn { font-size: 12px; padding: 1px 7px; height: auto; }\n.pln-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 10px; }\n.pln-bar input[type=number] { width: 4.5em; }\n.pln-bar input[type=time] { width: 7em; }\n.pln-sub { font-size: 11px; color: var(--text-muted); }\n.pln-box { border: 1px solid var(--background-modifier-border); border-radius: 8px; background: var(--background-secondary); padding: 8px 10px; margin-bottom: 10px; container-type: inline-size; }\n.pln-box h4 { margin: 0 0 6px; }\n.pln-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }\n@media (max-width: 700px) { .pln-week { grid-template-columns: repeat(2, minmax(0, 1fr)); } }\n.pln-day { border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 6px; background: var(--background-primary); min-height: 90px; }\n.pln-day.is-today { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }\n.pln-day.is-past { opacity: .6; }\n.pln-day-head { display: flex; justify-content: space-between; font-weight: 600; font-size: 12px; }\n.pln-cap { height: 6px; border-radius: 3px; background: var(--background-modifier-border); margin: 4px 0 2px; overflow: hidden; }\n.pln-cap > div { height: 6px; background: var(--color-green); }\n.pln-cap.is-full > div { background: var(--color-orange); }\n.pln-cap.is-over > div { background: var(--color-red); }\n.pln-item { display: flex; gap: 4px; align-items: flex-start; padding: 3px 2px; border-top: 1px solid var(--background-modifier-border); font-size: 12px; line-height: 1.25; }\n.pln-item .pln-text { flex: 1; cursor: pointer; min-width: 0; overflow-wrap: break-word; }\n.pln-day .pln-item { position: relative; }\n.pln-day .pln-acts { position: absolute; right: 0; top: 2px; background: var(--background-primary); border-radius: 4px; opacity: 0; }\n.pln-day .pln-item:hover .pln-acts, .pln-day .pln-item:focus-within .pln-acts { opacity: 1; }\n@media (hover: none) { .pln-day .pln-item { flex-wrap: wrap; } .pln-day .pln-acts { position: static; opacity: 1; flex-basis: 100%; justify-content: flex-end; } }\n.pln-item.is-done .pln-text { text-decoration: line-through; color: var(--text-faint); }\n.pln-acts { display: flex; gap: 1px; flex-shrink: 0; }\n.pln-acts span { cursor: pointer; color: var(--text-muted); padding: 0 2px; }\n.pln-acts span:hover { color: var(--text-accent); }\n.pln-errand { font-size: 13px; margin: 2px 0 6px; overflow-wrap: anywhere; }\n.pln-chip { font-size: 10px; padding: 0 5px; border-radius: 8px; border: 1px solid var(--background-modifier-border); color: var(--text-muted); white-space: nowrap; }\n.pln-chip.is-due { color: var(--color-red); border-color: var(--color-red); }\n.pln-chip.is-soon { color: var(--color-orange); border-color: var(--color-orange); }\n.pln-chip.is-guess { border-style: dashed; }\n.pln-table { width: 100%; border-collapse: collapse; }\n.pln-table td { padding: 3px 4px; border-top: 1px solid var(--background-modifier-border); vertical-align: top; font-size: 12px; }\n.pln-table tr.is-suggested td { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }\n.pln-weektotal { margin: 4px 2px 10px; font-weight: 600; }\n.pln-table tr.pln-total td { color: var(--text-muted); font-size: 11px; font-weight: 600; border-top: 1px dashed var(--background-modifier-border); }\n.pln-table .pln-acts { display: inline-flex; vertical-align: middle; } /* the ✎ sits after the plan buttons, not on a line of its own */\n/* a narrow card (a phone): each task wraps onto two lines, text first, the plan buttons under it, instead of widening the page */\n@container (max-width: 520px) {\n  .pln-table, .pln-table tbody { display: block; }\n  .pln-table tr { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); }\n  .pln-table td { border-top: none; padding: 0; }\n  .pln-table td.pln-c-text { flex: 1 1 0; min-width: 0; }\n  .pln-table td.pln-c-act { flex-basis: 100%; display: flex; justify-content: flex-end; align-items: center; gap: 3px; }\n  .pln-table td.pln-c-act > * { margin-left: 0 !important; }\n  .pln-table tr.is-suggested { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }\n  .pln-table tr.is-suggested td { background: none; }\n}\n.pln-time { font-variant-numeric: tabular-nums; color: var(--text-muted); white-space: nowrap; }\n.pln-tl-row { display: flex; gap: 8px; align-items: center; padding: 3px 0; border-top: 1px solid var(--background-modifier-border); }\n.pln-tl-row.is-now { font-weight: 600; }\n.pln-chip.is-time { color: var(--text-accent); border-color: var(--text-accent); }\n.pln-day.is-shown .pln-day-head { color: var(--text-accent); }\n.pln-day.is-drop, .pln-pool.is-drop { outline: 2px dashed var(--interactive-accent); outline-offset: -2px; }\n.pln-tlw { display: grid; grid-template-columns: minmax(180px, 2fr) 3fr; gap: 10px; align-items: start; }\n@media (max-width: 700px) { .pln-tlw { grid-template-columns: 1fr; } }\n.pln-pool { max-height: 560px; overflow: auto; border-radius: 6px; min-height: 60px; }\n@media (max-width: 700px) { .pln-pool { max-height: 220px; } }\n.pln-pool h5 { margin: 6px 0 3px; font-size: 12px; color: var(--text-muted); }\n.pln-pi { display: flex; gap: 4px; align-items: center; padding: 4px 6px; margin: 3px 0; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); cursor: grab; font-size: 12px; user-select: none; -webkit-user-select: none; touch-action: manipulation; }\n.pln-pi[style*=\"--blk\"] { border-left: 3px solid var(--blk); }\n.pln-pi.is-picked { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }\n.pln-pi .pln-text { flex: 1; min-width: 0; overflow-wrap: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.pln-gs { max-height: 560px; overflow: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-primary); }\n.pln-grid { position: relative; margin: 8px 0 8px 44px; border-left: 1px solid var(--background-modifier-border); }\n.pln-grid.is-picking { cursor: copy; background: color-mix(in srgb, var(--interactive-accent) 6%, transparent); }\n.pln-hr { position: absolute; left: 0; right: 0; border-top: 1px solid var(--background-modifier-border); }\n.pln-hr.is-half { border-top-style: dotted; opacity: .6; }\n.pln-hr span { position: absolute; left: -42px; top: -7px; font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }\n.pln-now { position: absolute; left: 0; right: 0; border-top: 2px solid var(--color-red); z-index: 3; pointer-events: none; }\n.pln-blk { position: absolute; box-sizing: border-box; border-radius: 5px; padding: 2px 5px 6px; font-size: 11px; line-height: 1.2; overflow: hidden; z-index: 2;\n  background: color-mix(in srgb, var(--blk, var(--interactive-accent)) 22%, var(--background-primary)); border: 1px solid var(--blk, var(--interactive-accent)); cursor: grab; user-select: none; -webkit-user-select: none; touch-action: manipulation; }\n.pln-work { position: absolute; left: 2px; right: 2px; box-sizing: border-box; z-index: 1; border-radius: 5px; padding: 2px 5px; font-size: 11px; line-height: 1.2; overflow: hidden; cursor: default;\n  background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--blk) 34%, var(--background-primary)) 0 7px, color-mix(in srgb, var(--blk) 20%, var(--background-primary)) 7px 14px); border: 1px solid var(--blk); }\n.pln-work.is-commute { background: color-mix(in srgb, var(--blk) 9%, var(--background-primary)); border-style: dashed; border-color: color-mix(in srgb, var(--blk) 60%, transparent); color: var(--text-muted); font-size: 10px; }\n.pln-work.is-other { background: color-mix(in srgb, var(--blk) 12%, transparent); border: 0; border-left: 2px solid color-mix(in srgb, var(--blk) 50%, transparent); border-radius: 0; color: var(--text-faint); }\n.pln-work.is-other.is-commute { background: color-mix(in srgb, var(--blk) 6%, transparent); border-left-style: dashed; }\n.pln-work .pln-bt { font-variant-numeric: tabular-nums; color: var(--text-muted); }\n.pln-blk.is-event { background: var(--background-secondary-alt); border-color: var(--background-modifier-border); cursor: default; }\n.pln-blk.is-event[style*=\"--blk\"] { background: color-mix(in srgb, var(--blk) 12%, var(--background-secondary-alt)); border-color: color-mix(in srgb, var(--blk) 45%, var(--background-modifier-border)); border-left: 3px solid var(--blk); }\n.pln-blk.is-done { opacity: .5; text-decoration: line-through; }\n.pln-blk.is-ghost { opacity: .55; border-style: dashed; pointer-events: none; z-index: 4; }\n.pln-blk .pln-bt { font-variant-numeric: tabular-nums; color: var(--text-muted); }\n.pln-blk .pln-x { position: absolute; right: 3px; top: 1px; cursor: pointer; color: var(--text-muted); }\n.pln-blk .pln-rs { position: absolute; left: 0; right: 0; bottom: 0; height: 7px; cursor: ns-resize; touch-action: none; }\n.pln-drag { position: fixed; z-index: 1000; pointer-events: none; padding: 3px 8px; border-radius: 6px; font-size: 12px; background: var(--background-primary); border: 1px solid var(--interactive-accent); box-shadow: var(--shadow-s); max-width: 240px; }\n.pln-due { font-size: 11px; color: var(--color-red); border-top: 1px dashed var(--background-modifier-border); padding: 3px 2px; cursor: pointer; }\n.pln-answer { margin: 0 0 6px; font-weight: 600; }\n.pln-bday { font-size: 11px; color: var(--text-accent); padding: 2px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.pln-ideal { position: absolute; left: 0; right: 0; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--text-faint) 10%, transparent); border-top: 1px solid color-mix(in srgb, var(--text-faint) 25%, transparent); overflow: hidden; }\n.pln-ideal.is-tasks { background: color-mix(in srgb, var(--interactive-accent) 18%, transparent); border-top-color: color-mix(in srgb, var(--interactive-accent) 35%, transparent); }\n.pln-ideal.is-busy { z-index: 1; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--text-faint) 16%, transparent) 0 6px, transparent 6px 12px); border-top-color: color-mix(in srgb, var(--text-faint) 40%, transparent); }\n.pln-ideal span { position: absolute; right: 3px; top: 1px; font-size: 9px; color: var(--text-faint); white-space: nowrap; }\n.pln-seg { display: inline-flex; gap: 2px; margin-left: 8px; vertical-align: middle; font-weight: normal; }\n.pln button.pln-btn.is-on { background: var(--interactive-accent); color: var(--text-on-accent); }\n.pln-pi.is-suggested { background: color-mix(in srgb, var(--interactive-accent) 14%, var(--background-primary)); }\n.pln-pi .pln-chips { display: inline-flex; flex-wrap: wrap; gap: 2px; justify-content: flex-end; }\n.pln-wkw { display: grid; grid-template-columns: minmax(150px, 210px) minmax(0, 1fr); gap: 10px; align-items: start; }\n.pln-wkw.is-narrow { grid-template-columns: minmax(0, 1fr); }\n.pln-wkw.is-narrow .pln-pool { max-height: 200px; }\n.pln-cal { min-width: 0; }\n.pln-cal-strip { overflow: auto; max-height: 70vh; min-width: 0; scroll-snap-type: x proximity; border: 1px solid var(--background-modifier-border); border-radius: 6px; }\n.pln-cal.is-strip { width: max-content; }\n.pln-cal.is-strip .pln-gs { max-height: none; overflow: visible; border: 0; border-radius: 0; }\n/* the dates stay on top while the hours scroll */\n.pln-cal.is-strip > .pln-cal-row:first-child { position: sticky; top: 0; z-index: 4; background: var(--background-secondary); }\n.pln-cal.is-strip .pln-cal-row { grid-template-columns: 38px repeat(var(--n), 108px); }\n.pln-cal.is-strip .pln-cal-dh { scroll-snap-align: start; scroll-margin-left: 38px; }\n/* the hours (and the corner above them) stay put while the days scroll */\n.pln-cal.is-strip .pln-cal-row > :first-child { position: sticky; left: 0; z-index: 3; background: var(--background-secondary); }\n.pln-cal.is-strip > .pln-cal-row:first-child > :first-child { z-index: 5; }\n.pln-cal-row { display: grid; grid-template-columns: 38px repeat(var(--n), minmax(0, 1fr)); }\n.pln-cal-dh { padding: 3px 4px; font-size: 11px; font-weight: 600; border-left: 1px solid var(--background-modifier-border); cursor: pointer; min-width: 0; }\n.pln-cal-dh.is-today { color: var(--text-accent); }\n.pln-cal-dh.is-past { opacity: .6; }\n.pln-cal-dh .pln-sub { font-weight: normal; font-size: 10px; }\n.pln-cal-gut { font-size: 10px; color: var(--text-muted); padding: 4px 2px 0 0; text-align: right; }\n.pln-cal .pln-day.pln-lane { min-height: 34px; border-radius: 0; padding: 2px; border-width: 1px 0 0 1px; background: var(--background-primary); box-shadow: none; min-width: 0; }\n.pln-cal .pln-lane .pln-pi { margin: 2px 0; padding: 2px 4px; font-size: 11px; flex-direction: column; align-items: stretch; gap: 1px; }\n.pln-cal .pln-lane .pln-pi .pln-chips { justify-content: flex-start; }\n.pln-cal .pln-lane .pln-due { font-size: 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }\n.pln-cal-body { margin-top: 4px; }\n.pln-cal-body .pln-cal-row { padding: 8px 0; }\n.pln-cal-hours { position: relative; }\n.pln-cal-hours span { position: absolute; right: 4px; transform: translateY(-6px); font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }\n.pln-cal .pln-grid { margin: 0; border-left: 1px solid var(--background-modifier-border); min-width: 0; }\n.pln-cal .pln-blk { font-size: 10px; padding: 1px 3px 6px; }\n.pln-sel { position: absolute; left: 0; right: 0; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }\n.pln-selframe { position: absolute; z-index: 3; pointer-events: none; --a: var(--interactive-accent); --b: var(--background-primary);\n  background-image: linear-gradient(90deg, var(--a) 50%, var(--b) 50%), linear-gradient(90deg, var(--a) 50%, var(--b) 50%), linear-gradient(0deg, var(--a) 50%, var(--b) 50%), linear-gradient(0deg, var(--a) 50%, var(--b) 50%);\n  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y; background-size: 10px 2px, 10px 2px, 2px 10px, 2px 10px; background-position: 0 0, 0 100%, 0 0, 100% 0; animation: pln-ants .7s linear infinite; }\n@keyframes pln-ants { to { background-position: 10px 0, -10px 100%, 0 -10px, 100% 10px; } }\n@media (prefers-reduced-motion: reduce) { .pln-selframe { animation: none; } }\n.pln-selframe span { position: absolute; top: 3px; right: 4px; font-size: 10px; font-weight: 600; color: var(--interactive-accent); background: var(--background-primary); border-radius: 3px; padding: 0 3px; }\n.pln-selbox { border: 1px solid var(--interactive-accent); border-radius: 6px; background: var(--background-primary); padding: 6px 8px; margin: 8px 0; }\n.pln-selhd { display: flex; gap: 6px; align-items: flex-start; margin-bottom: 4px; }\n.pln-seltitle { flex: 1; min-width: 0; font-weight: 600; }\n.pln-selbar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--text-faint) 14%, transparent); margin: 2px 0 6px; }\n.pln-selbar .is-tasks { background: var(--interactive-accent); }\n.pln-selbar .is-busy { background: repeating-linear-gradient(135deg, var(--text-faint) 0 4px, color-mix(in srgb, var(--text-faint) 50%, transparent) 4px 8px); }\n.pln-selnums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 4px; }\n.pln-selnums div { display: flex; flex-direction: column; line-height: 1.2; }\n.pln-selnums b { font-size: 14px; white-space: nowrap; }\n.pln-selnums span { font-size: 11px; color: var(--text-muted); }\n.pln-selnums .is-tasks b { color: var(--interactive-accent); }\n.pln-sellist { margin-top: 4px; border-top: 1px solid var(--background-modifier-border); padding-top: 4px; }\n.pln-selrow { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }\n.pln-selrow .pln-bt { font-size: 11px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }\n.pln-selrow input { margin: 0; align-self: center; }\n.pln-commute { display: inline-flex; gap: 4px; align-items: center; flex-wrap: wrap; }\n.pln-commute input[type=number] { width: 4.2em; }\n.pln-work.is-trip { left: 2px; right: 2px; padding: 0 3px; z-index: 0; }\n.pln-work.is-trip b { font-size: 9px; font-weight: 500; }\n.pln-work.is-trip.is-back { display: flex; align-items: flex-end; }\n.pln-selrow .pln-text { cursor: pointer; flex: 1; min-width: 0; }\n.pln-selrow.is-done .pln-text { text-decoration: line-through; color: var(--text-muted); }\n`);\n\nlet suggestion = null; // array of task keys proposed for today\nconst byKey = new Map();\n\nasync function act(r, mode, optimistic) {\n  const before = r.raw;\n  if (optimistic) { r.raw = optimistic(r.raw); render(); r.raw = before; }\n  const ok = await writeTask(r, mode);\n  if (!ok) r.raw = before;\n  render();\n  return ok;\n}\n// Every change to more than one task asks first (with the count and the tasks), and can be undone in one go:\n// the exact lines before and after are kept, and Undo puts back each line that is still as this change left it.\n// A plain overlay (no Obsidian Modal: views cannot always load the obsidian module, and window.confirm\n// does not work on phones). Resolves true on \"Yes\", false on Cancel, Escape, or a click outside.\nfunction confirmModal(title, lines) {\n  return new Promise(resolve => {\n    const back = h(\"div\", { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" }, document.body);\n    const card = h(\"div\", { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:520px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" }, back);\n    h(\"div\", { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" }, card, `${title}?`);\n    const ul = h(\"ul\", { style: \"max-height:40vh;overflow:auto;font-size:13px;margin:4px 0;padding-left:18px\" }, card);\n    for (const l of lines.slice(0, 50)) h(\"li\", {}, ul, l);\n    if (lines.length > 50) h(\"div\", { class: \"pln-sub\" }, card, `and ${lines.length - 50} more`);\n    h(\"div\", { class: \"pln-sub\", style: \"margin:6px 0 10px\" }, card, \"You can undo this afterwards with Undo at the top of the planner.\");\n    const row = h(\"div\", { style: \"display:flex;gap:8px;justify-content:flex-end\" }, card);\n    const no = h(\"button\", {}, row, \"Cancel\"), yes = h(\"button\", { class: \"mod-cta\" }, row, \"Yes, change them\");\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(false); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(false));\n    yes.addEventListener(\"click\", () => done(true));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(false); });\n    yes.focus();\n  });\n}\nconst UNDO_KEY = `${KEY}-undo`;\nconst loadUndo = () => { try { return JSON.parse(localStorage.getItem(UNDO_KEY) || \"null\"); } catch (e) { return null; } };\nasync function bulk(list, title, fn) {\n  if (!list.length) return;\n  if (list.length > 1 && !(await confirmModal(title, list.map(r => `${label(r.raw)} (${r.path.split(\"/\").pop().replace(/\\.md$/, \"\")})`)))) return;\n  const items = [];\n  for (const r of list) {\n    let before = null;\n    if (await writeTask(r, line => { before = line; return fn(line, r); }) && before !== null && before !== r.raw) items.push({ path: r.path, before, after: r.raw });\n  }\n  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items })); } catch (e) {}\n  notify(`${title}: done. Undo is at the top of the planner.`);\n  render();\n}\nasync function undoLast() {\n  const u = loadUndo();\n  if (!u?.items?.length) return;\n  let back = 0, changed = 0;\n  for (const [path, its] of Object.entries(u.items.reduce((m, it) => ((m[it.path] ??= []).push(it), m), {}))) {\n    const f = app.vault.getAbstractFileByPath(path);\n    if (!f) { changed += its.length; continue; }\n    await app.vault.process(f, data => {\n      const L = data.split(\"\\n\");\n      for (const it of its) { const i = L.indexOf(it.after); if (i < 0) { changed++; continue; } if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; } // before null: the line was added, so remove it\n      return L.join(\"\\n\");\n    });\n  }\n  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}\n  notify(`Undone: ${back} task${back === 1 ? \"\" : \"s\"} put back${changed ? `; ${changed} had changed since and were left alone` : \"\"}.`);\n}\nconst schedule = (r, date) => act(r, line => planLine(line, date), line => planLine(line, date));\nconst shift = (r, n) => act(r, line => shiftLine(line, n), line => shiftLine(line, n));\nconst toggle = r => act(r, \"toggle\", line => line.replace(/\\[(.)\\]/, (m, c) => (c === \" \" ? \"[x]\" : \"[ ]\")));\nconst edit = r => act(r, \"edit\");\nconst openAt = r => { try { app.workspace.openLinkText(r.path, \"\", false, { eState: { line: r.line } }); } catch (e) { console.warn(e); } };\n// A task's menu: right-click it, or on a phone press and hold it and let go without moving (moving drags it).\n// Edit task is the Tasks plugin's dialog, where EX3C AgendA adds the fields (length, price, shop and the rest).\nconst EX3C = app.plugins.plugins[\"ex3c-agenda\"];\nfunction taskMenu(ev, r) {\n  ev?.preventDefault?.();\n  if (!EX3C?.showMenu) { edit(r); return; }\n  const m = meta(r.raw), items = [];\n  if (!m.event) items.push({ title: \"Edit task…\", icon: \"pencil\", run: () => edit(r) });\n  if (!m.done && !m.event && !m.recur) {\n    if (m.sched !== TODAY) items.push({ title: \"Do today\", icon: \"calendar-check\", run: () => schedule(r, TODAY) });\n    if (m.sched !== TOMORROW) items.push({ title: \"Do tomorrow\", icon: \"calendar-plus\", run: () => schedule(r, TOMORROW) });\n    if (m.start !== null) items.push({ title: \"Remove the time\", icon: \"clock\", run: () => unTime(r) });\n    if (m.sched) items.push({ title: \"Take off the plan\", icon: \"calendar-x\", run: () => schedule(r, null) });\n  }\n  if (!m.event) items.push({ title: m.done ? \"Mark as not done\" : \"Mark as done\", icon: \"check-square\", run: () => toggle(r) });\n  EX3C.showMenu(ev, [...items, \"-\", { title: \"Open in its note\", icon: \"file-text\", run: () => openAt(r) }]);\n}\nconst menuOn = (el, r) => el.addEventListener(\"contextmenu\", ev => { ev.preventDefault(); ev.stopPropagation(); if (!drag) taskMenu(ev, r); }); // during a drag the press is the drag's\n\nfunction chips(parent, r, m, { showSched = false, noBlocked = false } = {}) {\n  if (m.start !== null) h(\"span\", { class: \"pln-chip is-time\", title: \"Time block (set in Day Planner or by Put on the timeline)\" }, parent, `${clock(m.start)} - ${clock(m.end)}`);\n  if (m.event) { h(\"span\", { class: \"pln-chip\", title: \"Calendar event\" }, parent, \"event\"); return; }\n  const est = m.est;\n  h(\"span\", { class: `pln-chip${est === null ? \" is-guess\" : \"\"}`, title: est === null ? `No estimate yet; planned as ${GUESS} minutes` : \"Estimate\" }, parent, est === null ? `~${GUESS}m` : fmtEst(est));\n  if (m.spread) h(\"span\", { class: \"pln-chip\", title: `Spread over ${m.ndays} days (🛫 ${dayLabel(m.start0)} to ⏳ ${dayLabel(m.sched)}), ${fmtEst(m.share ?? 0)} a day` }, parent, `${m.ndays} days`);\n  else if (!m.recur && est !== null && spanDays(est) > 1) h(\"span\", { class: \"pln-chip is-soon\", title: m.sched ? `Longer than your ${state.capacity} hours a day but planned on one day: ⇉ spreads it over ${spanDays(est)} days` : `Longer than your ${state.capacity} hours a day: planning it spreads it over ${spanDays(est)} days` }, parent, m.sched ? \"over a day\" : `${spanDays(est)} days`);\n  if (m.soon) { const l = soonLeft(m); h(\"span\", { class: `pln-chip${l !== null && l < 0 ? \" is-due\" : \" is-soon\"}`, title: \"In ## Soon: plan it within a month of capture\" }, parent, l === null ? \"soon\" : l < 0 ? `soon, ${-l}d over` : `soon, ${l}d left`); }\n  if (m.recur) h(\"span\", { class: \"pln-chip\", title: \"Repeating task: ticking it makes the next one (Tasks plugin); the planner never moves its date\" }, parent, \"repeats\");\n  if (m.due) {\n    const d = daysUntil(m.due);\n    h(\"span\", { class: `pln-chip${d < 0 ? \" is-due\" : d <= 2 ? \" is-soon\" : \"\"}`, title: `Due ${m.due}` }, parent, d < 0 ? `overdue ${-d}d` : d === 0 ? \"due today\" : d === 1 ? \"due tomorrow\" : `due in ${d}d`);\n  }\n  if (m.pri < 3) h(\"span\", { class: \"pln-chip\", title: m.ownPri === m.pri ? \"Priority\" : m.pri === 0 ? \"Study task: highest unless you give it a priority\" : \"In Soon: medium unless you give it a priority\" }, parent, PRI_LABEL[m.pri]);\n  if (m.shops.length) h(\"span\", { class: \"pln-chip\", title: `Bought on one trip with the other tasks for ${m.shops.join(\" or \")} (the [shop::] field)` }, parent, `🛒 ${m.shops.join(\" / \")}`);\n  if (showSched && m.sched) h(\"span\", { class: \"pln-chip\" }, parent, dayLabel(m.sched));\n  // planned or not, a step whose ⛔ blocker is still open says so\n  if (!noBlocked && !m.done && r && blockers(r).length) h(\"span\", { class: \"pln-chip is-due\", title: `Blocked: waits for ${blockers(r).map(b => label(b.raw)).join(\", \")} (⛔)` }, parent, \"⛔ blocked\");\n}\n// Work in a list of tasks; a task spread over days counts its share for one day.\nfunction minutes(list) {\n  let known = 0, guessed = 0, missing = 0;\n  const { trips, loose } = errands(list.filter(r => !meta(r.raw).event));\n  for (const t of trips.values()) known += errandMin(t);\n  for (const r of loose) { const m = meta(r.raw); if (m.event) continue; /* events are busy time, not task load */ if (m.est === null) { guessed += GUESS; missing++; } else known += m.share ?? m.est; }\n  return { known, guessed, missing, total: known + guessed };\n}\nconst withBuffer = min => min * (1 + (Number(state.buffer) || 0) / 100);\n// A task shows its own length; the buffer is added only to totals, and says so: \"3h 8m + buffer = 4h\".\nconst plusBuffer = min => { const nb = x => fmtEst(x).replace(/ /g, \"\\u00a0\"); return Number(state.buffer) && min ? `${nb(min)} + buffer = ${nb(withBuffer(min))}` : fmtEst(min); }; // no break inside \"6h 59m\"\n// a day's hours for tasks: its #tasks blocks in the Ideal Week, else your Hours per day\nconst capMin = date => {\n  const base = date && IDEAL_ON ? idealOn(date).filter(b => b.tasks).reduce((t, b) => t + b.e - b.s, 0) : (Number(state.capacity) || 0) * 60;\n  const busy = date ? workOn(date) : [];\n  if (!busy.length) return base;\n  const d0 = parseClock(state.dayStart) ?? 7 * 60, d1 = parseClock(state.dayEnd) ?? 21 * 60;\n  const taken = busy.reduce((t, b) => t + Math.max(0, Math.min(b.e, d1) - Math.max(b.s, d0)), 0);\n  return Math.max(0, Math.min(base, d1 - d0 - taken)); // on a workday only the time around work and commute is left\n};\n\n// Overdue and due within SOON days first, then by priority (🔺 ⏫ 🔼), then the nearest due date, then the shortest.\nfunction suggestedOrder(list) {\n  return [...list].sort((a, b) => {\n    const A = meta(a.raw), B = meta(b.raw);\n    const da = A.due ? Math.min(daysUntil(A.due), 60) : 60, db = B.due ? Math.min(daysUntil(B.due), 60) : 60;\n    return urgency(A) - urgency(B) || A.pri - B.pri || da - db || (A.est ?? GUESS) - (B.est ?? GUESS);\n  });\n}\n// Today's budget: your hours per day, but never past the end of your day from now (or your start time).\nfunction todayBudget() {\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();\n  const from = Math.max(nowMin, parseClock(state.dayStart) ?? nowMin);\n  const left = Math.max(0, (parseClock(state.dayEnd) ?? 21 * 60) - from);\n  return { budget: Math.min(capMin(TODAY), left), left };\n}\nlet suggestionNote = \"\";\n// Tasks on a day: planned for it, or spread over it; a repeating task whose date has passed shows on today.\nconst onDay = date => r => { const m = meta(r.raw); return onDate(m, date) || (date === TODAY && m.recur && !m.done && m.sched && m.sched < TODAY); };\nconst tasksOn = date => ALL.filter(onDay(date));\n// a day's open work in minutes: all = every area (what the day holds), own = this tab's area\nconst dayLoad = date => { const open = EVERY.filter(onDay(date)).filter(r => !meta(r.raw).done), all = minutes(open).total; return { all, own: AREA ? minutes(open.filter(r => r.area === AREA)).total : all }; };\nconst AREA_LABEL = AREA ? (app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaName?.(AREA) || AREA).toLowerCase() : \"\";\n// \"3h 8m + buffer = 4h of 4h\"; on an area tab \"1h 59m work, 1h 52m other + buffer = 4h 49m of 4h\"\nconst loadText = (L, cap) => (AREA && L.all > L.own ? `${fmtEst(L.own)} ${AREA_LABEL}, ${fmtEst(L.all - L.own)} other${Number(state.buffer) ? ` + buffer = ${fmtEst(withBuffer(L.all))}` : \"\"}` : plusBuffer(L.all)) + ` of ${fmtEst(cap)}`;\n// Suggest for today or any later day (evening planning: tomorrow). Today stops at your day's end; a later day has\n// your full hours. A task longer than a day counts with one day's share and is spread when you plan it.\nfunction suggestFor(date) {\n  let used = withBuffer(dayLoad(date).all);\n  const { budget, left } = date === TODAY ? todayBudget() : { budget: capMin(date), left: Infinity };\n  const pick = [], trips = [], seen = new Set();\n  const cand = suggestedOrder(pool()).filter(r => { const m = meta(r.raw); return !(m.recur && m.sched); });\n  // the most urgent item of a shop brings the whole shop's list along, as one errand\n  const { trips: byShop } = errands(cand.filter(r => meta(r.raw).shops.length));\n  const tripOf = new Map([...byShop].flatMap(([shop, list]) => list.map(r => [r.key, { shop, list }])));\n  for (const r of cand) {\n    if (seen.has(r.key)) continue;\n    const t = tripOf.get(r.key);\n    if (t) {\n      for (const x of t.list) seen.add(x.key);\n      const e = withBuffer(errandMin(t.list));\n      if (used + e <= budget) { pick.push(...t.list.map(x => x.key)); trips.push({ shop: t.shop, keys: t.list.map(x => x.key), min: errandMin(t.list) }); used += e; }\n      continue;\n    }\n    const m = meta(r.raw);\n    const e = withBuffer(m.est === null ? GUESS : m.est / spanDays(m.est));\n    if (used + e <= budget) { pick.push(r.key); used += e; }\n  }\n  suggestion = { date, keys: pick, trips };\n  suggestionNote = date === TODAY && left < capMin(TODAY) ? ` Only ${fmtEst(left)} left before your day ends at ${state.dayEnd}.` : \"\";\n  const L = dayLoad(date);\n  if (L.all > L.own) suggestionNote += ` Other areas already have ${fmtEst(L.all - L.own)} planned that day; it counts against your ${fmtEst(budget)}.`;\n  render();\n}\nconst dayName = d => (d === TODAY ? \"today\" : d === TOMORROW ? \"tomorrow\" : dayLabel(d));\nfunction pool() {\n  let list = ALL.filter(r => { const m = meta(r.raw); return r.isNext && !r.someday && !m.done && !m.sched && !m.event; });\n  if (state.quick) list = list.filter(r => (meta(r.raw).est ?? GUESS) <= 15);\n  if (state.dueSoon) list = list.filter(r => { const d = meta(r.raw).due; return d && daysUntil(d) <= 7; });\n  const by = {\n    suggested: l => suggestedOrder(l),\n    due: l => [...l].sort((a, b) => (meta(a.raw).due ?? \"9999\") < (meta(b.raw).due ?? \"9999\") ? -1 : 1),\n    est: l => [...l].sort((a, b) => (meta(a.raw).est ?? GUESS) - (meta(b.raw).est ?? GUESS)),\n    priority: l => [...l].sort((a, b) => meta(a.raw).pri - meta(b.raw).pri),\n    project: l => [...l].sort((a, b) => a.project.localeCompare(b.project)),\n    cost: l => [...l].sort((a, b) => (meta(b.raw).cost ?? -1) - (meta(a.raw).cost ?? -1)),\n  };\n  return (by[state.sort] || by.suggested)(list);\n}\n\nfunction render() {\n  UI.day = tlDay; UI.picked = picked;\n  const page = scrollerOf(root), keep = page ? page.scrollTop : null;\n  root.style.minHeight = `${root.offsetHeight}px`;\n  requestAnimationFrame(() => { root.style.minHeight = \"\"; if (page && page.scrollTop !== keep) page.scrollTop = keep; });\n  markNext();\n  byKey.clear();\n  for (const r of ALL) byKey.set(r.key, r);\n  for (const el of [...root.children]) if (el.tagName !== \"STYLE\") el.remove();\n\n  // undo for the last change to several tasks (kept for a day)\n  const u = loadUndo();\n  if (u?.items?.length && Date.now() - u.at < 86400000) {\n    const ub = h(\"div\", { class: \"pln-box\", style: \"display:flex;gap:8px;align-items:center;flex-wrap:wrap\" }, root);\n    h(\"span\", {}, ub, `Last change: ${u.title} (${u.items.length} task${u.items.length === 1 ? \"\" : \"s\"}).`);\n    const ubtn = h(\"button\", { class: \"pln-btn mod-warning\" }, ub, \"Undo\");\n    ubtn.addEventListener(\"click\", async () => { ubtn.disabled = true; await undoLast(); });\n    const forget = h(\"span\", { class: \"pln-sub\", style: \"cursor:pointer;text-decoration:underline\" }, ub, \"hide\");\n    forget.addEventListener(\"click\", () => { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} render(); });\n  }\n  // toolbar; the settings fold away behind one button (they are kept in the config note)\n  const bar = h(\"div\", { class: \"pln-bar\" }, root);\n  const setBtn = h(\"button\", { class: \"pln-btn\", title: \"Hours per day, buffer, and when your day starts and ends\" }, bar, `⚙ ${IDEAL_ON ? \"Ideal Week hours\" : `${state.capacity}h a day`} · ${state.buffer}% buffer · ${state.dayStart} to ${state.dayEnd}`);\n  setBtn.addEventListener(\"click\", () => { UI.settingsOpen = !UI.settingsOpen; render(); });\n  const sbar = UI.settingsOpen ? h(\"div\", { class: \"pln-bar pln-box\" }, root) : null;\n  const numInput = (lbl, key, min, max, step, title) => {\n    if (!sbar) return;\n    const l = h(\"label\", { title }, sbar, `${lbl} `);\n    const i = h(\"input\", { type: \"number\", min, max, step, value: String(state[key]) }, l);\n    i.addEventListener(\"change\", async () => { await saveSetting(key, Number(i.value) || 0); render(); });\n  };\n  numInput(\"Hours per day\", \"capacity\", 0, 16, 0.5, \"How many hours of task work fit in a day\");\n  numInput(\"Buffer %\", \"buffer\", 0, 200, 5, \"Added to every estimate, because estimates run short\");\n  if (sbar) {\n    const dl = h(\"label\", { title: \"Counted for every task that has no [est::] yet, in the planner and in the project steps chart\" }, sbar, \"Default estimate \");\n    const di = h(\"input\", { type: \"text\", value: state.defaultEst || \"30m\", placeholder: \"30m\", style: \"width:4.5em\" }, dl);\n    di.addEventListener(\"change\", async () => { if (/^\\s*\\d/.test(di.value)) await saveSetting(\"defaultEst\", di.value.trim()); render(); });\n  }\n  if (sbar) {\n  const ds = h(\"label\", { title: \"The timeline starts here, and Fill the gaps never plans before it\" }, sbar, \"Day starts \");\n  const dsi = h(\"input\", { type: \"text\", value: state.dayStart || \"07:00\", placeholder: \"HH:MM\", pattern: \"[0-2][0-9]:[0-5][0-9]\", style: \"width:4.5em\" }, ds);\n  dsi.addEventListener(\"change\", async () => { if (parseClock(dsi.value) !== null) await saveSetting(\"dayStart\", dsi.value.padStart(5, \"0\")); render(); });\n  const de = h(\"label\", { title: \"Suggest today and Fill the gaps never plan past this time\" }, sbar, \"Day ends \");\n  const dei = h(\"input\", { type: \"text\", value: state.dayEnd || \"21:00\", placeholder: \"HH:MM\", pattern: \"[0-2][0-9]:[0-5][0-9]\", style: \"width:4.5em\" }, de);\n  dei.addEventListener(\"change\", async () => { if (parseClock(dei.value) !== null) await saveSetting(\"dayEnd\", dei.value.padStart(5, \"0\")); render(); });\n  h(\"span\", { class: \"pln-sub\" }, sbar, \"Saved in Meta/EX3C Agenda Config.md, so every device plans with the same hours.\");\n  const sw = h(\"label\", { title: \"On: your Ideal Week's #tasks blocks set each weekday's hours and its blocks show behind the week view. Off: Hours per day for every day. Work and commute (Work schedule) are blocked either way.\" }, sbar);\n  const swi = h(\"input\", { type: \"checkbox\" }, sw);\n  swi.checked = !!state.useIdeal;\n  sw.appendChild(document.createTextNode(\" Use my Ideal Week\"));\n  swi.addEventListener(\"change\", async () => { await saveSetting(\"useIdeal\", swi.checked); render(); });\n  const iw = h(\"span\", { class: \"pln-sub\" }, sbar, !state.useIdeal ? `Off: every day has your Hours per day${Object.keys(WORK).length ? \", minus work and commute\" : \"\"}. `\n    : IDEAL_ON ? `Hours per weekday from its #tasks blocks: ${DAYN.map((d, i) => `${d[0].toUpperCase()}${d.slice(1)} ${fmtEst(IDEAL.filter(b => b.tasks && b.days.includes(i)).reduce((t, b) => t + b.e - b.s, 0))}`).join(\", \")}. `\n    : \"On, but the Ideal Week has no #tasks blocks yet, so Hours per day still applies. \");\n  h(\"a\", { style: \"cursor:pointer\" }, iw, \"Open the Ideal Week\").addEventListener(\"click\", () => app.workspace.openLinkText(IDEAL_PATH, \"\", false));\n  }\n  const prev = h(\"button\", { class: \"pln-btn\" }, bar, \"‹\");\n  const wk = h(\"button\", { class: \"pln-btn\" }, bar, state.weekOffset === 0 ? \"This week\" : `Week ${state.weekOffset > 0 ? \"+\" : \"\"}${state.weekOffset}`);\n  const nxt = h(\"button\", { class: \"pln-btn\" }, bar, \"›\");\n  prev.addEventListener(\"click\", () => { state.weekOffset--; save(); render(); });\n  nxt.addEventListener(\"click\", () => { state.weekOffset++; save(); render(); });\n  wk.addEventListener(\"click\", () => { state.weekOffset = 0; save(); render(); });\n  // In the evening (less than half an hour left today) planning tomorrow is the main button.\n  const late = todayBudget().left < 30;\n  const calB = h(\"button\", { class: \"pln-btn\", title: \"Calendar links and .ics files: their events are fixed blocks in the planner\" }, bar, \"📅 Calendars\");\n  calB.addEventListener(\"click\", () => app.workspace.openLinkText(\"00 Dashboards/Calendars.md\", \"\", false));\n  const sug = h(\"button\", { class: `pln-btn${late ? \"\" : \" mod-cta\"}`, title: \"Proposes next steps that fit in what is left of today\" }, bar, \"Suggest today\");\n  sug.addEventListener(\"click\", () => suggestFor(TODAY));\n  const sugT = h(\"button\", { class: `pln-btn${late ? \" mod-cta\" : \"\"}`, title: \"Plan tomorrow tonight: proposes next steps for your full hours tomorrow\" }, bar, \"Suggest tomorrow\");\n  sugT.addEventListener(\"click\", () => suggestFor(TOMORROW));\n  if (!SCOPE.includes(\"\")) {\n  const wv = h(\"label\", { title: \"Off: only the prototype's sample notes. On: every task in the vault.\" }, bar);\n  const wvi = h(\"input\", { type: \"checkbox\" }, wv);\n  wvi.checked = !!state.wholeVault;\n  wv.appendChild(document.createTextNode(\" Whole vault (reopen to apply)\"));\n  wvi.addEventListener(\"change\", () => { state.wholeVault = wvi.checked; save(); });\n  }\n\n  // suggestion banner\n  if (suggestion) {\n    const box = h(\"div\", { class: \"pln-box\" }, root);\n    const { date, keys } = suggestion, name = dayName(date);\n    const picked = keys.map(k => byKey.get(k)).filter(Boolean);\n    const trips = (suggestion.trips ?? []).filter(t => t.keys.some(k => byKey.has(k)));\n    const inTrip = new Set(trips.flatMap(t => t.keys));\n    const mins = minutes(picked).total;\n    const spreads = picked.filter(r => !inTrip.has(r.key) && spanDays(meta(r.raw).est) > 1).length;\n    const tasksN = picked.length - inTrip.size + trips.length;\n    h(\"p\", { style: \"margin:0 0 6px\" }, box, picked.length\n      ? `Suggested for ${name}: ${tasksN} task${tasksN === 1 ? \"\" : \"s\"}${trips.length ? ` (${trips.length} of them ${trips.length === 1 ? \"an errand\" : \"errands\"}, one trip per shop)` : \"\"}, about ${plusBuffer(mins)}. Overdue and due within ${SOON} days first, then 🔺 highest, ⏫ high, 🔼 medium (Soon), then shortest. They are highlighted below.${spreads ? ` ${spreads} of them ${spreads === 1 ? \"is\" : \"are\"} longer than a day and will be spread over the following days.` : \"\"}${suggestionNote}`\n      : `Nothing fits: ${name} is already full, or there are no next steps.${suggestionNote}${date === TODAY ? \" Try Suggest tomorrow.\" : \"\"}`);\n    for (const t of trips) {\n      const items = t.keys.map(k => byKey.get(k)).filter(Boolean);\n      const cost = items.reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);\n      const row = h(\"div\", { class: \"pln-errand\" }, box);\n      h(\"b\", {}, row, `🛒 ${t.shop}`);\n      h(\"span\", { class: \"pln-sub\" }, row, ` · ${items.length} item${items.length === 1 ? \"\" : \"s\"} · ${fmtEst(t.min)}${cost ? ` · ${cost.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" })}` : \"\"}: `);\n      h(\"span\", {}, row, items.map(r => label(r.raw)).join(\", \"));\n    }\n    if (picked.length) {\n      const ap = h(\"button\", { class: \"pln-btn mod-cta\" }, box, `Plan these for ${name}`);\n      ap.addEventListener(\"click\", async () => { const list = keys.map(k => byKey.get(k)).filter(Boolean); suggestion = null; await bulk(list, `Plan ${list.length} task${list.length === 1 ? \"\" : \"s\"} for ${name}`, line => planLine(line, date)); });\n    }\n    const cl = h(\"button\", { class: \"pln-btn\", style: \"margin-left:6px\" }, box, \"Dismiss\");\n    cl.addEventListener(\"click\", () => { suggestion = null; render(); });\n  }\n\n  // carried over\n  // (repeating tasks are not carried over: the Tasks plugin owns their dates, they show on today instead)\n  const carried = ALL.filter(r => { const m = meta(r.raw); return !m.done && !m.event && !m.recur && m.sched && m.sched < TODAY; });\n  if (carried.length) {\n    const box = h(\"div\", { class: \"pln-box\" }, root);\n    const hd = h(\"h4\", {}, box, `Carried over (${carried.length})`);\n    const all = h(\"button\", { class: \"pln-btn\", style: \"margin-left:8px\" }, hd, \"Move all to today\");\n    all.addEventListener(\"click\", () => void bulk(carried, `Move ${carried.length} carried-over task${carried.length === 1 ? \"\" : \"s\"} to today`, line => planLine(line, TODAY)));\n    for (const r of carried) item(box, r, { showSched: true });\n  }\n\n  // week (in the timeline's Week mode the week calendar below takes its place)\n  if (state.tlMode !== \"week\") {\n  const monday = addDays(mondayOf(TODAY_D), state.weekOffset * 7);\n  const week = h(\"div\", { class: \"pln-week\" }, root);\n  for (let i = 0; i < 7; i++) {\n    const date = iso(addDays(monday, i));\n    const tasks = tasksOn(date);\n    const open = tasks.filter(r => !meta(r.raw).done);\n    const col = h(\"div\", { class: `pln-day${date === TODAY ? \" is-today\" : \"\"}${date < TODAY ? \" is-past\" : \"\"}${date === tlDay ? \" is-shown\" : \"\"}`, \"data-day\": date }, week);\n    const head = h(\"div\", { class: \"pln-day-head\", title: \"Show this day in the timeline below\", style: \"cursor:pointer\" }, col);\n    head.addEventListener(\"click\", () => { tlDay = date; render(); });\n    h(\"span\", {}, head, date === TODAY ? `Today, ${dayLabel(date)}` : dayLabel(date));\n    const mm = minutes(open), L = dayLoad(date), planned = withBuffer(L.all), cap = capMin(date);\n    const capEl = h(\"div\", { class: `pln-cap${planned > cap ? (date > TODAY ? \" is-full\" : \" is-over\") : planned > cap * 0.85 ? \" is-full\" : \"\"}`, title: \"Planned time with buffer, against your hours per day\" }, col);\n    h(\"div\", { style: `width:${cap ? Math.min(100, (100 * planned) / cap) : 0}%` }, capEl);\n    h(\"div\", { class: \"pln-sub\" }, col, `${loadText(L, cap)}${mm.missing ? ` · ${mm.missing} without estimate` : \"\"}`);\n    for (const r of [...tasks].sort((a, b) => (meta(a.raw).start ?? 9999) - (meta(b.raw).start ?? 9999))) item(col, r, { day: date });\n    birthdayMarks(col, date);\n    const deadlines = ALL.filter(r => { const m = meta(r.raw); return m.due === date && !m.done && !onDate(m, date); });\n    for (const r of deadlines) {\n      const d = h(\"div\", { class: \"pln-due\", title: \"Deadline on this day (not planned for it)\" }, col);\n      d.appendChild(document.createTextNode(`⚑ Due: ${label(r.raw)}`));\n      d.addEventListener(\"click\", () => openAt(r));\n    }\n    projectDueMarks(col, date);\n  }\n  // the week's total row: tasks, time against the week's hours, money to spend\n  const wdays = Array.from({ length: 7 }, (_, i) => iso(addDays(monday, i)));\n  const wopen = wdays.flatMap(d => tasksOn(d).filter(r => !meta(r.raw).done && !meta(r.raw).event).map(r => ({ r, d })));\n  const wmin = wdays.reduce((t, d) => t + minutes(tasksOn(d).filter(r => !meta(r.raw).done)).total, 0), wcap = wdays.reduce((t, d) => t + capMin(d), 0);\n  const wcost = [...new Set(wopen.map(x => x.r))].reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);\n  h(\"div\", { class: \"pln-sub pln-weektotal\", title: \"Open tasks planned on these seven days, with the buffer, against the hours of these days\" }, root,\n    `Week total: ${new Set(wopen.map(x => x.r)).size} open task${new Set(wopen.map(x => x.r)).size === 1 ? \"\" : \"s\"} · ${plusBuffer(wmin)} of ${fmtEst(wcap)}${wcost ? ` · ${wcost.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" })} to spend` : \"\"}`);\n  }\n\n  // timeline: one day as hours, with a pool of tasks to drag (or tap, then tap an hour) onto it\n  timeline(root);\n\n  // long list\n  const pl = h(\"div\", { class: \"pln-box\" }, root);\n  const list = pool();\n  const ph = h(\"h4\", {}, pl, `Next steps, not planned yet (${list.length})`);\n  const fb = h(\"div\", { class: \"pln-bar\", style: \"margin:4px 0 6px\" }, pl);\n  const tog = (lbl, key, title) => { const l = h(\"label\", { title }, fb); const i = h(\"input\", { type: \"checkbox\" }, l); i.checked = !!state[key]; l.appendChild(document.createTextNode(` ${lbl}`)); i.addEventListener(\"change\", () => { state[key] = i.checked; save(); render(); }); };\n  tog(\"Quick wins (15m or less)\", \"quick\", \"Short tasks for low-energy moments\");\n  tog(\"Due within 7 days\", \"dueSoon\", \"Only tasks with a due date in the next week\");\n  const sl = h(\"label\", {}, fb, \"Sort \");\n  const ss = h(\"select\", { class: \"dropdown\" }, sl);\n  for (const [v, t] of [[\"suggested\", \"Suggested\"], [\"due\", \"Due date\"], [\"est\", \"Shortest first\"], [\"priority\", \"Priority\"], [\"project\", \"Project\"], [\"cost\", \"Cost\"]]) h(\"option\", { value: v }, ss, t);\n  ss.value = state.sort;\n  ss.addEventListener(\"change\", () => { state.sort = ss.value; save(); render(); });\n  if (!list.length) h(\"p\", { class: \"pln-sub\" }, pl, \"No unplanned next steps.\");\n  const table = h(\"table\", { class: \"pln-table\" }, pl);\n  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(TODAY_D, i)));\n  // total rows (idea from Operon's table summaries): one under each project when sorted by project, one for the list\n  const totalRow = (rs, title) => {\n    const mm = minutes(rs), cost = rs.reduce((c, r) => c + (meta(r.raw).cost ?? 0), 0);\n    const tr = h(\"tr\", { class: \"pln-total\" }, table);\n    h(\"td\", {}, tr);\n    h(\"td\", { colspan: \"3\" }, tr, `${title}: ${rs.length} step${rs.length === 1 ? \"\" : \"s\"} · ${plusBuffer(mm.total)}${mm.missing ? ` (${mm.missing} counted at ~${GUESS}m)` : \"\"}${cost ? ` · ${cost.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" })}` : \"\"}`);\n  };\n  let block = [];\n  const flush = () => { if (state.sort === \"project\" && block.length > 1) totalRow(block, `${block[0].project} total`); block = []; };\n  for (const r of list) {\n    if (block.length && block[0].project !== r.project) flush();\n    block.push(r);\n    const m = meta(r.raw);\n    const tr = h(\"tr\", { class: suggestion?.keys.includes(r.key) ? \"is-suggested\" : \"\" }, table);\n    const c0 = h(\"td\", {}, tr);\n    const cb = h(\"input\", { type: \"checkbox\", class: \"task-list-item-checkbox\" }, c0);\n    cb.addEventListener(\"click\", e => { e.preventDefault(); toggle(r); });\n    const c1 = h(\"td\", { class: \"pln-c-text\" }, tr);\n    const tx = h(\"span\", { style: \"cursor:pointer\" }, c1, label(r.raw));\n    tx.addEventListener(\"click\", () => openAt(r));\n    h(\"div\", { class: \"pln-sub\" }, c1, r.project);\n    const c2 = h(\"td\", {}, tr); chips(c2, r, m);\n    if (m.cost !== null) h(\"span\", { class: \"pln-chip\" }, c2, m.cost.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" }));\n    const c3 = h(\"td\", { class: \"pln-c-act\", style: \"white-space:nowrap;text-align:right\" }, tr);\n    const b1 = h(\"button\", { class: \"pln-btn\" }, c3, \"Today\"); b1.addEventListener(\"click\", () => schedule(r, TODAY));\n    const b2 = h(\"button\", { class: \"pln-btn\", style: \"margin-left:3px\" }, c3, \"Tomorrow\"); b2.addEventListener(\"click\", () => schedule(r, TOMORROW));\n    const sel = h(\"select\", { class: \"dropdown\", style: \"margin-left:3px;font-size:11px\", \"aria-label\": \"Plan on a day\" }, c3);\n    h(\"option\", { value: \"\" }, sel, \"Day…\");\n    for (const d of days.slice(2)) h(\"option\", { value: d }, sel, dayLabel(d));\n    sel.addEventListener(\"change\", () => { if (sel.value) schedule(r, sel.value); });\n    const pe = h(\"span\", { class: \"pln-acts\", style: \"margin-left:4px\", title: \"Edit task: dates, priority, length, price… (or right-click the task)\" }, c3);\n    h(\"span\", {}, pe, \"✎\").addEventListener(\"click\", () => edit(r));\n    menuOn(tr, r);\n  }\n  flush();\n  if (list.length > 1) totalRow(list, \"All\");\n\n  // later steps: open steps that are not next yet, with what they wait for, so nothing in a project is invisible\n  const later = ALL.filter(r => { const m = meta(r.raw); return !r.isNext && !m.done && !m.sched && !m.event && !r.kids.some(k => !meta(k.raw).done); });\n  if (later.length) {\n    const det = h(\"details\", { style: \"margin-top:8px\" }, pl);\n    if (UI.laterOpen) det.open = true;\n    det.addEventListener(\"toggle\", () => { UI.laterOpen = det.open; });\n    const nBlocked = later.filter(r => blockers(r).length).length;\n    h(\"summary\", { class: \"pln-sub\", style: \"cursor:pointer\" }, det, `Later steps (${later.length}): ${later.length - nBlocked} waiting for an earlier step, ${nBlocked} blocked by a ⛔`);\n    // available vs blocked: a filter, so the ⛔ ones can be looked at on their own (or hidden)\n    const lf = h(\"div\", { class: \"pln-bar\", style: \"margin:4px 0\" }, det);\n    for (const [v, t] of [[\"all\", `All (${later.length})`], [\"order\", `Waiting in order (${later.length - nBlocked})`], [\"blocked\", `Blocked ⛔ (${nBlocked})`]]) {\n      const b = h(\"button\", { class: `pln-btn${(UI.laterFilter ?? \"all\") === v ? \" mod-cta\" : \"\"}` }, lf, t);\n      b.addEventListener(\"click\", () => { UI.laterFilter = v; render(); });\n    }\n    const lt = h(\"table\", { class: \"pln-table\" }, det);\n    const lfv = UI.laterFilter ?? \"all\";\n    for (const r of suggestedOrder(later).filter(r => lfv === \"all\" || (lfv === \"blocked\") === blockers(r).length > 0)) {\n      const m = meta(r.raw), tr = h(\"tr\", {}, lt); menuOn(tr, r);\n      const c1 = h(\"td\", { class: \"pln-c-text\" }, tr);\n      const tx = h(\"span\", { style: \"cursor:pointer;color:var(--text-muted)\" }, c1, label(r.raw));\n      tx.addEventListener(\"click\", () => openAt(r));\n      h(\"div\", { class: \"pln-sub\" }, c1, `${r.project} · ${blockers(r).length ? `blocked by ⛔ ${blockers(r).map(b => label(b.raw)).join(\", \")}` : r.after ? `after: ${r.after}` : \"waiting\"}`);\n      const c2 = h(\"td\", {}, tr); chips(c2, r, m, { noBlocked: true });\n      const c3 = h(\"td\", { class: \"pln-c-act\", style: \"white-space:nowrap;text-align:right\" }, tr);\n      const b = h(\"button\", { class: \"pln-btn\", title: \"Plan it anyway\" }, c3, \"Today\"); b.addEventListener(\"click\", () => schedule(r, TODAY));\n      const b2 = h(\"button\", { class: \"pln-btn\", style: \"margin-left:3px\" }, c3, \"Tomorrow\"); b2.addEventListener(\"click\", () => schedule(r, TOMORROW));\n    }\n  }\n}\n\n// ---------- timeline ----------\n// Dataview reruns this view after every note edit, so what you are looking at is kept on window between runs.\nconst UI = (window.__compassPlanner ??= {});\nif (UI.today !== TODAY) Object.assign(UI, { today: TODAY, day: TODAY, picked: null, gridScroll: {} });\nlet tlDay = UI.day;\nlet picked = UI.picked; // key of a pool task chosen by tap; the next tap on the timeline places it\nconst scrollerOf = el => { for (let p = el?.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === \"auto\" || o === \"scroll\") && p.scrollHeight > p.clientHeight) return p; } return null; };\nconst SNAP = 15, PXM = 0.8; // 15 minute steps, 48 px per hour\n// the app's Size setting zooms the page: pointer positions arrive zoomed, block positions are not\nconst ZM = () => dv.container.currentCSSZoom || 1;\nconst durOf = r => { const m = meta(r.raw); return m.start !== null && m.end > m.start ? m.end - m.start : Math.max(SNAP, Math.ceil(withBuffer(m.spread ? m.share ?? GUESS : (m.est ?? GUESS) / spanDays(m.est)) / 5) * 5); };\n// a time on a spread task keeps its days (the time is the same on each of them)\nconst timeOn = (line, day, s, e) => {\n  const m = meta(line);\n  if (m.spread && onDate(m, day)) return setTime(line, s, e);\n  // a task longer than a day put on the hours is spread from that day, with the same time on each of its days\n  if (!m.spread && !m.recur && m.start === null && spanDays(m.est) > 1) return setTime(planLine(line, day), s, s + Math.max(SNAP, Math.ceil(withBuffer(m.est / spanDays(m.est)) / 5) * 5));\n  return setScheduled(setTime(line, s, e), day);\n};\nconst place = (r, day, s, e) => act(r, line => timeOn(line, day, s, e), line => timeOn(line, day, s, e));\nconst unTime = r => act(r, line => setTime(line, null), line => setTime(line, null));\n\n// Pointer drag that works with a mouse (press and move) and on a phone (press and hold, then move).\nlet drag = null;\nfunction draggable(el, r, kind, extra = {}) {\n  el.addEventListener(\"touchmove\", ev => { if (drag?.active) ev.preventDefault(); }, { passive: false });\n  el.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0 || ev.target.closest(\"input, .pln-x\") || (kind !== \"resize\" && ev.target.closest(\".pln-rs\"))) return;\n    if (kind === \"resize\") ev.stopPropagation();\n    const d = { r, kind, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, active: false, el, ...extra, touch: ev.pointerType === \"touch\" };\n    if (kind === \"block\") d.offset = Math.round((ev.clientY - el.getBoundingClientRect().top) / (PXM * ZM()) / SNAP) * SNAP; // grab point inside the block\n    drag = d;\n    const begin = () => {\n      if (drag !== d) return;\n      d.active = true; d.ghost = h(\"div\", { class: \"pln-drag\" }, document.body, label(r.raw)); moveTo(d.x, d.y);\n      d.scroller = setInterval(() => autoScroll(d), 50);\n      document.addEventListener(\"touchmove\", stopScroll, { passive: false, capture: true });\n    };\n    if (d.touch) d.timer = setTimeout(begin, 300);\n    const move = e => {\n      if (drag !== d) return;\n      const far = Math.hypot(e.clientX - d.x, e.clientY - d.y);\n      if (!d.active) { if (d.touch) { if (far > 8) cancel(); return; } if (far < 5) return; begin(); }\n      d.x = e.clientX; d.y = e.clientY; moveTo(d.x, d.y);\n    };\n    const up = e => {\n      cleanup();\n      if (!d.active) return;\n      d.justDragged = true; setTimeout(() => (d.justDragged = false), 0);\n      // on a phone, holding a task and letting go where it was opens its menu (after the click that follows the\n      // touch, which would close it again); holding and moving drags it\n      if (d.touch && kind !== \"resize\" && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 10) {\n        const open = () => { clearTimeout(t); document.removeEventListener(\"click\", swallow, true); taskMenu(e, r); };\n        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); open(); };\n        const t = setTimeout(open, 400);\n        document.addEventListener(\"click\", swallow, true);\n        return;\n      }\n      void drop(d, e.clientX, e.clientY);\n    };\n    const cancel = () => { cleanup(); };\n    const cleanup = () => { clearTimeout(d.timer); clearInterval(d.scroller); document.removeEventListener(\"touchmove\", stopScroll, { capture: true }); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel); d.ghost?.remove(); clearHints(); if (drag === d) drag = null; if (d.active) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); } };\n    document.addEventListener(\"pointermove\", move);\n    document.addEventListener(\"pointerup\", up);\n    document.addEventListener(\"pointercancel\", cancel);\n  });\n}\nlet suppressClick = false;\nconst stopScroll = ev => { if (drag?.active) ev.preventDefault(); };\n// Hold a dragged task near the top or bottom edge of the hours (or of the screen) for a moment to scroll them.\nfunction autoScroll(d) {\n  const gs = root.querySelector(\".pln-gs\");\n  if (!gs) return;\n  const b = gs.getBoundingClientRect(), top = Math.max(b.top, 0), bottom = Math.min(b.bottom, window.innerHeight);\n  const inside = d.x > b.left && d.x < b.right && d.y > top && d.y < bottom;\n  const dir = !inside ? 0 : d.y < top + 36 ? -1 : d.y > bottom - 36 ? 1 : 0;\n  if (dir !== d.edgeDir) { d.edgeDir = dir; d.edgeSince = Date.now(); return; }\n  if (!dir || Date.now() - d.edgeSince < 350) return;\n  const before = gs.scrollTop; gs.scrollTop += dir * 10;\n  if (gs.scrollTop === before) { const page = scrollerOf(gs); if (page) page.scrollTop += dir * 10; }\n  moveTo(d.x, d.y);\n}\nconst clearHints = () => { for (const x of root.querySelectorAll(\".is-drop\")) x.classList.remove(\"is-drop\"); root.querySelector(\".pln-blk.is-ghost\")?.remove(); };\nfunction gridMinute(grid, y, offset = 0) {\n  const rect = grid.getBoundingClientRect();\n  const raw = Number(grid.dataset.start) + (y - rect.top) / (PXM * ZM()) - offset;\n  return Math.max(Number(grid.dataset.start), Math.min(Number(grid.dataset.end) - SNAP, Math.round(raw / SNAP) * SNAP));\n}\nfunction target(x, y) {\n  const el = document.elementFromPoint(x, y);\n  return { grid: el?.closest(\".pln-grid\"), day: el?.closest(\".pln-day[data-day]\"), pool: el?.closest(\".pln-pool\") };\n}\nconst gridDay = grid => grid.dataset.day || tlDay;\nfunction moveTo(x, y) {\n  const d = drag; if (!d?.ghost) return;\n  d.ghost.style.left = `${x + 12}px`; d.ghost.style.top = `${y + 8}px`;\n  clearHints();\n  const t = target(x, y);\n  if (t.grid) {\n    const m = meta(d.r.raw);\n    let s, e;\n    if (d.kind === \"resize\") { s = m.start; e = Math.max(s + SNAP, gridMinute(t.grid, y) + SNAP); }\n    else { const dur = durOf(d.r); s = gridMinute(t.grid, y, d.kind === \"block\" ? d.offset : 0); e = s + dur; }\n    d.ghost.textContent = `${clock(s)} - ${clock(e)}  ${label(d.r.raw)}`;\n    h(\"div\", { class: \"pln-blk is-ghost\", style: `top:${(s - t.grid.dataset.start) * PXM}px;height:${(e - s) * PXM}px;left:2px;right:2px` }, t.grid);\n  } else if (d.kind !== \"resize\" && t.day) { t.day.classList.add(\"is-drop\"); d.ghost.textContent = `${dayLabel(t.day.dataset.day)}: ${label(d.r.raw)}`; }\n  else if (d.kind === \"block\" && t.pool) { t.pool.classList.add(\"is-drop\"); d.ghost.textContent = `Remove the time: ${label(d.r.raw)}`; }\n  else d.ghost.textContent = label(d.r.raw);\n}\nasync function drop(d, x, y) {\n  const t = target(x, y), m = meta(d.r.raw);\n  if (t.grid) {\n    if (d.kind === \"resize\") { const e = Math.max(m.start + SNAP, gridMinute(t.grid, y) + SNAP); if (e !== m.end) await place(d.r, gridDay(t.grid), m.start, e); return; }\n    const s = gridMinute(t.grid, y, d.kind === \"block\" ? d.offset : 0);\n    await place(d.r, gridDay(t.grid), s, s + durOf(d.r));\n  } else if (d.kind === \"resize\") return;\n  else if (t.day && t.day.classList.contains(\"pln-lane\") && m.start !== null) {\n    // a block dropped on a day's \"no time yet\" row keeps (or moves to) that day without a time\n    const day = t.day.dataset.day, fn = line => { const l = setTime(line, null); return onDate(meta(l), day) ? l : planLine(l, day); };\n    await act(d.r, fn, fn);\n  }\n  else if (t.day) { const day = t.day.dataset.day; if (m.spread) { if (day !== m.start0) await shift(d.r, daysUntil(day) - daysUntil(m.start0)); } else if (day !== m.sched) await schedule(d.r, day); }\n  else if (d.kind === \"block\" && t.pool) await unTime(d.r);\n}\n\n// ---------- selection ----------\n// Drag across empty hours (on a phone: press and hold, then move) to select a range, like cells in a spreadsheet:\n// the same hours on every day from the first to the last day you cross. Shift-click extends it, a click on empty\n// hours or Escape clears it. The box above the hours sums it up and can fill the free time in it.\nlet sel = UI.sel ?? null; // { d0, d1, s, e }: first and last day (ISO), start and end minute\nlet selAnchor = UI.selAnchor ?? null;\nconst setSel = v => { sel = UI.sel = v; };\n// A note edit makes Dataview run this view again, which can happen in the middle of a drag: then the newest run's\n// planner is the one on screen, so the drag draws on and redraws that one.\nUI.render = render; UI.root = root;\nconst liveRoot = () => (root.isConnected ? root : UI.root ?? root);\nconst redraw = () => (root.isConnected ? render() : UI.render?.());\nconst clearSel = () => { setSel(null); redraw(); };\nconst selFrom = (a, b) => { const [d0, d1] = a.day <= b.day ? [a.day, b.day] : [b.day, a.day]; return { d0, d1, s: Math.min(a.m, b.m), e: Math.max(a.m, b.m) + SNAP }; };\nconst selDayList = s => { const out = []; for (let d = s.d0; d <= s.d1 && out.length < 62; d = iso(addDays(asDate(d), 1))) out.push(d); return out; };\nconst shortDay = d => `${asDate(d).toLocaleDateString(undefined, { weekday: \"short\" })} ${d.slice(8, 10)}-${d.slice(5, 7)}${d.slice(0, 4) === TODAY.slice(0, 4) ? \"\" : `-${d.slice(0, 4)}`}`;\nconst selTitle = s => `${s.d0 === s.d1 ? shortDay(s.d0) : `${shortDay(s.d0)} to ${shortDay(s.d1)}`}, ${clock(s.s)} - ${clock(s.e)}${s.d0 === s.d1 ? \"\" : \" each day\"}`;\n// Each selected day gets a light fill; one frame goes around all of them, like a range in a spreadsheet, with a\n// running dashed border. The frame needs the laid-out grids, so it is drawn a frame after the hours are built.\nfunction drawSelOn(grid) {\n  grid.querySelector(\".pln-sel\")?.remove();\n  const d = grid.dataset.day;\n  if (!sel || d < sel.d0 || d > sel.d1) return;\n  const g0 = +grid.dataset.start, s = Math.max(sel.s, g0), e = Math.min(sel.e, +grid.dataset.end);\n  if (e <= s) return;\n  h(\"div\", { class: \"pln-sel\", style: `top:${(s - g0) * PXM}px;height:${(e - s) * PXM}px` }, grid);\n  if (!UI.selFramePending) { UI.selFramePending = true; requestAnimationFrame(() => { UI.selFramePending = false; drawFrame(); }); }\n}\nfunction drawFrame() {\n  const r = liveRoot();\n  for (const x of r.querySelectorAll(\".pln-selframe\")) x.remove();\n  if (!sel) return;\n  const parts = [...r.querySelectorAll(\".pln-grid[data-day] > .pln-sel\")];\n  if (!parts.length) return;\n  const box = parts[0].parentElement.parentElement, br = box.getBoundingClientRect();\n  if (getComputedStyle(box).position === \"static\") box.style.position = \"relative\";\n  const rs = parts.map(p => p.getBoundingClientRect());\n  const left = Math.min(...rs.map(x => x.left)), right = Math.max(...rs.map(x => x.right)), top = Math.min(...rs.map(x => x.top)), bottom = Math.max(...rs.map(x => x.bottom));\n  const f = h(\"div\", { class: \"pln-selframe\", style: `left:${Math.ceil(left - br.left + box.scrollLeft)}px;top:${Math.round(top - br.top + box.scrollTop)}px;width:${Math.floor(right - left) - 1}px;height:${Math.round(bottom - top)}px` }, box);\n  h(\"span\", {}, f, `${clock(sel.s)} - ${clock(sel.e)}`);\n}\nconst drawSel = () => { for (const g of liveRoot().querySelectorAll(\".pln-grid[data-day]\")) drawSelOn(g); drawFrame(); };\nconst noTouchScroll = ev => ev.preventDefault();\nfunction selectable(grid) {\n  grid.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0 || picked || drag || ev.target.closest(\".pln-blk, .pln-x, .pln-rs, input\")) return;\n    const at = (x, y) => { const g = document.elementFromPoint(x, y)?.closest(\".pln-grid[data-day]\"); return g && liveRoot().contains(g) ? { day: g.dataset.day, m: gridMinute(g, y) } : null; };\n    const a = { day: grid.dataset.day, m: gridMinute(grid, ev.clientY) };\n    if (ev.shiftKey && selAnchor) { ev.preventDefault(); setSel(selFrom(selAnchor, a)); suppressClick = true; setTimeout(() => (suppressClick = false), 50); render(); return; }\n    const o = { x: ev.clientX, y: ev.clientY, active: false, touch: ev.pointerType === \"touch\" };\n    const begin = () => {\n      o.active = true; selAnchor = UI.selAnchor = a; setSel(selFrom(a, a)); drawSel();\n      o.scroller = setInterval(() => { autoScroll(o); update(); }, 50);\n      document.addEventListener(\"touchmove\", noTouchScroll, { passive: false, capture: true });\n    };\n    const update = () => { const b = at(o.x, o.y); if (b) { setSel(selFrom(a, b)); drawSel(); } };\n    if (o.touch) o.timer = setTimeout(begin, 300);\n    const move = e => {\n      const far = Math.hypot(e.clientX - o.x, e.clientY - o.y);\n      if (!o.active) { if (o.touch) { if (far > 8) cleanup(); return; } if (far < 5) return; begin(); }\n      o.x = e.clientX; o.y = e.clientY; update();\n    };\n    const up = () => { const was = o.active; cleanup(); if (was) { UI.selReveal = true; redraw(); } };\n    const cleanup = () => {\n      clearTimeout(o.timer); clearInterval(o.scroller);\n      document.removeEventListener(\"touchmove\", noTouchScroll, { capture: true });\n      document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cleanup);\n      if (o.active) { suppressClick = true; setTimeout(() => (suppressClick = false), 50); }\n    };\n    document.addEventListener(\"pointermove\", move);\n    document.addEventListener(\"pointerup\", up);\n    document.addEventListener(\"pointercancel\", cleanup);\n  });\n}\nif (UI.selKey) document.removeEventListener(\"keydown\", UI.selKey);\nUI.selKey = ev => { if (ev.key === \"Escape\" && sel && root.isConnected) clearSel(); };\ndocument.addEventListener(\"keydown\", UI.selKey);\n\n// Minutes of a list of intervals inside [s, e], overlaps counted once.\nfunction unionIn(list, s, e) {\n  const xs = list.map(b => [Math.max(b.s, s), Math.min(b.e, e)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);\n  let t = 0, cur = null;\n  for (const [a, b] of xs) { if (!cur || a > cur[1]) { if (cur) t += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b); }\n  return cur ? t + cur[1] - cur[0] : t;\n}\n// What is in the selection, per day and in total.\nfunction selStats(s) {\n  const days = selDayList(s), out = { days: [], total: 0, tasks: 0, busy: 0, free: 0, inside: [], untimed: [], due: [], cost: 0, untimedCost: 0 };\n  for (const day of days) {\n    const timed = timedOn(day), w = s.e - s.s;\n    const T = timed.filter(r => !meta(r.raw).event).map(r => ({ r, s: meta(r.raw).start, e: Math.max(meta(r.raw).end, meta(r.raw).start + SNAP) }));\n    const B = [...timed.filter(r => meta(r.raw).event).map(r => ({ s: meta(r.raw).start, e: meta(r.raw).end })), ...workOn(day),\n      ...timed.filter(r => commuteOf(r)).flatMap(r => { const p = padded(r), m = meta(r.raw); return [{ s: p.s, e: m.start }, { s: Math.max(m.end, m.start + SNAP), e: p.e }]; })];\n    const tasks = unionIn(T, s.s, s.e), all = unionIn([...T, ...B], s.s, s.e);\n    out.days.push({ day, total: w, tasks, busy: all - tasks, free: w - all });\n    out.total += w; out.tasks += tasks; out.busy += all - tasks; out.free += w - all;\n    for (const b of T) if (b.s < s.e && b.e > s.s) out.inside.push({ ...b, day });\n    out.untimed.push(...untimedOn(day));\n    out.due.push(...ALL.filter(r => { const m = meta(r.raw); return m.due === day && !m.done; }));\n  }\n  for (const b of out.inside) out.cost += meta(b.r.raw).cost ?? 0;\n  for (const r of out.untimed) out.untimedCost += meta(r.raw).cost ?? 0;\n  return out;\n}\nconst eur = n => n.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" });\n// Fill the selection: each day's tasks without a time, then next steps, go into the free time inside it, most urgent\n// first. Today never before now. A task longer than a day is left out (it would spread past the selection).\nfunction selFill(s) {\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes(), used = new Set(), fits = [];\n  const next = suggestedOrder(pool()).filter(r => { const m = meta(r.raw); return !m.recur && spanDays(m.est) <= 1; });\n  for (const day of selDayList(s)) {\n    if (day < TODAY) continue;\n    const busy = [...timedOn(day).map(padded), ...workOn(day)];\n    const from = Math.max(s.s, day === TODAY ? Math.ceil(nowMin / SNAP) * SNAP : 0);\n    const cands = [...suggestedOrder(untimedOn(day)).filter(r => { const m = meta(r.raw); return m.spread || spanDays(m.est) <= 1; }), ...next];\n    for (const r of cands) {\n      if (used.has(r.key)) continue;\n      const c = commuteOf(r), dur = durOf(r) + 2 * c;\n      let s0 = from;\n      for (let moved = true; moved;) { moved = false; for (const b of busy) if (s0 < b.e && s0 + dur > b.s) { s0 = Math.ceil(b.e / 5) * 5; moved = true; } }\n      if (s0 + dur > s.e) continue;\n      used.add(r.key); busy.push({ s: s0, e: s0 + dur }); fits.push({ r, day, s: s0 + c, e: s0 + dur - c });\n    }\n  }\n  return fits;\n}\n// Above the hours on a wide screen, under them on a phone (where the hours fill the screen); scrolled into view\n// when a selection is made.\nfunction selPanel(box, where) {\n  if (!sel || where !== ((root.getBoundingClientRect().width || window.innerWidth) < 700 ? \"below\" : \"above\")) return;\n  const st = selStats(sel);\n  const p = h(\"div\", { class: \"pln-selbox\" }, box);\n  if (UI.selReveal) { UI.selReveal = false; requestAnimationFrame(() => p.scrollIntoView({ block: \"nearest\" })); }\n  const hd = h(\"div\", { class: \"pln-selhd\" }, p);\n  h(\"span\", { class: \"pln-seltitle\" }, hd, selTitle(sel));\n  h(\"button\", { class: \"pln-btn\", title: \"Clear the selection (Escape)\" }, hd, \"✕\").addEventListener(\"click\", clearSel);\n  const pct = x => (st.total ? (100 * x) / st.total : 0);\n  const bar = h(\"div\", { class: \"pln-selbar\", title: \"Tasks, busy (work, commute, events) and free time in the selection\" }, p);\n  h(\"div\", { class: \"is-tasks\", style: `width:${pct(st.tasks)}%` }, bar); h(\"div\", { class: \"is-busy\", style: `width:${pct(st.busy)}%` }, bar);\n  const nums = h(\"div\", { class: \"pln-selnums\" }, p);\n  for (const [k, v, c] of [[\"Selected\", st.total], [\"Tasks\", st.tasks, \"is-tasks\"], [\"Busy\", st.busy, \"is-busy\"], [\"Free\", st.free, \"is-free\"]]) { const t = h(\"div\", { class: c ?? \"\" }, nums); h(\"b\", {}, t, fmtEst(v)); h(\"span\", {}, t, k); }\n  if (st.days.length > 1) h(\"div\", { class: \"pln-sub\" }, p, `Free per day: ${st.days.map(d => `${asDate(d.day).toLocaleDateString(undefined, { weekday: \"short\" })} ${fmtEst(d.free)}`).join(\" · \")}`);\n  const notes = [];\n  if (st.cost) notes.push(`cost of these tasks ${eur(st.cost)}`);\n  if (st.untimed.length) notes.push(`${st.untimed.length} more on ${st.days.length > 1 ? \"these days\" : \"this day\"} without a time (${plusBuffer(minutes(st.untimed).total)}${st.untimedCost ? `, ${eur(st.untimedCost)}` : \"\"})`);\n  if (st.due.length) notes.push(`${st.due.length} due on ${st.days.length > 1 ? \"these days\" : \"this day\"}`);\n  if (notes.length) h(\"div\", { class: \"pln-sub\" }, p, notes.join(\" · \").replace(/^./, c => c.toUpperCase()));\n  const ticked = (UI.selTicked ??= {});\n  if (st.inside.length) {\n    const ul = h(\"div\", { class: \"pln-sellist\" }, p);\n    for (const b of st.inside.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.s - y.s))) {\n      const m = meta(b.r.raw), row = h(\"div\", { class: `pln-selrow${m.done ? \" is-done\" : \"\"}` }, ul); menuOn(row, b.r);\n      const cb = h(\"input\", { type: \"checkbox\", title: \"Tick the tasks to add a commute to (or remove it from)\" }, row);\n      cb.checked = ticked[b.r.key] ?? !m.event; cb.addEventListener(\"change\", () => { ticked[b.r.key] = cb.checked; redraw(); });\n      h(\"span\", { class: \"pln-bt\" }, row, `${st.days.length > 1 ? `${asDate(b.day).toLocaleDateString(undefined, { weekday: \"short\" })} ` : \"\"}${clock(b.s)} - ${clock(b.e)}`);\n      h(\"span\", { class: \"pln-text\" }, row, label(b.r.raw)).addEventListener(\"click\", () => openAt(b.r));\n      if (m.commute) h(\"span\", { class: \"pln-chip\", title: \"Commute before and after (the [commute::] field)\" }, row, `🚶 ${fmtEst(m.commute)}`);\n      if (m.cost !== null) h(\"span\", { class: \"pln-chip\" }, row, eur(m.cost));\n    }\n  }\n  const tools = h(\"div\", { class: \"pln-bar\", style: \"margin:6px 0 0\" }, p);\n  const fits = selFill(sel);\n  if (fits.length) {\n    h(\"button\", { class: \"pln-btn mod-cta\", title: \"Puts tasks into the free time of the selection: each day's tasks without a time first, then next steps, most urgent first\" }, tools, `Fill the free time (${fits.length})`)\n      .addEventListener(\"click\", () => void bulk(fits.map(f => f.r), `Put ${fits.length} task${fits.length === 1 ? \"\" : \"s\"} into ${selTitle(sel)}`, (line, r) => { const f = fits.find(x => x.r === r); return timeOn(line, f.day, f.s, f.e); }));\n  } else if (st.free) h(\"span\", { class: \"pln-sub\" }, tools, \"No task without a time fits into the free time here.\");\n  const picks = st.inside.filter(b => ticked[b.r.key] ?? !meta(b.r.raw).event).map(b => b.r);\n  if (picks.length) {\n    const mins = UI.commuteMin ?? COMMUTE_DEFAULT;\n    const wrap = h(\"span\", { class: \"pln-commute\" }, tools);\n    const add = h(\"button\", { class: \"pln-btn\", title: \"Writes [commute:: …] on the ticked tasks: the planner then draws the travel before and after each, and it moves with the task\" }, wrap, `🚶 Add commute (${picks.length})`);\n    const inp = h(\"input\", { type: \"number\", min: \"5\", step: \"5\", value: String(mins), title: \"Minutes each way (default: commute_minutes in your Ideal Week)\" }, wrap);\n    h(\"span\", { class: \"pln-sub\" }, wrap, \"min each way\");\n    inp.addEventListener(\"change\", () => { UI.commuteMin = Math.max(5, Number(inp.value) || COMMUTE_DEFAULT); });\n    add.addEventListener(\"click\", () => { const c = UI.commuteMin ?? COMMUTE_DEFAULT; void bulk(picks, `Add ${fmtEst(c)} commute before and after ${picks.length} task${picks.length === 1 ? \"\" : \"s\"}`, line => setCommute(line, c)); });\n    const has = picks.filter(r => commuteOf(r));\n    if (has.length) h(\"button\", { class: \"pln-btn\", title: \"Takes the [commute::] field off the ticked tasks\" }, wrap, `Remove commute (${has.length})`)\n      .addEventListener(\"click\", () => void bulk(has, `Remove the commute from ${has.length} task${has.length === 1 ? \"\" : \"s\"}`, line => setCommute(line, 0)));\n  }\n}\n\n// ---------- commute around a task ----------\n// A task away from home carries [commute:: 45m]: the planner draws that much travel before and after it, so it\n// moves with the task, and Fill the gaps and the selection leave room for it. Add it from a selection.\nconst COMMUTE_DEFAULT = Number(dv.page(IDEAL_PATH)?.commute_minutes ?? 0) || 30;\nconst commuteOf = r => meta(r.raw).commute || 0;\nconst padded = r => { const m = meta(r.raw), c = m.commute || 0; return { s: m.start - c, e: Math.max(m.end, m.start + SNAP) + c }; };\nconst COMMUTE_RE = /\\s*\\[commute::[^\\]]*\\]/;\nfunction setCommute(line, min) {\n  const plain = line.replace(COMMUTE_RE, \"\");\n  if (!min) return plain;\n  const field = ` [commute:: ${fmtEst(min).replace(\" \", \"\")}]`;\n  const at = plain.search(/\\s(📅|⏳|🛫|➕|✅|❌|🔁|🆔|⛔|[🔺⏫🔼🔽⏬]|\\^[\\w-]+$)/u);\n  return at < 0 ? plain.replace(/\\s*$/, field) : plain.slice(0, at) + field + plain.slice(at);\n}\nfunction commuteBlocks(grid, day, g0, g1, timed) {\n  for (const r of timed) {\n    const m = meta(r.raw), c = m.commute;\n    if (!c || m.start === null) continue;\n    const end = Math.max(m.end, m.start + SNAP);\n    for (const [s0, e0, what] of [[m.start - c, m.start, \"there\"], [end, end + c, \"back\"]]) {\n      const s = Math.max(s0, g0), e = Math.min(e0, g1);\n      if (e <= s) continue;\n      const el = h(\"div\", { class: `pln-work is-commute is-trip${what === \"back\" ? \" is-back\" : \"\"}`, style: `top:${(s - g0) * PXM}px;height:${Math.max(10, (e - s) * PXM - 2)}px${areaStyle(r.area) || `;--blk:var(--interactive-accent)`}`, title: `Commute ${what} for \"${label(r.raw)}\", ${clock(s0)} - ${clock(e0)} ([commute:: ${fmtEst(c)}] on the task; it moves with the task)` }, grid);\n      if ((e - s) * PXM >= 14) h(\"b\", {}, el, `🚶 ${fmtEst(c)}`);\n    }\n  }\n}\n\n// Fill the gaps: untimed tasks of the shown day go into free time, most urgent first, never past your day end.\nfunction fillPlan(untimed, timed) {\n  const dayStart = parseClock(state.dayStart) ?? 7 * 60, dayEnd = Math.min(parseClock(state.dayEnd) ?? 21 * 60, 24 * 60);\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();\n  let cursor = tlDay === TODAY ? Math.max(dayStart, Math.ceil(nowMin / SNAP) * SNAP) : dayStart;\n  // blocks already on the day, plus work and commute when the work schedule is on\n  const busy = [...timed.map(padded), ...workOn(tlDay).map(b => ({ s: b.s, e: b.e }))].sort((a, b) => a.s - b.s);\n  const fits = [], noRoom = [];\n  for (const r of suggestedOrder(untimed)) {\n    const c = commuteOf(r), dur = durOf(r) + 2 * c; // a task with a commute needs the travel around it too\n    let s0 = cursor;\n    for (const b of busy) if (s0 < b.e && s0 + dur > b.s) s0 = Math.ceil(b.e / 5) * 5;\n    if (s0 + dur > dayEnd) { noRoom.push(r); continue; }\n    fits.push({ r, s: s0 + c, e: s0 + dur - c }); busy.push({ s: s0, e: s0 + dur }); busy.sort((a, b) => a.s - b.s);\n    cursor = s0 + dur;\n  }\n  return { fits, noRoom };\n}\n\n// A task to drag onto the hours (or tap, then tap an hour). On a day's row it shows that day's share.\nfunction poolItem(parent, r, { day = null } = {}) {\n  const m = meta(r.raw);\n  const it = h(\"div\", { class: `pln-pi${picked === r.key ? \" is-picked\" : \"\"}${suggestion?.keys?.includes(r.key) ? \" is-suggested\" : \"\"}`, title: \"Drag onto the hours, or tap it and then tap an hour\", ...(AREA_COLORS[r.area] ? { style: `--blk:${AREA_COLORS[r.area]}` } : {}) }, parent);\n  h(\"span\", { class: \"pln-text\" }, it, label(r.raw));\n  const cs = h(\"span\", { class: \"pln-chips\" }, it);\n  h(\"span\", { class: `pln-chip${m.est === null ? \" is-guess\" : \"\"}`, title: m.spread ? `This day's share of the task` : m.est === null ? `No estimate yet; planned as ${GUESS} minutes` : \"Estimate\" }, cs, m.spread ? fmtEst(m.share ?? GUESS) : m.est === null ? `~${GUESS}m` : fmtEst(m.est));\n  if (m.spread && day) h(\"span\", { class: \"pln-chip\", title: `Spread over ${m.ndays} days` }, cs, `${daysUntil(day) - daysUntil(m.start0) + 1}/${m.ndays}`);\n  else if (!m.spread && !m.recur && spanDays(m.est) > 1) h(\"span\", { class: \"pln-chip is-soon\", title: `${fmtEst(m.est)} is more than your ${state.capacity} hours a day: putting it on the hours spreads it over ${spanDays(m.est)} days, ${fmtEst(m.est / spanDays(m.est))} a day plus buffer` }, cs, `⇉ ${spanDays(m.est)} days`);\n  if (m.recur) h(\"span\", { class: \"pln-chip\", title: \"Repeating task\" }, cs, \"🔁\");\n  if (m.due) { const dd = daysUntil(m.due); h(\"span\", { class: `pln-chip${dd < 0 ? \" is-due\" : dd <= 2 ? \" is-soon\" : \"\"}` }, cs, dd < 0 ? \"overdue\" : dd === 0 ? \"due today\" : `due ${dd}d`); }\n  it.addEventListener(\"click\", () => { if (suppressClick) return; picked = picked === r.key ? null : r.key; render(); });\n  draggable(it, r, \"pool\");\n  menuOn(it, r);\n  return it;\n}\n// The hours shown: your day's start to its end, widened to fit every block.\nfunction hourRange(timed) {\n  const W = Object.values(WORK).flat(); // work and commute always fit on the hours\n  const starts = [...timed.map(r => padded(r).s), ...W.map(b => b.s)], ends = [...timed.map(r => padded(r).e), ...W.map(b => b.e)];\n  const g0 = Math.floor(Math.min(parseClock(state.dayStart) ?? 7 * 60, ...starts) / 60) * 60;\n  const g1 = Math.min(24 * 60, Math.ceil(Math.max(parseClock(state.dayEnd) ?? 21 * 60, ...ends) / 60) * 60);\n  return { g0, g1 };\n}\n// One day's hours with its time blocks. Every grid knows its day, so the day view (one grid) and the week view\n// (a grid per day) share the same dragging, resizing and dropping.\nfunction hourGrid(parent, day, g0, g1, timed, { labels = true } = {}) {\n  const grid = h(\"div\", { class: `pln-grid${picked ? \" is-picking\" : \"\"}`, style: `height:${(g1 - g0) * PXM}px`, \"data-start\": g0, \"data-end\": g1, \"data-day\": day }, parent);\n  for (let t = g0; t < g1; t += 30) { const ln = h(\"div\", { class: `pln-hr${t % 60 ? \" is-half\" : \"\"}`, style: `top:${(t - g0) * PXM}px` }, grid); if (labels && !(t % 60)) h(\"span\", {}, ln, clock(t)); }\n  // the Ideal Week behind the hours: task time tinted, other blocks grey with their name\n  for (const b of bandsOn(day)) {\n    const s = Math.max(b.s, g0), e = Math.min(b.e, g1);\n    if (e <= s) continue;\n    const band = h(\"div\", { class: `pln-ideal${b.tasks ? \" is-tasks\" : \"\"}${b.busy ? \" is-busy\" : \"\"}`, style: `top:${(s - g0) * PXM}px;height:${(e - s) * PXM}px`, title: `${b.busy ? \"Work schedule\" : \"Ideal Week\"}: ${b.what} ${clock(b.s)} - ${clock(b.e)}${b.tasks ? \" (time for tasks)\" : b.busy ? \" (kept free of tasks)\" : \"\"}` }, grid);\n    h(\"span\", {}, band, b.what);\n  }\n  // work and commute: blocks in the Work colour, not movable here (the Work tab's Work schedule changes them). On the\n  // Study and Personal tabs they are only a light shade: the time is taken, but the page stays about its own area.\n  const otherArea = AREA && AREA !== \"work\";\n  for (const b of workOn(day)) {\n    const s = Math.max(b.s, g0), e = Math.min(b.e, g1);\n    if (e <= s) continue;\n    const el = h(\"div\", { class: `pln-work${b.work ? \"\" : \" is-commute\"}${otherArea ? \" is-other\" : \"\"}`, style: `top:${(s - g0) * PXM}px;height:${Math.max(12, (e - s) * PXM - 2)}px;--blk:${AREA_COLORS.work}`, title: `${b.what} ${clock(b.s)} - ${clock(b.e)}: kept free of tasks. Change it in the Work schedule on the Work tab.` }, grid);\n    if (otherArea && !b.work) continue;\n    h(\"b\", {}, el, b.what);\n    if (!otherArea && (e - s) * PXM >= 28) h(\"span\", { class: \"pln-bt\" }, el, ` ${clock(b.s)} - ${clock(b.e)}`);\n  }\n  // on an area tab, other areas' tasks with a time are a light shade: the time is taken, the page stays about its area\n  if (AREA) for (const r of EVERY.filter(r => r.area !== AREA && !EVENT_RE.test(r.raw))) {\n    const m = meta(r.raw);\n    if (!onDate(m, day) || m.start === null || m.done) continue;\n    const s = Math.max(m.start, g0), e = Math.min(m.end, g1);\n    if (e <= s) continue;\n    h(\"div\", { class: \"pln-work is-other\", style: `top:${(s - g0) * PXM}px;height:${Math.max(12, (e - s) * PXM - 2)}px;--blk:${AREA_COLORS[r.area] ?? \"var(--text-faint)\"}`, title: `${r.area ?? \"No area\"}: ${label(r.raw)} ${clock(m.start)} - ${clock(m.end)}. Plan it on its own tab or Home.` }, grid);\n  }\n  commuteBlocks(grid, day, g0, g1, timed);\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();\n  if (day === TODAY && nowMin >= g0 && nowMin < g1) h(\"div\", { class: \"pln-now\", style: `top:${(nowMin - g0) * PXM}px` }, grid);\n  grid.addEventListener(\"click\", ev => {\n    if (!suppressClick && !picked && sel && !ev.target.closest(\".pln-blk\")) { clearSel(); return; }\n    if (suppressClick || !picked || ev.target.closest(\".pln-blk\")) return;\n    const r = byKey.get(picked); picked = null;\n    if (!r) { render(); return; }\n    const s = gridMinute(grid, ev.clientY);\n    void place(r, day, s, s + durOf(r));\n  });\n  selectable(grid);\n  // blocks, side by side where they overlap\n  const blocks = timed.map(r => ({ r, s: meta(r.raw).start, e: Math.max(meta(r.raw).end, meta(r.raw).start + SNAP) })).sort((a, b) => a.s - b.s || b.e - a.e);\n  const laneEnd = [];\n  for (const b of blocks) { let l = laneEnd.findIndex(e => e <= b.s); if (l < 0) { l = laneEnd.length; laneEnd.push(0); } laneEnd[l] = b.e; b.lane = l; }\n  for (const b of blocks) b.cols = Math.max(...blocks.filter(o => o.s < b.e && b.s < o.e).map(o => o.lane)) + 1;\n  for (const b of blocks) {\n    const m = meta(b.r.raw), w = 100 / b.cols;\n    const el = h(\"div\", { class: `pln-blk${m.event ? \" is-event\" : \"\"}${m.done ? \" is-done\" : \"\"}`, style: `top:${(b.s - g0) * PXM}px;height:${Math.max(18, (b.e - b.s) * PXM - 2)}px;left:calc(${b.lane * w}% + 2px);width:calc(${w}% - 4px)${areaStyle(b.r.area)}` }, grid);\n    const top = h(\"div\", {}, el);\n    if (!m.event) { const cb = h(\"input\", { type: \"checkbox\", class: \"task-list-item-checkbox\", style: \"margin:0 4px 0 0;vertical-align:middle\" }, top); cb.checked = m.done; cb.addEventListener(\"click\", e => { e.preventDefault(); e.stopPropagation(); toggle(b.r); }); }\n    h(\"span\", { class: \"pln-bt\" }, top, `${clock(b.s)} - ${clock(b.e)} `);\n    h(\"span\", {}, top, label(b.r.raw));\n    el.addEventListener(\"click\", ev => { if (suppressClick || ev.target.closest(\"input, .pln-x, .pln-rs\")) return; openAt(b.r); });\n    if (m.event) { el.title = \"Calendar event: re-import the calendar to change it\"; continue; }\n    el.title = \"Drag to move, drag the bottom edge to change the length, click to open\";\n    h(\"span\", { class: \"pln-x\", title: \"Remove the time (stays on this day)\" }, el, \"✕\").addEventListener(\"click\", ev => { ev.stopPropagation(); void unTime(b.r); });\n    const rs = h(\"div\", { class: \"pln-rs\" }, el);\n    draggable(rs, b.r, \"resize\");\n    draggable(el, b.r, \"block\");\n    menuOn(el, b.r);\n  }\n  drawSelOn(grid);\n  return blocks;\n}\nconst timedOn = day => ALL.filter(r => { const m = meta(r.raw); return onDate(m, day) && m.start !== null; });\nconst untimedOn = day => tasksOn(day).filter(r => { const m = meta(r.raw); return m.start === null && !m.done && !m.event; });\n\nfunction timeline(root) {\n  const week = state.tlMode === \"week\";\n  const box = h(\"div\", { class: \"pln-box\" }, root);\n  const hd = h(\"h4\", {}, box, week ? \"Week \" : \"Timeline \");\n  const seg = h(\"span\", { class: \"pln-seg\" }, hd);\n  for (const [v, t, tip] of [[\"day\", \"Day\", \"One day as hours\"], [\"week\", \"Week\", \"The week as hours, a column per day\"]]) {\n    const b = h(\"button\", { class: `pln-btn${(week ? \"week\" : \"day\") === v ? \" is-on\" : \"\"}`, title: tip }, seg, t);\n    b.addEventListener(\"click\", () => { state.tlMode = v; save(); render(); });\n  }\n  if (week) return weekView(box, hd);\n  const nav = h(\"span\", { style: \"font-weight:normal;margin-left:6px\" }, hd);\n  const pb = h(\"button\", { class: \"pln-btn\" }, nav, \"‹\"); pb.addEventListener(\"click\", () => { tlDay = iso(addDays(asDate(tlDay), -1)); render(); });\n  h(\"span\", { style: \"margin:0 6px\" }, nav, tlDay === TODAY ? `Today, ${dayLabel(tlDay)}` : dayLabel(tlDay));\n  const nb = h(\"button\", { class: \"pln-btn\" }, nav, \"›\"); nb.addEventListener(\"click\", () => { tlDay = iso(addDays(asDate(tlDay), 1)); render(); });\n  if (tlDay !== TODAY) { const tb = h(\"button\", { class: \"pln-btn\", style: \"margin-left:4px\" }, nav, \"Today\"); tb.addEventListener(\"click\", () => { tlDay = TODAY; render(); }); }\n\n  const timed = timedOn(tlDay);\n  const untimed = untimedOn(tlDay);\n  const { fits, noRoom } = fillPlan(untimed, timed);\n\n  const tools = h(\"div\", { class: \"pln-bar\", style: \"margin:2px 0 8px\" }, box);\n  if (fits.length) {\n    const fb = h(\"button\", { class: \"pln-btn mod-cta\", title: \"Puts this day's tasks without a time into the free time, most urgent first\" }, tools, `Fill the gaps (${fits.length})`);\n    fb.addEventListener(\"click\", () => void bulk(fits.map(p => p.r), `Put ${fits.length} task${fits.length === 1 ? \"\" : \"s\"} on the timeline of ${dayLabel(tlDay)}`, (line, r) => { const p = fits.find(x => x.r === r); return timeOn(line, tlDay, p.s, p.e); }));\n  }\n  const dp = h(\"button\", { class: \"pln-btn\" }, tools, \"Day Planner week ↗\");\n  dp.addEventListener(\"click\", () => { if (!app.commands.executeCommandById(\"obsidian-day-planner:show-weekly-view\")) notify(\"Turn on the Day Planner plugin for its week view.\"); });\n  h(\"span\", { class: \"pln-sub\" }, tools, picked ? \"Now tap an hour to put the chosen task there. Tap it again to cancel.\" : \"Drag a task onto an hour (on a phone: press and hold, or tap it and then tap an hour). Drag a block to move it, its bottom edge to change its length, back to the list to remove its time, or onto a day above to move it there. Drag across empty hours to select a range and see what is in it.\");\n  if (noRoom.length) h(\"p\", { class: \"pln-sub\", style: \"color:var(--color-red);margin:0 0 6px\" }, box, `${noRoom.length} task${noRoom.length === 1 ? \" does\" : \"s do\"} not fit before ${state.dayEnd}: drag ${noRoom.length === 1 ? \"it\" : \"them\"} onto another day in the week.`);\n\n  selPanel(box, \"above\");\n  const wrap = h(\"div\", { class: \"pln-tlw\" }, box);\n  const poolEl = h(\"div\", { class: \"pln-pool\" }, wrap);\n  h(\"h5\", {}, poolEl, untimed.length ? `On this day, no time yet (${untimed.length})` : \"On this day, no time yet: none\");\n  for (const r of untimed) poolItem(poolEl, r, { day: tlDay });\n  const next = pool();\n  h(\"h5\", {}, poolEl, `Next steps (${next.length})`);\n  if (!next.length) h(\"div\", { class: \"pln-sub\" }, poolEl, \"No unplanned next steps.\");\n  for (const r of next) poolItem(poolEl, r);\n\n  const gs = h(\"div\", { class: \"pln-gs\" }, wrap);\n  const { g0, g1 } = hourRange(timed);\n  const blocks = hourGrid(gs, tlDay, g0, g1, timed);\n  // open at the current hour (or the first block)\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();\n  const focus = tlDay === TODAY ? nowMin - 60 : (blocks[0]?.s ?? g0) - 30;\n  const kept = UI.gridScroll[tlDay];\n  requestAnimationFrame(() => { gs.scrollTop = kept ?? Math.max(0, (focus - g0) * PXM); });\n  gs.addEventListener(\"scroll\", () => { UI.gridScroll[tlDay] = gs.scrollTop; });\n  selPanel(box, \"below\");\n}\n\n// Week: a column of hours per day (three days at a time on a narrow screen), each day's tasks without a time in a\n// row under its date, next steps on the side. Everything is written as in the day view: ⏳ for the day,\n// \"HH:MM - HH:MM\" after the checkbox (Day Planner's format), 🛫 and ⏳ for a task spread over days.\nfunction weekView(box, hd) {\n  const width = root.getBoundingClientRect().width || window.innerWidth;\n  // seven days; below about 600 px they sit in a strip that scrolls sideways (about three on screen), opening at the\n  // day you were on, with the hours pinned on the left. The list goes on top below 900 px.\n  const narrow = width < 600, n = 7, stacked = width < 900;\n  const first = iso(addDays(mondayOf(TODAY_D), state.weekOffset * 7));\n  const days = Array.from({ length: n }, (_, i) => iso(addDays(asDate(first), i)));\n  const short = d => `${asDate(d).toLocaleDateString(undefined, { weekday: \"short\" })} ${d.slice(8, 10)}-${d.slice(5, 7)}`;\n  const nav = h(\"span\", { style: \"font-weight:normal;margin-left:6px\" }, hd);\n  const move = k => { state.weekOffset += k > 0 ? 1 : -1; save(); render(); };\n  h(\"button\", { class: \"pln-btn\", title: \"Week before\" }, nav, \"‹\").addEventListener(\"click\", () => move(-1));\n  h(\"span\", { style: \"margin:0 6px\" }, nav, `${short(days[0])} to ${short(days[n - 1])}-${days[n - 1].slice(0, 4)}`);\n  h(\"button\", { class: \"pln-btn\", title: \"Week after\" }, nav, \"›\").addEventListener(\"click\", () => move(1));\n  if (state.weekOffset !== 0) {\n    const tb = h(\"button\", { class: \"pln-btn\", style: \"margin-left:4px\" }, nav, \"This week\");\n    tb.addEventListener(\"click\", () => { state.weekOffset = 0; save(); render(); });\n  }\n  const tools = h(\"div\", { class: \"pln-bar\", style: \"margin:2px 0 8px\" }, box);\n  const dp = h(\"button\", { class: \"pln-btn\" }, tools, \"Day Planner week ↗\");\n  dp.addEventListener(\"click\", () => { if (!app.commands.executeCommandById(\"obsidian-day-planner:show-weekly-view\")) notify(\"Turn on the Day Planner plugin for its week view.\"); });\n  h(\"span\", { class: \"pln-sub\" }, tools, picked ? \"Now tap an hour in any day to put the chosen task there. Tap it again to cancel.\"\n    : \"Drag a next step onto a day and an hour (on a phone: press and hold, or tap it and then tap an hour). A day's tasks without a time wait in the row under its date; drag them into the hours. Drag a block to another day or hour, its bottom edge to change its length, onto a day's row to take its time off, or back to the list. Tap a date to open that day. Drag across empty hours, over several days if you like, to select a range and see what is in it.\");\n\n  // the answer first: how full these days are, and which day is over\n  const loads = days.map(d => { const own = dayLoad(d).all; return { d, own, m: withBuffer(own) }; });\n  const total = loads.reduce((t, x) => t + x.own, 0), over = loads.filter(x => x.m > capMin(x.d));\n  h(\"p\", { class: \"pln-answer\" }, box, `${plusBuffer(total)} planned of ${fmtEst(days.reduce((t, d) => t + capMin(d), 0))} ${IDEAL_ON ? \"of task time in your Ideal Week\" : \"\"} on these ${n} days.${over.length ? ` Over: ${over.map(x => `${short(x.d)} by ${fmtEst(x.m - capMin(x.d))}`).join(\", \")}.` : \" Every day fits.\"}`.replace(\"  on\", \" on\"));\n  selPanel(box, \"above\");\n  const wrap = h(\"div\", { class: `pln-wkw${stacked ? \" is-narrow\" : \"\"}` }, box);\n  const poolEl = h(\"div\", { class: \"pln-pool\" }, wrap);\n  const next = pool();\n  h(\"h5\", {}, poolEl, `Next steps (${next.length})`);\n  if (!next.length) h(\"div\", { class: \"pln-sub\" }, poolEl, \"No unplanned next steps.\");\n  for (const r of next) poolItem(poolEl, r);\n\n  const strip = narrow ? h(\"div\", { class: \"pln-cal-strip\" }, wrap) : wrap;\n  const cal = h(\"div\", { class: `pln-cal${narrow ? \" is-strip\" : \"\"}`, style: `--n:${n}` }, strip);\n  const head = h(\"div\", { class: \"pln-cal-row\" }, cal); h(\"div\", {}, head);\n  const lanes = h(\"div\", { class: \"pln-cal-row\" }, cal); h(\"div\", { class: \"pln-cal-gut\", title: \"Planned for the day, no time yet\" }, lanes, \"no time\");\n  for (const day of days) {\n    const cap = capMin(day);\n    const open = tasksOn(day).filter(r => !meta(r.raw).done);\n    const L = dayLoad(day), planned = withBuffer(L.all);\n    const dh = h(\"div\", { class: `pln-cal-dh${day === TODAY ? \" is-today\" : \"\"}${day < TODAY ? \" is-past\" : \"\"}`, title: \"Open this day in the day view\" }, head);\n    h(\"div\", {}, dh, day === TODAY ? `Today ${short(day).split(\" \")[1]}` : short(day));\n    const capEl = h(\"div\", { class: `pln-cap${planned > cap ? (day > TODAY ? \" is-full\" : \" is-over\") : planned > cap * 0.85 ? \" is-full\" : \"\"}`, title: \"Planned time with buffer, against your hours per day\" }, dh);\n    h(\"div\", { style: `width:${cap ? Math.min(100, (100 * planned) / cap) : 0}%` }, capEl);\n    h(\"div\", { class: \"pln-sub\" }, dh, loadText(L, cap));\n    dh.addEventListener(\"click\", () => { tlDay = day; state.tlMode = \"day\"; save(); render(); });\n    const lane = h(\"div\", { class: \"pln-day pln-lane\", \"data-day\": day }, lanes);\n    birthdayMarks(lane, day);\n    for (const r of untimedOn(day)) poolItem(lane, r, { day });\n    for (const r of ALL.filter(r => { const m = meta(r.raw); return m.due === day && !m.done && !onDate(m, day); })) {\n      const dl = h(\"div\", { class: \"pln-due\", title: \"Deadline on this day (not planned for it)\" }, lane, `⚑ ${label(r.raw)}`);\n      dl.addEventListener(\"click\", () => openAt(r));\n    }\n    projectDueMarks(lane, day, true);\n  }\n  const gs = h(\"div\", { class: \"pln-gs pln-cal-body\" }, cal);\n  const cols = h(\"div\", { class: \"pln-cal-row\" }, gs);\n  const { g0, g1 } = hourRange(days.flatMap(timedOn));\n  const hours = h(\"div\", { class: \"pln-cal-hours\", style: `height:${(g1 - g0) * PXM}px` }, cols);\n  for (let t = g0; t < g1; t += 60) h(\"span\", { style: `top:${(t - g0) * PXM}px` }, hours, clock(t));\n  const firstBlock = [];\n  for (const day of days) firstBlock.push(...hourGrid(cols, day, g0, g1, timedOn(day), { labels: false }).map(b => b.s));\n  const nowMin = NOW.getHours() * 60 + NOW.getMinutes();\n  const focus = days.includes(TODAY) ? nowMin - 60 : (firstBlock.length ? Math.min(...firstBlock) : g0) - 30;\n  const key = `week:${first}`;\n  requestAnimationFrame(() => {\n    if (!narrow) { gs.scrollTop = UI.gridScroll[key] ?? Math.max(0, (focus - g0) * PXM); return; }\n    // the strip scrolls both ways: it opens at the day you were on (today in this week) and the hour of your first block,\n    // or where you left it\n    const at = days.indexOf(days.includes(tlDay) ? tlDay : TODAY), colW = (cal.scrollWidth - 38) / n, saved = UI.stripScroll?.[key];\n    strip.scrollLeft = saved?.x ?? Math.max(0, at) * colW;\n    strip.scrollTop = saved?.y ?? Math.max(0, gs.offsetTop - head.offsetHeight + (focus - g0) * PXM);\n  });\n  if (narrow) strip.addEventListener(\"scroll\", () => { (UI.stripScroll ??= {})[key] = { x: strip.scrollLeft, y: strip.scrollTop }; }, { passive: true });\n  gs.addEventListener(\"scroll\", () => { UI.gridScroll[key] = gs.scrollTop; });\n  selPanel(box, \"below\");\n}\n\nfunction item(parent, r, { day, showSched } = {}) {\n  const m = meta(r.raw);\n  const row = h(\"div\", { class: `pln-item${m.done ? \" is-done\" : \"\"}` }, parent);\n  const cb = h(\"input\", { type: \"checkbox\", class: \"task-list-item-checkbox\" }, row);\n  cb.checked = m.done;\n  cb.addEventListener(\"click\", e => { e.preventDefault(); toggle(r); });\n  const body = h(\"div\", { class: \"pln-text\" }, row);\n  const tx = h(\"div\", {}, body, label(r.raw));\n  tx.addEventListener(\"click\", () => openAt(r));\n  const cs = h(\"div\", {}, body); chips(cs, r, m, { showSched });\n  menuOn(row, r);\n  if (m.done) return;\n  const acts = h(\"span\", { class: \"pln-acts\" }, row);\n  if (!m.event) h(\"span\", { title: \"Edit task: dates, priority, length, price… (or right-click the task)\" }, acts, \"✎\").addEventListener(\"click\", () => edit(r));\n  if (m.recur) return; // the Tasks plugin owns a repeating task's dates\n  if (!m.spread && m.sched && spanDays(m.est) > 1) h(\"span\", { title: `Longer than your ${state.capacity} hours a day: spread it over ${spanDays(m.est)} days from ${dayLabel(m.sched)}` }, acts, \"⇉\").addEventListener(\"click\", () => schedule(r, m.sched));\n  h(\"span\", { title: m.spread ? \"All its days one day earlier\" : \"Day earlier\" }, acts, \"‹\").addEventListener(\"click\", () => shift(r, -1));\n  h(\"span\", { title: m.spread ? \"All its days one day later\" : \"Day later\" }, acts, \"›\").addEventListener(\"click\", () => shift(r, 1));\n  h(\"span\", { title: \"Take off the plan\" }, acts, \"✕\").addEventListener(\"click\", () => schedule(r, null));\n}\n\nrender();\n",
  "project-steps": "// Task sequence by indentation.\n// Usage: await dv.view(\"Meta/views/project-steps\", { files: [\"path.md\"], section: \"Tasks\" })\n// Numbers each task by its place in the outline (1, 1.1, 1.2, 2 ...) and marks the next step:\n// the first open task, top to bottom, that has no open subtasks of its own. A parent with\n// [mode:: parallel] makes all of its open steps next at once. [est::] estimates add up per step and project.\n// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).\n// With allProjects (the EX3C Agenda Project steps widget) you pick projects at the top and each shows as Gantt charts\n// (one per heading that holds tasks) or as the numbered steps list. Bars use 🛫 start, ⏳ scheduled and 📅 due;\n// steps without dates are drawn dashed, in outline order, from their estimates. Dragging a bar writes real dates.\n// the app's Size setting zooms the page: pointer moves arrive zoomed, bar positions are not\nconst ZM = () => dv.container.currentCSSZoom || 1;\nconst AREA = input?.area || null;\nconst AREA_KEYS = app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst AREA_TAG = new RegExp(`(^|\\\\s)#(${AREA_KEYS.join(\"|\") || \"(?!)\"})(?=\\\\s|$)`, \"i\");\nconst areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? \"\").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };\n// allProjects: every note with type: project (not templates, trash, or example seed notes), on an area tab only that area.\nconst files = input?.allProjects\n  ? (() => {\n      const all = dv.pages().where(p => String(p.type ?? \"\") === \"project\" && ![\"Templates/\", \".trash/\", \"scripts/\", \"wiki/\"].some(e => p.file.path.startsWith(e)) && !/\\/templates\\//i.test(p.file.path) && (!AREA || areaOf(\"\", p) === AREA));\n      const real = all.where(p => !(p.file.tags ?? []).includes(\"#example\"));\n      return real.sort(p => p.file.mtime, \"desc\").file.path.array();\n    })()\n  : (input?.files ?? [dv.current().file.path]);\nif (input?.allProjects && !files.length) dv.paragraph(AREA ? `No ${AREA} projects yet. Give a project note area: ${AREA}.` : \"No project notes yet.\");\nconst section = input?.section;\nconst CUR = input?.currency ?? \"EUR\";\nconst money = n => n.toLocaleString(undefined, { style: \"currency\", currency: CUR });\n// Time estimates: [est:: 45m], [est:: 1h 30m], [est:: 1.5h], or a plain number of minutes.\nconst parseEst = s => { const v = String(s ?? \"\").trim().toLowerCase().replace(\",\", \".\"); if (/^\\d+(\\.\\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith(\"h\") ? 60 : 1); } return hit ? m : null; };\nconst fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : \"\", m ? `${m}m` : \"\"].filter(Boolean).join(\" \") || \"0m\"; };\n// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----\nconst tasksApi = app.plugins.plugins[\"obsidian-tasks-plugin\"]?.apiV1;\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));\nconst TASK_RE = /^(\\s*)[-*+] \\[(.)\\] /;\nconst strip = s => s.replace(TASK_RE, \"\").replace(/\\s*✅ \\d{4}-\\d{2}-\\d{2}/, \"\").trim();\nconst isDoneLine = s => /^\\s*[-*+] \\[[xX-]\\]/.test(s);\nconst parseFields = s => { const f = {}; for (const m of s.matchAll(/\\[([\\w-]+)::\\s*([^\\]]*)\\]/g)) f[m[1]] = m[2].trim(); return f; };\n// [with:: previous] on a step: it runs side by side with the step above it instead of after it.\nconst withPrev = r => /\\[with::\\s*previous\\s*\\]/i.test(r.raw);\nconst num = v => (v === undefined || v === \"\" || isNaN(Number(v)) ? undefined : Number(v));\nconst clean = s => strip(s).replace(/^\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}\\s+/, \"\").replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\").replace(/\\s*(📅|⏳|🛫|➕|✅|❌) \\d{4}-\\d{2}-\\d{2}/gu, \"\").replace(/\\s*🔁[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#^]*/u, \"\").replace(/[🔺⏫🔼🔽⏬]/gu, \"\").replace(/\\s*(🆔|⛔) [\\w-]+(?:\\s*,\\s*[\\w-]+)*/gu, \"\").replace(/#[\\w/-]+/g, \"\").replace(/\\s+/g, \" \").trim();\n// r = { path, line, raw } where raw is the full task line as last seen.\nfunction findLine(lines, r) {\n  const key = strip(r.raw);\n  if (lines[r.line] !== undefined && TASK_RE.test(lines[r.line]) && strip(lines[r.line]) === key) return r.line;\n  let best = -1;\n  lines.forEach((l, i) => { if (TASK_RE.test(l) && strip(l) === key && (best < 0 || Math.abs(i - r.line) < Math.abs(best - r.line))) best = i; });\n  return best;\n}\nasync function writeTask(r, mode) {\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) { notify(`Note not found: ${r.path}`); return false; }\n  const lines = (await app.vault.read(f)).split(\"\\n\");\n  const i = findLine(lines, r);\n  if (i < 0) { notify(\"That task changed in its note. Reopen this page to refresh.\"); return false; }\n  const line = lines[i];\n  let next;\n  if (mode === \"edit\") {\n    if (!tasksApi?.editTaskLineModal) { notify(\"The Tasks plugin edit dialog is not available.\"); return false; }\n    next = await tasksApi.editTaskLineModal(line);\n    if (!next) return false;\n    const ind = line.match(/^\\s*/)[0];\n    next = next.split(\"\\n\").map(l => (l.startsWith(ind) ? l : ind + l.trimStart())).join(\"\\n\");\n  } else {\n    next = tasksApi?.executeToggleTaskDoneCommand\n      ? tasksApi.executeToggleTaskDoneCommand(line, r.path)\n      : line.replace(/\\[(.)\\]/, (m, c) => (c === \" \" ? \"[x]\" : \"[ ]\"));\n  }\n  let ok = false;\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    const j = findLine(L, r);\n    if (j < 0) return data;\n    const parts = next.split(\"\\n\");\n    L.splice(j, 1, ...parts);\n    r.line = j + parts.length - 1; // Tasks puts a new recurrence above the completed task\n    r.raw = parts[parts.length - 1];\n    ok = true;\n    return L.join(\"\\n\");\n  });\n  if (!ok) notify(\"That task changed in its note. Reopen this page to refresh.\");\n  return ok;\n}\nfunction iconButton(parent, icon, label, onClick) {\n  const b = parent.createEl(\"span\", { cls: \"clickable-icon\", attr: { \"aria-label\": label, style: \"padding:2px;opacity:0.6\" } });\n  if (obs.setIcon) obs.setIcon(b, icon); else b.setText(\"✎\");\n  b.addEventListener(\"click\", e => { e.preventDefault(); e.stopPropagation(); return onClick(); });\n  return b;\n}\n// ---- end shared ----\n\n// ⛔ waits for the open task with that 🆔, anywhere in the vault (as in the Tasks plugin and the planner).\n// A step whose blocker is still open shows a ⛔ badge; \"available\" means nothing it waits for is open.\nconst OPEN_IDS = new Map();\nfor (const t of dv.pages().where(p => ![\"Templates/\", \".trash/\", \"scripts/\", \"wiki/\"].some(e => p.file.path.startsWith(e))).file.tasks.where(t => !t.completed && t.status !== \"-\").array()) {\n  const id = t.text.match(/🆔 ([\\w-]+)/u)?.[1];\n  if (id) OPEN_IDS.set(id, clean(`- [ ] ${t.text}`));\n}\nconst waitsFor = r => (isDoneLine(r.raw) ? [] : (r.raw.match(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u)?.[1] ?? \"\").split(/\\s*,\\s*/).filter(id => id && OPEN_IDS.has(id)).map(id => OPEN_IDS.get(id)));\nconst costOf = r => { const f = parseFields(r.raw), p = num(f.price); return p === undefined ? 0 : p * (num(f.qty) ?? 1); };\n\n// ctr is shared with the children of plain (non-task) bullets, so numbering carries on through them\nfunction walk(items, prefix, depth, out, parent, ctr = { n: 0 }) {\n  for (const it of items) {\n    if (!it.task) { walk(it.children ?? [], prefix, depth, out, parent, ctr); continue; }\n    const n = ++ctr.n;\n    const r = { path: it.path, line: it.line, raw: `${\"\\t\".repeat(depth)}- [${it.status}] ${it.text}`, num: prefix ? `${prefix}.${n}` : `${n}`, depth, kids: [], up: parent };\n    out.push(r);\n    if (parent) parent.kids.push(r);\n    walk(it.children ?? [], r.num, depth + 1, out, r);\n  }\n}\n\nfunction project(path, host = dv.container) {\n  const page = dv.page(path);\n  if (!page) { host.createEl(\"p\", { text: `Not found: ${path}` }); return; }\n  const roots = page.file.lists.where(l => l.parent === undefined || l.parent === null)\n    .where(l => !section || l.section?.subpath === section).array();\n  const rows = [];\n  walk(roots, \"\", 0, rows, null);\n  const box = host.createEl(\"div\", { cls: \"lifeos-widget\" });\n\n  function draw() {\n    box.empty();\n    const done = r => isDoneLine(r.raw);\n    // Steps run in order unless their parent has [mode:: parallel]; then every open step under it is next.\n    const parallel = r => (parseFields(r.raw).mode ?? \"\").toLowerCase() === \"parallel\";\n    const actionable = r => (done(r) ? [] : r.kids.some(k => !done(k)) ? fromList(r.kids, parallel(r)) : [r]);\n    // Same rules as the planner: a purchase never holds up the steps after it, a ⏫ or 🔺 step is next wherever\n    // it sits, and a step waiting for an open ⛔ is not next.\n    const isPurchase = r => r.kids.every(done) && (\"price\" in parseFields(r.raw) || /^(buy|order|purchase)\\b/i.test(clean(r.raw)));\n    const fromList = (list, par) => {\n      const open = list.filter(k => !done(k));\n      if (par) return open.flatMap(actionable);\n      const group = [];\n      let i = 0;\n      for (; i < open.length; i++) { group.push(open[i]); if (!isPurchase(open[i])) break; }\n      for (i++; i < open.length && withPrev(open[i]); i++) group.push(open[i]);\n      return group.flatMap(actionable);\n    };\n    const openIds = new Set(rows.filter(r => !done(r)).map(r => r.raw.match(/🆔 ([\\w-]+)/u)?.[1]).filter(Boolean));\n    const blocked = r => (r.raw.match(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u)?.[1] ?? \"\").split(/\\s*,\\s*/).some(id => id && openIds.has(id));\n    const nexts = [...new Set([...fromList(rows.filter(r => r.depth === 0), false),\n      ...rows.filter(r => !done(r) && !r.kids.some(k => !done(k)) && /[🔺⏫]/u.test(r.raw))])].filter(r => !blocked(r));\n    const spend = rows.filter(r => !done(r)).reduce((s, r) => { const f = parseFields(r.raw); return s + (num(f.price) ?? 0) * (num(f.qty) ?? 1); }, 0);\n    const count = rows.filter(done).length;\n    // Time left: a task's own estimate while it is open, plus everything still open under it.\n    const own = r => parseEst(parseFields(r.raw).est) ?? 0;\n    const left = r => (done(r) ? 0 : own(r)) + r.kids.reduce((s, k) => s + left(k), 0);\n    const timeLeft = rows.filter(r => r.depth === 0).reduce((s, r) => s + left(r), 0);\n    const unestimated = rows.filter(r => !done(r) && !r.kids.length && parseEst(parseFields(r.raw).est) === null).length;\n    const head = box.createEl(\"div\", { attr: { style: \"display:flex;justify-content:space-between;align-items:baseline;gap:1em;flex-wrap:wrap\" } });\n    const a = head.createEl(\"h4\", { attr: { style: \"margin:0\" } }).createEl(\"a\", { text: page.file.name, cls: \"internal-link\" });\n    a.addEventListener(\"click\", () => app.workspace.openLinkText(path, \"\", false));\n    head.createEl(\"span\", { text: `${count} of ${rows.length} done${timeLeft ? ` · ${fmtEst(timeLeft)} left` : \"\"}${timeLeft && unestimated ? ` (${unestimated} step${unestimated === 1 ? \"\" : \"s\"} without estimate)` : \"\"}${spend ? ` · ${money(spend)} still to buy` : \"\"}`, attr: { style: \"color:var(--text-muted);font-size:0.9em\" } });\n    const bar = box.createEl(\"div\", { attr: { style: \"height:4px;background:var(--background-modifier-border);border-radius:2px;margin:0.4em 0 0.6em\" } });\n    bar.createEl(\"div\", { attr: { style: `height:4px;width:${rows.length ? (100 * count / rows.length) : 0}%;background:var(--interactive-accent);border-radius:2px` } });\n    box.createEl(\"div\", { text: nexts.length ? `Next: ${nexts.map(n => `${n.num}  ${clean(n.raw)}${own(n) ? ` (${fmtEst(own(n))})` : \"\"}`).join(\"  ·  \")}` : \"All steps done.\", attr: { style: \"font-weight:600;margin-bottom:0.4em\" } });\n\n    for (const r of rows) {\n      const d = done(r), isNext = nexts.includes(r), f = parseFields(r.raw);\n      const row = box.createEl(\"div\", { attr: { style: `display:flex;gap:0.5em;align-items:center;padding:2px 4px;margin-left:${r.depth * 1.6}em;border-radius:4px;${isNext ? \"background:var(--background-modifier-hover);\" : \"\"}` } });\n      const cb = row.createEl(\"input\", { type: \"checkbox\", cls: \"task-list-item-checkbox\" });\n      cb.checked = d;\n      cb.addEventListener(\"click\", async e => {\n        e.preventDefault();\n        const before = r.raw;\n        r.raw = r.raw.replace(/\\[(.)\\]/, d ? \"[ ]\" : \"[x]\"); // show the change right away\n        draw();\n        r.raw = before;\n        if (!(await writeTask(r, \"toggle\"))) r.raw = before;\n        draw();\n      });\n      row.createEl(\"span\", { text: r.num, attr: { style: \"color:var(--text-muted);font-variant-numeric:tabular-nums;min-width:2.5em\" } });\n      const txt = row.createEl(\"span\", { text: clean(r.raw), attr: { style: `cursor:pointer;${d ? \"color:var(--text-faint);text-decoration:line-through;\" : \"\"}` } });\n      txt.addEventListener(\"click\", () => app.workspace.openLinkText(path, \"\", false, { eState: { line: r.line } }));\n      const right = row.createEl(\"span\", { attr: { style: \"margin-left:auto;display:flex;gap:0.4em;align-items:center\" } });\n      const price = num(f.price), qty = num(f.qty) ?? 1;\n      const mins = r.kids.length ? left(r) : own(r);\n      if (mins) right.createEl(\"span\", { text: r.kids.length ? `${fmtEst(mins)} left` : fmtEst(mins), attr: { title: r.kids.length ? \"Estimated time still open in this step\" : \"Estimate\", style: `color:var(--text-muted);font-size:0.85em;white-space:nowrap;${r.kids.length ? \"font-style:italic;\" : \"\"}` } });\n      if (price !== undefined) right.createEl(\"span\", { text: qty !== 1 ? `${qty} × ${money(price)}` : money(price), attr: { style: \"color:var(--text-muted);font-size:0.85em;white-space:nowrap\" } });\n      const wf = waitsFor(r);\n      if (wf.length) right.createEl(\"span\", { text: \"⛔ blocked\", attr: { title: `Waits for: ${wf.join(\", \")}`, style: \"font-size:0.75em;padding:0 6px;border-radius:8px;border:1px solid var(--color-red);color:var(--color-red);white-space:nowrap\" } });\n      if (r.kids.length && !d) { const ls = r.kids.flatMap(function lv(k) { return k.kids.length ? k.kids.flatMap(lv) : [k]; }), c = ls.filter(k => !done(k)).reduce((t, k) => t + costOf(k), 0); right.createEl(\"span\", { text: `${ls.filter(done).length} of ${ls.length}${c ? ` · ${money(c)} to buy` : \"\"}`, attr: { title: \"Sub-steps done, and what is still to buy under this step\", style: \"color:var(--text-muted);font-size:0.85em;white-space:nowrap\" } }); }\n      if (isNext) right.createEl(\"span\", { text: \"next\", attr: { style: \"font-size:0.75em;padding:0 6px;border-radius:8px;background:var(--interactive-accent);color:var(--text-on-accent)\" } });\n      iconButton(right, \"pencil\", \"Edit task\", async () => { if (await writeTask(r, \"edit\")) draw(); });\n    }\n  }\n  draw();\n}\n\n// ---------- Gantt ----------\nconst DAY = 86400000;\nconst pad = n => String(n).padStart(2, \"0\");\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst asDate = s => new Date(`${s}T12:00:00`);\nconst addDays = (s, n) => iso(new Date(asDate(s).getTime() + n * DAY));\nconst diffDays = (a, b) => Math.round((asDate(b) - asDate(a)) / DAY);\nconst TODAY = iso(new Date());\nconst dmy = s => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;\n// a step's estimate becomes days at this many hours of work per day: the planner's Hours per day (config note)\nconst HOURS_PER_DAY = input?.hoursPerDay ?? (Number(dv.page(\"Meta/EX3C Agenda Config.md\")?.planner_hours_per_day) || 4);\nconst BUFFER = Number(dv.page(\"Meta/EX3C Agenda Config.md\")?.planner_buffer ?? 25) || 0; // the planner's Buffer %\nconst ZOOM = { day: 26, week: 10, month: 3.5 }; // px per day\nconst STORE = \"compass-project-steps\";\nconst ui = (() => { try { return { selected: null, view: {}, zoom: \"day\", ...JSON.parse(localStorage.getItem(STORE) || \"{}\") }; } catch (e) { return { selected: null, view: {}, zoom: \"day\" }; } })();\nconst saveUi = () => { try { localStorage.setItem(STORE, JSON.stringify(ui)); } catch (e) {} };\nconst KEEP = (window.__compassSteps ??= { scroll: {} }); // horizontal scroll per chart, kept across Dataview reruns\n// The task title column: drag the line between titles and chart (on a phone, press and drag it) to make it wider or\n// narrower. The width is kept per device (phone and desktop each their own), every chart uses it.\nconst LABEL_KEY = window.innerWidth <= 600 ? \"labelWPhone\" : \"labelW\";\nconst labelWidth = () => Math.max(60, Math.min(700, Number(ui[LABEL_KEY]) || (window.innerWidth <= 600 ? 130 : 380)));\nfunction splitter(wrap, labels) {\n  const bar = wrap.createEl(\"div\", { cls: \"pg-split\", attr: { title: \"Drag to make the titles wider or narrower; double-click for the standard width\" } });\n  bar.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0) return;\n    ev.preventDefault(); ev.stopPropagation();\n    try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* not a real pointer */ }\n    const x0 = ev.clientX, w0 = labels.offsetWidth, z = ZM();\n    bar.classList.add(\"is-dragging\");\n    const move = e => { const w = Math.max(60, Math.min(700, Math.round(w0 + (e.clientX - x0) / z))); for (const l of dv.container.querySelectorAll(\".pg-labels\")) l.style.width = `${w}px`; ui[LABEL_KEY] = w; };\n    const up = () => { bar.classList.remove(\"is-dragging\"); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", up); saveUi(); };\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", up);\n  });\n  bar.addEventListener(\"dblclick\", () => { delete ui[LABEL_KEY]; saveUi(); for (const l of dv.container.querySelectorAll(\".pg-labels\")) l.style.width = `${labelWidth()}px`; });\n}\n\nfunction setDate(line, emoji, date) {\n  const re = new RegExp(`\\\\s*${emoji} \\\\d{4}-\\\\d{2}-\\\\d{2}`, \"u\");\n  const out = line.replace(re, \"\");\n  if (!date) return out;\n  const m = out.match(/\\s\\^[\\w-]+\\s*$/);\n  return m ? `${out.slice(0, m.index)} ${emoji} ${date}${out.slice(m.index)}` : `${out.trimEnd()} ${emoji} ${date}`;\n}\nasync function writeLine(r, fn) {\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) return false;\n  let ok = false;\n  await app.vault.process(f, data => { const L = data.split(\"\\n\"); const j = findLine(L, r); if (j < 0) return data; L[j] = fn(L[j]); r.raw = L[j]; r.line = j; ok = true; return L.join(\"\\n\"); });\n  if (!ok) notify(\"That task changed in its note. Reopen this page to refresh.\");\n  return ok;\n}\n\n// ---------- shared by both charts: done steps, parents, folding (option C, 25-10-2026) ----------\n// Done and cancelled steps leave the projection: they are drawn where they happened (left of today) or listed as\n// \"✓ date\", never in a future slot. A parent is a band (top level, with its area colour on the left edge) and a\n// bracket spanning its open steps, filled to the share done by estimate; ▾/▸ folds it. Steps without an estimate\n// say so as text instead of a dashed guess.\nconst isCancelled = r => /^\\s*[-*+] \\[-\\]/.test(r.raw);\n// the default estimate (planner ⚙, default_estimate in the config note): a step without [est::] counts this much, drawn dashed\nconst DEFAULT_EST = parseEst(dv.page(\"Meta/EX3C Agenda Config.md\")?.default_estimate) || 30;\nconst isRecur = r => /🔁/u.test(r.raw);\nconst TIME_RANGE = /^\\s*[-*+] \\[.\\] (\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s/;\nconst AREA_COLOURS = { work: \"#4a7fd4\", study: \"#8f6bdc\", personal: \"#4bb38a\" };\nconst areaColour = path => { const a = areaOf(\"\", dv.page(path)); return a ? app.plugins.plugins[\"ex3c-agenda\"]?.areaColors?.()[a] ?? AREA_COLOURS[a] ?? \"var(--interactive-accent)\" : \"var(--interactive-accent)\"; };\nconst leavesOf = r => (r.kids.length ? r.kids.flatMap(leavesOf) : [r]);\nfunction prep(rows) {\n  for (const r of rows) {\n    r.done = isDoneLine(r.raw); r.cancel = isCancelled(r);\n    r.doneOn = r.raw.match(/✅ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? r.raw.match(/❌ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null;\n    const t = r.raw.match(TIME_RANGE), took = t ? (+t[3] * 60 + +t[4]) - (+t[1] * 60 + +t[2]) : null;\n    r.took = took > 0 ? took : null;\n    r.est = parseEst(parseFields(r.raw).est);\n    r.guess = r.est === null; r.estUsed = r.est ?? DEFAULT_EST;\n  }\n  const settled = r => r.done && r.kids.every(settled);\n  for (const r of rows) {\n    r.settled = settled(r);\n    if (!r.kids.length) continue;\n    const ls = leavesOf(r).filter(l => !isRecur(l)); // counts use steps without sub-steps; repeats never count\n    r.nLeaves = ls.length; r.nDone = ls.filter(l => l.done).length;\n    r.estAll = ls.reduce((s, l) => s + l.estUsed, 0); r.estDone = ls.filter(l => l.done).reduce((s, l) => s + l.estUsed, 0);\n    r.lastDone = ls.map(l => l.doneOn).filter(Boolean).sort().pop() ?? r.doneOn;\n    r.costLeft = ls.filter(l => !l.done).reduce((t, l) => t + costOf(l), 0);\n  }\n  for (const r of rows) r.blockedBy = r.kids.length ? [] : waitsFor(r);\n}\nconst foldKey = (path, r) => `${path}#${clean(r.raw)}`;\n// a parent that is done with everything under it folds by itself; ▾/▸ overrides that\nconst isFolded = (path, r) => { const v = ui.fold?.[foldKey(path, r)]; return v === undefined ? r.kids.length > 0 && r.settled : v; };\nfunction visibleRows(rows, path) {\n  const out = [];\n  const go = list => { for (const r of list) { out.push(r); if (r.kids.length && !isFolded(path, r)) go(r.kids); } };\n  go(rows.filter(r => r.depth === 0));\n  return out;\n}\nconst shortDate = d => `${d.slice(8, 10)}-${d.slice(5, 7)}`;\n// The project note's own deadline (due property, a date): a line on the calendar Gantt, a chip by the project name.\nconst projectDue = path => { const v = dv.page(path)?.due; const s = v?.toISODate ? v.toISODate() : String(v ?? \"\").slice(0, 10); return /^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? s : null; };\n// what the row says on the right of its name\nfunction rowMeta(r, path) {\n  if (r.kids.length) {\n    if (r.settled) return `✓ ${r.lastDone ? shortDate(r.lastDone) : \"done\"} · ${r.nLeaves} step${r.nLeaves === 1 ? \"\" : \"s\"}`;\n    return `${r.nDone} of ${r.nLeaves}${r.estAll ? ` · ${fmtEst(r.estDone)} of ${fmtEst(r.estAll)}` : \"\"}${r.costLeft ? ` · ${money(r.costLeft)}` : \"\"}`;\n  }\n  if (r.done) return [r.est ? fmtEst(r.est) : \"\", r.took ? `took ${fmtEst(r.took)}` : r.doneOn ? `✓ ${shortDate(r.doneOn)}` : r.cancel ? \"cancelled\" : \"✓\"].filter(Boolean).join(\" · \");\n  return r.est ? fmtEst(r.est) : `~${fmtEst(DEFAULT_EST)}`;\n}\nfunction labelRow(labels, r, i, path, ROW, opts = {}) {\n  const top = r.depth === 0 && r.kids.length > 0;\n  const lab = labels.createEl(\"div\", { cls: `pg-label${r.done ? \" is-done\" : \"\"}${top ? \" is-band\" : \"\"}${r.kids.length ? \" is-parent\" : \"\"}`, attr: { style: `height:${ROW}px;padding-left:${4 + r.depth * 14}px`, \"data-row\": i } });\n  if (opts.grip) opts.grip(lab);\n  const chev = lab.createEl(\"span\", { cls: \"pg-chev\", text: r.kids.length ? (isFolded(path, r) ? \"▸\" : \"▾\") : \"\" });\n  if (r.kids.length) { chev.title = isFolded(path, r) ? \"Show its steps\" : \"Fold its steps\"; chev.addEventListener(\"click\", e => { e.stopPropagation(); ui.fold = { ...(ui.fold ?? {}), [foldKey(path, r)]: !isFolded(path, r) }; saveUi(); redraw(); }); }\n  const cb = lab.createEl(\"input\", { type: \"checkbox\", cls: \"task-list-item-checkbox\" });\n  cb.checked = r.done;\n  cb.addEventListener(\"click\", async e => { e.preventDefault(); if (await writeTask(r, \"toggle\")) redraw(); });\n  lab.createEl(\"span\", { text: `${r.num} `, cls: \"pg-num\" });\n  const t = lab.createEl(\"span\", { text: clean(r.raw), cls: \"pg-text\" });\n  t.title = clean(r.raw);\n  t.addEventListener(\"click\", () => app.workspace.openLinkText(path, \"\", false, { eState: { line: r.line } }));\n  if (r.blockedBy?.length) {\n    const bk = lab.createEl(\"span\", { cls: \"pg-blocked\", text: \"⛔\", attr: { title: `Blocked: waits for ${r.blockedBy.join(\", \")}. Click to remove a link.` } });\n    bk.addEventListener(\"click\", e => { e.stopPropagation(); linkMenu(e, r, depsOf(r).filter(id => OPEN_IDS.has(id))); });\n  }\n  lab.createEl(\"span\", { cls: \"pg-meta\", text: rowMeta(r, path) });\n  return lab;\n}\n// the row behind the chart: a faint band for a top-level parent\nconst plotRow = (plot, r, top, ROW) => plot.createEl(\"div\", { cls: `pg-row${r.depth === 0 && r.kids.length ? \" is-band\" : \"\"}`, attr: { style: `top:${top}px;height:${ROW}px` } });\n// a parent's bracket from x0 to x1, filled to the share done; folded, it shows a tick where each open step sits\nfunction bracket(plot, r, top, x0, x1, ticks) {\n  const w = Math.max(8, x1 - x0), share = r.estAll ? r.estDone / r.estAll : r.nLeaves ? r.nDone / r.nLeaves : 0;\n  const b = plot.createEl(\"div\", { cls: `pg-bracket${r.depth ? \" is-nested\" : \"\"}`, attr: { style: `top:${top + 7}px;left:${x0}px;width:${w}px` } });\n  b.createEl(\"div\", { cls: \"pg-bracket-fill\", attr: { style: `width:${Math.round(share * 100)}%` } });\n  b.title = `${clean(r.raw)}\\n${rowMeta(r)}: the bracket spans its open steps, filled to the share done`;\n  for (const tx of ticks || []) plot.createEl(\"div\", { cls: \"pg-tickmark\", attr: { style: `top:${top + 17}px;left:${tx}px` } });\n  return b;\n}\nconst noEstimate = (plot, r, top, x, path) => {\n  const n = plot.createEl(\"div\", { cls: \"pg-noest\", text: \"no estimate · add one\", attr: { style: `top:${top + 5}px;left:${x}px`, title: \"Add [est:: 1h] to the step; it is not drawn until then. Click to open it.\" } });\n  n.addEventListener(\"click\", () => app.workspace.openLinkText(path, \"\", false, { eState: { line: r.line } }));\n};\n\n// Work out a bar for every open task: written dates win; the rest follow the outline (steps in order,\n// [mode:: parallel] together). Done steps are placed where they happened (their ✅ date), not in the future.\nfunction schedule(rows) {\n  // 🛫 with a later ⏳ is a task the planner spread over several days: the bar runs from 🛫 to ⏳\n  const dates = r => { const st = r.raw.match(/🛫 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null, sc = r.raw.match(/⏳ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null;\n    return { start: st ?? sc, ownStart: !!st, spreadEnd: st && sc && sc > st ? sc : null, due: r.raw.match(/📅 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? null }; };\n  // days of work, with the planner's buffer, so an undated bar is as long as the planner would spread the task\n  const days = r => { const e = r.est ?? r.took ?? DEFAULT_EST; return e ? Math.max(1, Math.ceil(e * (1 + BUFFER / 100) / (HOURS_PER_DAY * 60))) : 1; };\n  const place = (list, earliest, parallel) => {\n    let cursor = earliest, end = null;\n    const starts = [];\n    for (const r of list) {\n      const d = dates(r), from = parallel ? earliest : cursor;\n      Object.assign(r, { s: null, e: null, inferred: false, due: d.due, hasStart: !!d.start, actual: false, noEst: false });\n      if (r.settled) {\n        if (!r.kids.length && r.doneOn) Object.assign(r, { e: r.doneOn, s: addDays(r.doneOn, -(days(r) - 1)), actual: true });\n        if (r.kids.length) place(r.kids, earliest, true); // its done steps get their own done dates\n        continue;\n      }\n      let s, e, inferred = false;\n      if (r.kids.length) {\n        const span = place(r.kids, d.start ?? from, (parseFields(r.raw).mode ?? \"\").toLowerCase() === \"parallel\");\n        s = d.start ?? span.start; e = d.due && (!span.end || d.due > span.end) ? d.due : span.end ?? s;\n        inferred = !d.start && !d.due && span.inferred;\n        r.parent = true;\n      } else if (d.spreadEnd) { s = d.start; e = d.spreadEnd; }\n      else if (d.start && d.due && d.ownStart) { s = d.start; e = d.due < d.start ? d.start : d.due; }\n      else if (d.start) { s = d.start; e = addDays(s, days(r) - 1); }\n      else if (d.due) { e = d.due; s = addDays(e, -(days(r) - 1)); r.dueOnly = true; }\n      else { s = from; e = addDays(s, days(r) - 1); inferred = true; }\n      Object.assign(r, { s, e, inferred });\n      if (!parallel && !r.noEst) { const nextDay = addDays(e, 1); if (nextDay > cursor) cursor = nextDay; }\n      if (!r.noEst) { end = !end || e > end ? e : end; starts.push(s); }\n    }\n    starts.sort();\n    return { start: starts[0] ?? earliest, end, inferred: list.filter(r => !r.settled).every(r => r.inferred) };\n  };\n  place(rows.filter(r => r.depth === 0), TODAY, false);\n}\n\nfunction charts(path, host) {\n  const page = dv.page(path);\n  if (!page) return;\n  const groups = new Map(); // heading -> root list items\n  for (const l of page.file.lists.where(l => l.parent === undefined || l.parent === null).array()) {\n    const key = l.section?.subpath && l.section.subpath !== page.file.name ? l.section.subpath : \"Tasks\";\n    if (!groups.has(key)) groups.set(key, []);\n    groups.get(key).push(l);\n  }\n  let any = false;\n  for (const [heading, roots] of groups) {\n    let rows = [];\n    walk(roots, \"\", 0, rows, null);\n    rows = rows.filter(r => clean(r.raw) || r.kids.length); // skip empty \"- [ ]\" lines\n    if (!rows.length || /^done$/i.test(heading) && rows.every(r => isDoneLine(r.raw))) continue;\n    any = true;\n    for (const r of rows) r.chart = rows;\n    prep(rows);\n    if (timeModeOf(path) === \"sequence\") seqGantt(host, path, heading, rows, groups.size > 1);\n    else gantt(host, path, heading, rows, groups.size > 1);\n  }\n  if (!any) host.createEl(\"p\", { text: \"No tasks in this project note yet.\", attr: { style: \"color:var(--text-muted)\" } });\n}\n\nfunction gantt(host, path, heading, rows, showHeading) {\n  schedule(rows);\n  const vis = visibleRows(rows, path);\n  const PX = ZOOM[ui.zoom] ?? ZOOM.day, ROW = 26, LABEL = labelWidth();\n  const pdue = projectDue(path);\n  const all = rows.flatMap(r => [r.s, r.e, r.due].filter(Boolean)).concat([TODAY], pdue ? [pdue] : []).sort();\n  const first = addDays(all[0], -2), last = addDays(all[all.length - 1], 4);\n  const span = diffDays(first, last) + 1, W = span * PX;\n  const x = d => diffDays(first, d) * PX;\n  const box = host.createEl(\"div\", { cls: \"pg-box\", attr: { style: `--area:${areaColour(path)}` } });\n  if (showHeading) box.createEl(\"div\", { text: heading, cls: \"pg-head\" });\n  const wrap = box.createEl(\"div\", { cls: \"pg-wrap\" });\n  const labels = wrap.createEl(\"div\", { cls: \"pg-labels\", attr: { style: `width:${LABEL}px` } });\n  splitter(wrap, labels);\n  const scroller = wrap.createEl(\"div\", { cls: \"pg-scroll\" });\n  const plot = scroller.createEl(\"div\", { cls: \"pg-plot\", attr: { style: `width:${W}px;height:${36 + vis.length * ROW}px` } });\n  // time axis: month names, then weekday and day, or week starts\n  labels.createEl(\"div\", { cls: \"pg-axis-pad\" });\n  for (let i = 0; i < span; i++) {\n    const d = addDays(first, i), dt = asDate(d);\n    if (dt.getDate() === 1 || i === 0) plot.createEl(\"div\", { cls: \"pg-month\", text: dt.toLocaleDateString(undefined, { month: \"short\", year: \"numeric\" }), attr: { style: `left:${x(d)}px` } });\n    const wk = dt.getDay() === 0 || dt.getDay() === 6;\n    if (ui.zoom === \"day\") { if (wk) plot.createEl(\"div\", { cls: \"pg-weekend\", attr: { style: `left:${x(d)}px;width:${PX}px` } }); plot.createEl(\"div\", { cls: `pg-tick${d === TODAY ? \" is-today\" : \"\"}`, text: String(dt.getDate()), attr: { style: `left:${x(d)}px;width:${PX}px`, title: dt.toLocaleDateString(undefined, { weekday: \"long\" }) } }); }\n    else if (dt.getDay() === 1 && ui.zoom === \"week\") plot.createEl(\"div\", { cls: \"pg-tick is-week\", text: `${dt.getDate()}-${dt.getMonth() + 1}`, attr: { style: `left:${x(d)}px` } });\n  }\n  plot.createEl(\"div\", { cls: \"pg-today\", attr: { style: `left:${x(TODAY) + PX / 2}px`, title: `Today ${dmy(TODAY)}` } });\n  if (pdue) plot.createEl(\"div\", { cls: \"pg-pdue\", text: \"⚑\", attr: { style: `left:${x(pdue) + PX}px`, title: `Project due ${dmy(pdue)} (the due property of the project note)` } });\n  vis.forEach((r, i) => {\n    const top = 36 + i * ROW;\n    labelRow(labels, r, i, path, ROW);\n    plotRow(plot, r, top, ROW);\n    if (r.kids.length) {\n      if (r.settled) { plot.createEl(\"div\", { cls: \"pg-donetext\", text: `✓ ${r.lastDone ? shortDate(r.lastDone) : \"\"}`, attr: { style: `top:${top + 5}px;left:${x(r.lastDone ?? TODAY)}px` } }); return; }\n      const folded = isFolded(path, r);\n      const ticks = folded ? leavesOf(r).filter(l => !l.done && l.s && !l.noEst).map(l => x(l.s) + 2) : [];\n      const b = bracket(plot, r, top, x(r.s), x(r.e) + PX, ticks);\n      b.title += `\\n${dmy(r.s)} to ${dmy(r.e)}\\nDrag to move this step with all its sub-steps`; dragGroup(b, r, PX);\n      if (r.due && r.due > r.e) plot.createEl(\"div\", { cls: \"pg-due\", text: \"⚑\", attr: { style: `top:${top + 3}px;left:${x(r.due)}px`, title: `Due ${dmy(r.due)}` } });\n      return;\n    }\n    if (r.done) {\n      if (r.actual) { const bar = plot.createEl(\"div\", { cls: \"pg-bar is-done\", attr: { style: `top:${top + 7}px;left:${x(r.s)}px;width:${Math.max(PX - 4, (diffDays(r.s, r.e) + 1) * PX - 4)}px;height:12px` } }); bar.title = `${clean(r.raw)}\\nDone ${dmy(r.doneOn)}${r.took ? `, took ${fmtEst(r.took)}` : \"\"}`; plot.createEl(\"div\", { cls: \"pg-check\", text: \"✓\", attr: { style: `top:${top + 4}px;left:${x(r.e) + PX}px` } }); }\n      else plot.createEl(\"div\", { cls: \"pg-donetext\", text: r.cancel ? \"cancelled\" : \"✓ no date\", attr: { style: `top:${top + 5}px;left:${x(TODAY) - 70}px` } });\n      return;\n    }\n    if (r.noEst) { noEstimate(plot, r, top, x(r.s), path); return; }\n    const late = r.e < TODAY, past = !late && pdue && r.e > pdue;\n    const bar = plot.createEl(\"div\", { cls: `pg-bar${r.inferred ? \" is-inferred\" : \"\"}${late ? \" is-late\" : \"\"}${past ? \" is-pastdue\" : \"\"}${r.blockedBy?.length ? \" is-blocked\" : \"\"}`,\n      attr: { \"data-key\": `${r.line}`, style: `top:${top + 5}px;left:${x(r.s)}px;width:${Math.max(PX, (diffDays(r.s, r.e) + 1) * PX)}px;height:16px` } });\n    bar.title = `${clean(r.raw)}\\n${dmy(r.s)} to ${dmy(r.e)}${r.blockedBy?.length ? `\\n⛔ Blocked: waits for ${r.blockedBy.join(\", \")}` : \"\"}${r.inferred ? \" (not planned yet: placed in outline order from its estimate)\" : \"\"}${late ? \"\\nOverdue\" : \"\"}${past ? `\\nEnds after the project deadline (${dmy(pdue)})` : \"\"}`;\n    if (r.due && r.due > r.e) plot.createEl(\"div\", { cls: \"pg-due\", text: \"⚑\", attr: { style: `top:${top + 3}px;left:${x(r.due)}px`, title: `Due ${dmy(r.due)}` } });\n    const grip = bar.createEl(\"div\", { cls: \"pg-grip\", attr: { title: \"Drag to change the end date\" } });\n    linkHandle(bar, r, plot);\n    dragBar(bar, r, \"move\", PX);\n    dragBar(grip, r, \"end\", PX);\n  });\n  depArrows(plot, vis, r => (r.s && !r.done && !r.noEst && !r.kids.length ? { x0: x(r.s), x1: x(r.e) + PX } : null), ROW);\n  const sk = `${path}#${heading}`;\n  requestAnimationFrame(() => { scroller.scrollLeft = KEEP.scroll[sk] ?? Math.max(0, x(TODAY) - 3 * PX * (ui.zoom === \"day\" ? 3 : 7)); });\n  scroller.addEventListener(\"scroll\", () => { KEEP.scroll[sk] = scroller.scrollLeft; });\n}\n\n// ---------- Sequence mode: no calendar ----------\n// The x axis is hours of work still to do, not dates: open steps follow the outline one after another\n// ([mode:: parallel] side by side, ⛔ waits for the step with that 🆔), each as long as its [est::]. Done work is\n// not on the axis; a step without an estimate takes no room and says so.\nconst SEQ_ZOOM = { day: 40, week: 14, month: 5 }; // px per hour of work\nfunction projectHasDates(path) {\n  const page = dv.page(path);\n  return !!page && page.file.tasks.where(t => !t.completed && /[🛫⏳📅] \\d{4}-\\d{2}-\\d{2}/u.test(t.text)).length > 0;\n}\n// Sequence or Calendar is kept in the project note (gantt_mode), so every device shows the same\nconst timeModeOf = path => { const m = String(dv.page(path)?.gantt_mode ?? \"\").toLowerCase(); return [\"sequence\", \"calendar\"].includes(m) ? m : ui.timeMode?.[path] ?? (projectHasDates(path) ? \"calendar\" : \"sequence\"); };\nfunction sequence(rows) {\n  const ids = new Map();\n  for (const r of rows) { const id = r.raw.match(/🆔 ([\\w-]+)/u)?.[1] ?? parseFields(r.raw).id; if (id) ids.set(id, r); }\n  const blockers = r => (r.raw.match(/⛔ ([\\w,-]+)/u)?.[1] ?? parseFields(r.raw).dependsOn ?? \"\").split(\",\").map(x => x.trim()).filter(Boolean).map(id => ids.get(id)).filter(Boolean);\n  const place = (list, from, parallel) => {\n    let cursor = from, end = from, prev = null;\n    for (const r of list) {\n      if (r.settled || (r.done && !r.kids.length)) { r.h0 = r.h1 = undefined; continue; } // done work is off the axis\n      let s0 = parallel ? from : withPrev(r) && prev ? prev.h0 : cursor;\n      r.prev = prev;\n      for (const b of blockers(r)) if (b.h1 !== undefined && b.h1 > s0) s0 = b.h1;\n      if (r.kids.length) {\n        const span = place(r.kids, s0, (parseFields(r.raw).mode ?? \"\").toLowerCase() === \"parallel\");\n        Object.assign(r, { h0: s0, h1: span.end, parent: true });\n      } else Object.assign(r, { h0: s0, h1: s0 + r.estUsed });\n      if (!parallel) cursor = Math.max(cursor, r.h1);\n      end = Math.max(end, r.h1);\n      prev = r;\n    }\n    return { end };\n  };\n  return place(rows.filter(r => r.depth === 0), 0, false).end;\n}\nfunction seqGantt(host, path, heading, rows, showHeading) {\n  const total = sequence(rows);\n  const vis = visibleRows(rows, path);\n  const PXH = (SEQ_ZOOM[ui.zoom] ?? SEQ_ZOOM.day) / 60, ROW = 26, LABEL = labelWidth(); // px per minute\n  const W = Math.max(300, (total + 120) * PXH);\n  const box = host.createEl(\"div\", { cls: \"pg-box\", attr: { style: `--area:${areaColour(path)}` } });\n  if (showHeading) box.createEl(\"div\", { text: heading, cls: \"pg-head\" });\n  const wrap = box.createEl(\"div\", { cls: \"pg-wrap\" });\n  const labels = wrap.createEl(\"div\", { cls: \"pg-labels\", attr: { style: `width:${LABEL}px` } });\n  splitter(wrap, labels);\n  const scroller = wrap.createEl(\"div\", { cls: \"pg-scroll\" });\n  const plot = scroller.createEl(\"div\", { cls: \"pg-plot\", attr: { style: `width:${W}px;height:${36 + vis.length * ROW}px` } });\n  labels.createEl(\"div\", { cls: \"pg-axis-pad\" });\n  // axis: hours of work left, with a band per work day (HOURS_PER_DAY hours)\n  const step = ui.zoom === \"day\" ? 60 : ui.zoom === \"week\" ? 240 : 480;\n  const dayMin = HOURS_PER_DAY * 60;\n  for (let d = 0; d * dayMin < total + 120; d++) {\n    if (d % 2) plot.createEl(\"div\", { cls: \"pg-weekend\", attr: { style: `left:${d * dayMin * PXH}px;width:${dayMin * PXH}px` } });\n    plot.createEl(\"div\", { cls: \"pg-month\", text: `work day ${d + 1}`, attr: { style: `left:${d * dayMin * PXH}px` } });\n  }\n  for (let m = 0; m <= total + 120; m += step) plot.createEl(\"div\", { cls: \"pg-tick is-week\", text: fmtEst(m), attr: { style: `left:${m * PXH}px` } });\n  vis.forEach((r, i) => {\n    const top = 36 + i * ROW;\n    labelRow(labels, r, i, path, ROW, { grip: lab => { const g = lab.createEl(\"span\", { cls: \"pg-move\", text: \"⋮⋮\", attr: { title: \"Drag up or down to move this step (and its sub-steps) in the note\" } }); dragRow(g, r, vis, labels, ROW, \"row\"); } });\n    plotRow(plot, r, top, ROW);\n    if (withPrev(r) && r.h0 !== undefined) plot.createEl(\"div\", { cls: \"pg-with\", text: \"∥\", attr: { style: `top:${top + 4}px;left:${Math.max(0, r.h0 * PXH - 12)}px`, title: \"Runs side by side with the step above\" } });\n    if (r.kids.length) {\n      if (r.settled || r.h0 === undefined) return;\n      const folded = isFolded(path, r);\n      const ticks = folded ? leavesOf(r).filter(l => !l.done && l.h0 !== undefined && !l.noEst).map(l => l.h0 * PXH + 2) : [];\n      const b = bracket(plot, r, top, r.h0 * PXH, r.h1 * PXH, ticks);\n      const doneMin = r.estDone, leftMin = Math.max(0, r.estAll - r.estDone);\n      b.title += `\\ndone ${fmtEst(doneMin)} · left ${fmtEst(leftMin)}`;\n      b.style.cursor = \"grab\"; dragRow(b, r, vis, labels, ROW, \"bar\", PXH);\n      return;\n    }\n    if (r.done) return; // done work is off the axis; the row says when (and how long it took)\n    if (r.noEst) { noEstimate(plot, r, top, r.h0 * PXH, path); return; }\n    const len = r.h1 - r.h0;\n    const bar = plot.createEl(\"div\", { cls: `pg-bar${r.guess ? \" is-inferred\" : \"\"}${r.blockedBy?.length ? \" is-blocked\" : \"\"}`, attr: { \"data-key\": `${r.line}`, style: `top:${top + 5}px;left:${r.h0 * PXH}px;width:${Math.max(6, len * PXH)}px;height:16px` } });\n    bar.title = `${clean(r.raw)}\\n${r.guess ? `No estimate yet: counted as the default ${fmtEst(DEFAULT_EST)} (dashed)` : `Estimate ${fmtEst(len)}`}\\nDrag the right edge to ${r.guess ? \"set\" : \"change\"} the estimate`;\n    bar.title += r.prev ? \"\\nDrag left onto the start of the step above to run side by side; drag right to run after it. Drag up or down to move it.\" : \"\\nDrag up or down to move it.\";\n    const egrip = bar.createEl(\"div\", { cls: \"pg-grip\", attr: { title: \"Drag to change the estimate\" } });\n    dragEst(egrip, bar, r, PXH);\n    linkHandle(bar, r, plot);\n    dragRow(bar, r, vis, labels, ROW, \"bar\", PXH);\n  });\n  const open = rows.filter(r => !r.kids.length && !r.done && !isRecur(r)), done = rows.filter(r => !r.kids.length && r.done && !isRecur(r));\n  const pdue = projectDue(path);\n  const left = open.reduce((s, r) => s + r.estUsed, 0), doneMin = done.reduce((s, r) => s + (r.est ?? r.took ?? 0), 0), noEst = open.filter(r => r.guess).length;\n  box.createEl(\"div\", { cls: \"pg-legend\", attr: { style: \"padding:2px 8px 4px\" }, text: `Done ${fmtEst(doneMin)} · left ${fmtEst(left)}, about ${Math.max(1, Math.ceil(left / dayMin))} work day${Math.ceil(left / dayMin) === 1 ? \"\" : \"s\"} at ${HOURS_PER_DAY}h a day${noEst ? `; ${noEst} step${noEst === 1 ? \"\" : \"s\"} without an estimate counted at the default ${fmtEst(DEFAULT_EST)} (dashed)` : \"\"}.${pdue ? ` Project due ${dmy(pdue)}: ${(n => n < 0 ? `${-n} days over` : `${n} day${n === 1 ? \"\" : \"s\"} left${Math.ceil(left / dayMin) > n ? \", fewer than the work days needed\" : \"\"}`)(diffDays(TODAY, pdue))}.` : \"\"}` });\n  depArrows(plot, vis, r => (r.h0 !== undefined && !r.done && !r.noEst && !r.kids.length ? { x0: r.h0 * PXH, x1: r.h1 * PXH } : null), ROW);\n  const sk = `seq:${path}#${heading}`;\n  requestAnimationFrame(() => { scroller.scrollLeft = KEEP.scroll[sk] ?? 0; });\n  scroller.addEventListener(\"scroll\", () => { KEEP.scroll[sk] = scroller.scrollLeft; });\n}\n// Move a step (with its sub-steps) to another place in the outline, or line it up with the step above.\n// Up/down: drops it before the step it is over, at that step's indent (so it can become a sub-step), or after the\n// last step when dropped below them all. Left/right (bars only): start of the step above = side by side.\nfunction dragRow(el, r, rows, labels, ROW, kind, PXH = 0) {\n  el.addEventListener(\"touchmove\", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });\n  el.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0 || ev.target.classList.contains(\"pg-grip\")) return;\n    ev.stopPropagation();\n    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === \"touch\" };\n    el._drag = d;\n    const bar = kind === \"bar\" ? el : null, left0 = bar?.offsetLeft ?? 0, top0 = bar?.offsetTop ?? 0;\n    const begin = () => { d.active = true; (bar ?? el.parentElement).classList.add(\"is-dragging\"); };\n    if (d.touch) d.timer = setTimeout(begin, 300);\n    const box = labels.getBoundingClientRect();\n    const z = ZM(), rowAt = y => Math.floor(((y - box.top) / z - 36) / ROW);\n    let marker = null;\n    const move = e => {\n      const dx = (e.clientX - d.x0) / z, dy = (e.clientY - d.y0) / z;\n      if (!d.active) { if (d.touch) { if (Math.hypot(dx, dy) > 8) end(null); return; } if (Math.hypot(dx, dy) < 5) return; begin(); }\n      d.vertical = Math.abs(dy) > Math.abs(dx) || kind === \"row\";\n      marker?.remove(); marker = null;\n      if (d.vertical) {\n        const at = Math.max(0, Math.min(rows.length, rowAt(e.clientY + (ROW * z) / 2)));\n        d.target = at;\n        marker = labels.createEl(\"div\", { cls: \"pg-drop\", attr: { style: `top:${36 + at * ROW - 1}px` } });\n        if (bar) { bar.style.left = `${left0}px`; bar.style.top = `${top0 + dy}px`; }\n      } else if (bar && PXH) {\n        const x = left0 + dx;\n        d.side = r.prev && !r.parent ? Math.abs(x - r.prev.h0 * PXH) < Math.abs(x - r.prev.h1 * PXH) : null;\n        if (d.side !== null) bar.style.left = `${(d.side ? r.prev.h0 : r.prev.h1) * PXH}px`;\n        bar.style.top = `${top0}px`;\n      }\n    };\n    const end = async (e) => {\n      clearTimeout(d.timer); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel);\n      el._drag = null; marker?.remove();\n      const reset = () => { (bar ?? el.parentElement).classList.remove(\"is-dragging\"); if (bar) { bar.style.left = `${left0}px`; bar.style.top = `${top0}px`; } };\n      if (!d.active || !e) return reset();\n      if (d.vertical) {\n        const target = rows[d.target] ?? null, i = rows.indexOf(r);\n        if (d.target === i || d.target === i + 1 + countDesc(r)) return reset();\n        if (await moveBlock(r, target, rows)) redraw(); else reset();\n      } else if (d.side !== null && d.side !== undefined && d.side !== withPrev(r)) {\n        if (await writeLine(r, line => d.side ? setField(line, \"with\", \"previous\") : setField(line, \"with\", null))) redraw(); else reset();\n      } else reset();\n    };\n    const up = e => void end(e), cancel = () => void end(null);\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", cancel);\n  });\n}\nconst countDesc = r => r.kids.reduce((n, k) => n + 1 + countDesc(k), 0);\nfunction setField(line, key, val) {\n  const re = new RegExp(`\\\\s*\\\\[${key}::[^\\\\]]*\\\\]`);\n  const out = line.replace(re, \"\");\n  if (val === null) return out;\n  const m = out.match(/\\s(?:[🔺⏫🔼🔽⏬🔁➕⏳🛫📅✅❌🆔⛔]|\\^[\\w-]+\\s*$)/u);\n  return m ? `${out.slice(0, m.index)} [${key}:: ${val}]${out.slice(m.index)}` : `${out.trimEnd()} [${key}:: ${val}]`;\n}\n// Cut the task's line and every more-indented line under it, and paste it before `target` at target's indent\n// (or after the last step of this chart when target is null).\nasync function moveBlock(r, target, rows) {\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) return false;\n  let ok = false;\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    const a = findLine(L, r);\n    if (a < 0) return data;\n    const ind = l => l.match(/^\\s*/)[0].replace(/ {4}/g, \"\\t\").length;\n    const base = ind(L[a]);\n    let b = a + 1;\n    while (b < L.length && L[b].trim() !== \"\" && ind(L[b]) > base) b++;\n    const block = L.slice(a, b);\n    let t, newIndent;\n    if (target) {\n      const ti = findLine(L, target);\n      if (ti < 0 || (ti >= a && ti < b)) return data; // not into itself\n      t = ti; newIndent = L[ti].match(/^\\s*/)[0];\n    } else {\n      const last = rows[rows.length - 1], li = findLine(L, last);\n      if (li < 0 || (li >= a && li < b)) return data;\n      t = li + 1;\n      while (t < L.length && L[t].trim() !== \"\" && ind(L[t]) > ind(L[li])) t++;\n      newIndent = rows.find(x => x.depth === 0) ? L[findLine(L, rows.find(x => x.depth === 0))].match(/^\\s*/)[0] : \"\";\n    }\n    const oldIndent = L[a].match(/^\\s*/)[0];\n    const moved = block.map(l => newIndent + l.slice(Math.min(oldIndent.length, l.match(/^\\s*/)[0].length)));\n    L.splice(a, b - a);\n    const at = t > a ? t - (b - a) : t;\n    L.splice(at, 0, ...moved);\n    ok = true;\n    return L.join(\"\\n\");\n  });\n  if (!ok) notify(\"Could not move that step. Reopen this page to refresh.\");\n  return ok;\n}\n\n// Replace [est::], or put it before the first Tasks emoji field so the Tasks plugin still reads the line.\nfunction setEst(line, val) {\n  if (/\\[est::[^\\]]*\\]/.test(line)) return line.replace(/\\[est::[^\\]]*\\]/, `[est:: ${val}]`);\n  const m = line.match(/\\s(?:[🔺⏫🔼🔽⏬🔁➕⏳🛫📅✅❌🆔⛔]|\\^[\\w-]+\\s*$)/u);\n  return m ? `${line.slice(0, m.index)} [est:: ${val}]${line.slice(m.index)}` : `${line.trimEnd()} [est:: ${val}]`;\n}\n// Drag a bar's right edge to set its [est::] in 15 minute steps (phone: press and hold first).\nfunction dragEst(grip, bar, r, PXH) {\n  grip.addEventListener(\"touchmove\", ev => { if (grip._drag?.active) ev.preventDefault(); }, { passive: false });\n  grip.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0) return;\n    ev.stopPropagation();\n    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === \"touch\" }, w0 = bar.offsetWidth;\n    grip._drag = d;\n    const len0 = r.h1 - r.h0;\n    const begin = () => { d.active = true; bar.classList.add(\"is-dragging\"); };\n    if (d.touch) d.timer = setTimeout(begin, 300);\n    const minutes = e => Math.max(15, Math.round((len0 + (e.clientX - d.x0) / ZM() / PXH) / 15) * 15);\n    const move = e => {\n      if (!d.active) { if (d.touch) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) end(null); return; } if (Math.abs(e.clientX - d.x0) < 4) return; begin(); }\n      d.min = minutes(e); bar.style.width = `${d.min * PXH}px`; bar.title = `Estimate ${fmtEst(d.min)}`;\n    };\n    const end = async (e) => {\n      clearTimeout(d.timer); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel);\n      grip._drag = null;\n      if (!d.active || !e || !d.min || d.min === len0) { bar.classList.remove(\"is-dragging\"); bar.style.width = `${w0}px`; return; }\n      const val = fmtEst(d.min);\n      if (await writeLine(r, line => setEst(line, val))) redraw();\n    };\n    const up = e => void end(e), cancel = () => void end(null);\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", cancel);\n  });\n}\n\n// Drag a bar sideways to move it (keeps its length), or its right edge to change the end. Mouse: press and move.\n// Phone: press and hold, then move. Writes ⏳ for one day, or 🛫 and ⏳ for several; never changes a 📅 deadline.\nfunction dragBar(el, r, kind, PX) {\n  el.addEventListener(\"touchmove\", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });\n  el.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0 || (kind === \"move\" && ev.target.classList.contains(\"pg-grip\"))) return;\n    ev.stopPropagation();\n    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === \"touch\", delta: 0 };\n    el._drag = d;\n    const bar = kind === \"end\" ? el.parentElement : el, left0 = bar.offsetLeft, w0 = bar.offsetWidth;\n    const begin = () => { d.active = true; bar.classList.add(\"is-dragging\"); };\n    if (d.touch) d.timer = setTimeout(begin, 300);\n    const move = e => {\n      const dx = (e.clientX - d.x0) / ZM();\n      if (!d.active) { if (d.touch) { if (Math.hypot(dx, e.clientY - d.y0) > 8) end(false); return; } if (Math.abs(dx) < 4) return; begin(); }\n      d.delta = Math.round(dx / PX);\n      if (kind === \"move\") bar.style.left = `${left0 + d.delta * PX}px`; else bar.style.width = `${Math.max(PX, w0 + d.delta * PX)}px`;\n      bar.title = kind === \"move\" ? `${dmy(addDays(r.s, d.delta))} to ${dmy(addDays(r.e, d.delta))}` : `ends ${dmy(addDays(r.e, d.delta))}`;\n    };\n    const end = async (commit = true) => {\n      clearTimeout(d.timer); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel);\n      el._drag = null;\n      if (!d.active || !commit || !d.delta) { bar.classList.remove(\"is-dragging\"); bar.style.left = `${left0}px`; bar.style.width = `${w0}px`; return; }\n      const s = kind === \"move\" ? addDays(r.s, d.delta) : r.s, e2 = kind === \"move\" ? addDays(r.e, d.delta) : addDays(r.e, d.delta) < r.s ? r.s : addDays(r.e, d.delta);\n      const useSched = !r.hasStart && /⏳/u.test(r.raw);\n      // a task the planner spread over days (🛫 to a later ⏳) keeps that form, so the planner and the chart agree\n      const spread = r.hasStart && (r.raw.match(/⏳ (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? \"\") > (r.raw.match(/🛫 (\\d{4}-\\d{2}-\\d{2})/u)?.[1] ?? \"9\");\n      // Dragging plans, it never moves a deadline: one day writes ⏳, several days 🛫 first day and ⏳ last day\n      // (the planner's form for a task spread over days). 📅 stays as it was.\n      void spread; void useSched;\n      const own = line => (s === e2 ? setDate(setDate(line, \"🛫\", null), \"⏳\", s) : setDate(setDate(line, \"🛫\", s), \"⏳\", e2));\n      if (await moveWithChain(r, own, s, diffDays(r.e, e2), e2)) redraw(); else { bar.classList.remove(\"is-dragging\"); bar.style.left = `${left0}px`; bar.style.width = `${w0}px`; }\n    };\n    const up = () => void end(true), cancel = () => void end(false);\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", cancel);\n  });\n}\n\n// Drag a parent bar sideways: the step and every open sub-step under it move by the same number of days.\n// Planned dates (🛫 ⏳) shift; 📅 deadlines stay. A parent without its own start gets 🛫 so undated sub-steps follow it.\n// Changing several tasks asks first (count and list) and can be undone (shared Undo with the planner).\nconst shiftDate = (line, emoji, n) => line.replace(new RegExp(`${emoji} (\\\\d{4}-\\\\d{2}-\\\\d{2})`, \"u\"), (m, d) => `${emoji} ${addDays(d, n)}`);\nconst descendants = r => r.kids.flatMap(k => [k, ...descendants(k)]);\nconst UNDO_KEY = \"compass-proto-planner-undo\"; // the planner's key, so its Undo bar covers this too\nconst loadUndo = () => { try { return JSON.parse(localStorage.getItem(UNDO_KEY) || \"null\"); } catch (e) { return null; } };\nfunction confirmBox(title, lines, yesText) {\n  return new Promise(resolve => {\n    const back = document.body.createEl(\"div\", { attr: { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" } });\n    const card = back.createEl(\"div\", { attr: { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" } });\n    card.createEl(\"div\", { text: `${title}?`, attr: { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" } });\n    const ul = card.createEl(\"ul\", { attr: { style: \"max-height:45vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px\" } });\n    for (const l of lines) ul.createEl(\"li\", { text: l });\n    card.createEl(\"div\", { text: \"You can undo this afterwards with Undo above the chart.\", attr: { style: \"color:var(--text-muted);font-size:12px;margin:6px 0 10px\" } });\n    const row = card.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;justify-content:flex-end\" } });\n    const no = row.createEl(\"button\", { text: \"Cancel\" }), yes = row.createEl(\"button\", { text: yesText, cls: \"mod-cta\" });\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(false); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(false)); yes.addEventListener(\"click\", () => done(true));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(false); });\n    yes.focus();\n  });\n}\nasync function moveGroup(r, n) {\n  const list = [r, ...descendants(r)].filter(x => !x.done);\n  const fnFor = x => line => { let next = shiftPlan(line, n); if (x === r && !/[🛫⏳] \\d{4}-\\d{2}-\\d{2}/u.test(line)) next = setDate(next, \"🛫\", addDays(x.s, n)); return next; };\n  const plan = list.map(x => ({ x, fn: fnFor(x) })).filter(c => c.fn(c.x.raw) !== c.x.raw);\n  const undated = list.filter(x => x !== r && !/[🛫⏳📅] \\d{4}-\\d{2}-\\d{2}/u.test(x.raw)).length;\n  if (!plan.length) return false;\n  const sign = n > 0 ? `+${n}` : `${n}`, days = `${sign} day${Math.abs(n) === 1 ? \"\" : \"s\"}`;\n  const lines = plan.map(({ x }) => `${x.num} ${clean(x.raw)}: ${dmy(x.s)} to ${dmy(addDays(x.s, n))}`);\n  if (undated) lines.push(`${undated} sub-step${undated === 1 ? \"\" : \"s\"} without dates follow along (nothing written)`);\n  if (!(await confirmBox(`Move \"${clean(r.raw)}\" and its sub-steps ${days}`, lines, `Move ${plan.length} task${plan.length === 1 ? \"\" : \"s\"}`))) return false;\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) return false;\n  const items = [];\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    for (const { x, fn } of plan) { const j = findLine(L, x); if (j < 0) continue; const next = fn(L[j]); if (next === L[j]) continue; items.push({ path: r.path, before: L[j], after: next }); L[j] = next; }\n    return L.join(\"\\n\");\n  });\n  if (items.length < plan.length) notify(`${plan.length - items.length} task${plan.length - items.length === 1 ? \"\" : \"s\"} had changed in the note and were left alone.`);\n  try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title: `Moved \"${clean(r.raw)}\" ${days}`, at: Date.now(), items })); } catch (e) {}\n  return items.length > 0;\n}\nasync function undoLast() {\n  const u = loadUndo();\n  if (!u?.items?.length) return;\n  let back = 0, changed = 0;\n  for (const [path, its] of Object.entries(u.items.reduce((m, it) => ((m[it.path] ??= []).push(it), m), {}))) {\n    const f = app.vault.getAbstractFileByPath(path);\n    if (!f) { changed += its.length; continue; }\n    await app.vault.process(f, data => {\n      const L = data.split(\"\\n\");\n      for (const it of its) { const i = L.indexOf(it.after); if (i < 0) { changed++; continue; } if (it.before === null) L.splice(i, 1); else L[i] = it.before; back++; }\n      return L.join(\"\\n\");\n    });\n  }\n  try { localStorage.removeItem(UNDO_KEY); } catch (e) {}\n  notify(`Undone: ${back} task${back === 1 ? \"\" : \"s\"} put back${changed ? `; ${changed} had changed since and were left alone` : \"\"}.`);\n}\nfunction dragGroup(el, r, PX) {\n  el.addEventListener(\"touchmove\", ev => { if (el._drag?.active) ev.preventDefault(); }, { passive: false });\n  el.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0) return;\n    ev.stopPropagation();\n    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === \"touch\", delta: 0 };\n    el._drag = d;\n    // the parent's sub-step bars travel with it while dragging\n    const plot = el.parentElement, mine = [el, ...descendants(r).map(k => plot.querySelector(`[data-key=\"${CSS.escape(`${k.line}`)}\"]`)).filter(Boolean)];\n    const left0 = mine.map(b => b.offsetLeft);\n    const begin = () => { d.active = true; mine.forEach(b => b.classList.add(\"is-dragging\")); };\n    if (d.touch) d.timer = setTimeout(begin, 300);\n    const move = e => {\n      const dx = (e.clientX - d.x0) / ZM();\n      if (!d.active) { if (d.touch) { if (Math.hypot(dx, e.clientY - d.y0) > 8) end(false); return; } if (Math.abs(dx) < 4) return; begin(); }\n      d.delta = Math.round(dx / PX);\n      mine.forEach((b, i) => { b.style.left = `${left0[i] + d.delta * PX}px`; });\n      el.title = `${dmy(addDays(r.s, d.delta))} to ${dmy(addDays(r.e, d.delta))}`;\n    };\n    const reset = () => mine.forEach((b, i) => { b.classList.remove(\"is-dragging\"); b.style.left = `${left0[i]}px`; });\n    const end = async (commit = true) => {\n      clearTimeout(d.timer); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel);\n      el._drag = null;\n      if (!d.active || !commit || !d.delta) return reset();\n      if (await moveGroup(r, d.delta)) redraw(); else reset();\n    };\n    const up = () => void end(true), cancel = () => void end(false);\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", cancel);\n  });\n}\n\n// ---------- chains and links (ideas from Operon, 28-10-2026) ----------\n// Moving a step can carry the steps after it: its later siblings (the steps that follow it in the outline) and the\n// steps that wait for it (⛔ its 🆔), all by the same number of days. Only 🛫 and ⏳ shift; 📅 deadlines never move.\n// Undated steps follow by themselves. If the step now starts before a parent's own 🛫, the parent's 🛫 can widen to\n// fit. Everything asks first, and Undo above the chart puts it back.\nconst idOf = r => r.raw.match(/🆔 ([\\w-]+)/u)?.[1] ?? null;\nconst depsOf = r => (r.raw.match(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u)?.[1] ?? \"\").split(/\\s*,\\s*/).filter(Boolean);\nconst shiftPlan = (line, n) => [\"🛫\", \"⏳\"].reduce((l, e) => shiftDate(l, e, n), line);\nconst hasPlanDate = r => /[🛫⏳] \\d{4}-\\d{2}-\\d{2}/u.test(r.raw);\nfunction followers(r, n, { sib, dep }) {\n  const rows = r.chart ?? [], moved = new Set([r]), open = x => !isDoneLine(x.raw);\n  const add = x => { if (moved.has(x) || !open(x)) return false; moved.add(x); for (const k of descendants(x)) if (open(k)) moved.add(k); return true; };\n  const why = new Map();\n  if (sib) {\n    // later siblings of the step and of each of its parents: everything after it in the outline\n    for (let x = r; x; x = x.up) { const list = x.up ? x.up.kids : rows.filter(y => y.depth === 0); for (const y of list.slice(list.indexOf(x) + 1)) if (add(y)) why.set(y, \"later step\"); }\n  }\n  if (dep) {\n    let grew = true;\n    while (grew) {\n      grew = false;\n      const ids = new Set([...moved].map(idOf).filter(Boolean));\n      for (const y of rows) if (!moved.has(y) && open(y) && depsOf(y).some(id => ids.has(id))) { add(y); why.set(y, \"waits for it (⛔)\"); grew = true; }\n    }\n  }\n  moved.delete(r);\n  return { list: [...moved], why };\n}\nasync function moveWithChain(r, ownFn, newStart, n, newEnd = null) {\n  const C = (ui.chain ??= { sib: true, dep: true, widen: true });\n  // a parent with its own 🛫 later than the step's new start can widen (idea 9; never touches 📅 or the project's due)\n  const widen = [];\n  for (let p = r.up; p; p = p.up) { const st = p.raw.match(/🛫 (\\d{4}-\\d{2}-\\d{2})/u)?.[1]; if (st && newStart < st) widen.push(p); }\n  const fAll = n ? followers(r, n, { sib: true, dep: true }) : { list: [], why: new Map() };\n  const dated = fAll.list.filter(hasPlanDate);\n  if (!dated.length && !widen.length) return writeLine(r, ownFn);\n  const days = `${n > 0 ? \"+\" : \"\"}${n} day${Math.abs(n) === 1 ? \"\" : \"s\"}`;\n  const choice = await new Promise(resolve => {\n    const back = document.body.createEl(\"div\", { cls: \"pg-chain-back\", attr: { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" } });\n    const card = back.createEl(\"div\", { attr: { style: \"background:var(--background-primary);color:var(--text-normal);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:560px;width:100%;padding:14px 16px;box-shadow:var(--shadow-l)\" } });\n    card.createEl(\"div\", { text: `Move \"${clean(r.raw)}\"${n ? ` ${days}` : \"\"}`, attr: { style: \"font-weight:600;font-size:15px;margin-bottom:6px\" } });\n    const st = { ...C };\n    const listEl = card.createEl(\"ul\", { attr: { style: \"max-height:40vh;overflow:auto;font-size:12px;margin:4px 0;padding-left:18px\" } });\n    const box = (key, text, count) => { if (!count) return; const l = card.createEl(\"label\", { attr: { style: \"display:flex;gap:6px;align-items:center;font-size:13px;margin:4px 0\" } }); const i = l.createEl(\"input\", { type: \"checkbox\" }); i.checked = !!st[key]; l.appendText(text); i.addEventListener(\"change\", () => { st[key] = i.checked; paint(); }); listEl.before(l); };\n    const nSib = followers(r, n, { sib: true, dep: false }).list.filter(hasPlanDate).length, nDep = followers(r, n, { sib: false, dep: true }).list.filter(hasPlanDate).length;\n    box(\"sib\", ` Also move the later steps ${days} (${nSib} with dates)`, n && nSib);\n    box(\"dep\", ` Also move the steps that wait for it, ⛔ (${nDep} with dates)`, n && nDep);\n    box(\"widen\", ` Widen ${widen.length === 1 ? `\"${clean(widen[0].raw)}\"` : `${widen.length} parent steps`} to start ${dmy(newStart)} (🛫)`, widen.length);\n    const paint = () => {\n      listEl.empty();\n      listEl.createEl(\"li\", { text: `${r.num} ${clean(r.raw)}: ${dmy(newStart)}${newEnd && newEnd !== newStart ? ` to ${dmy(newEnd)}` : \"\"} (this step)` });\n      const f = n ? followers(r, n, st) : { list: [], why: new Map() };\n      for (const y of f.list.filter(hasPlanDate)) { const d0 = y.raw.match(/[🛫⏳] (\\d{4}-\\d{2}-\\d{2})/u)[1]; listEl.createEl(\"li\", { text: `${y.num} ${clean(y.raw)}: ${dmy(d0)} to ${dmy(addDays(d0, n))} (${f.why.get(y) ?? \"inside a later step\"})` }); }\n      const und = f.list.filter(y => !hasPlanDate(y)).length;\n      if (und) listEl.createEl(\"li\", { text: `${und} step${und === 1 ? \"\" : \"s\"} without dates follow along (nothing written)`, attr: { style: \"color:var(--text-muted)\" } });\n      if (st.widen) for (const p of widen) listEl.createEl(\"li\", { text: `${p.num} ${clean(p.raw)}: start ${dmy(p.raw.match(/🛫 (\\d{4}-\\d{2}-\\d{2})/u)[1])} to ${dmy(newStart)}` });\n    };\n    paint();\n    card.createEl(\"div\", { text: \"Only 🛫 and ⏳ change; 📅 deadlines stay. You can undo this with Undo above the chart.\", attr: { style: \"color:var(--text-muted);font-size:12px;margin:6px 0 10px\" } });\n    const row = card.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap\" } });\n    const no = row.createEl(\"button\", { text: \"Cancel\" }), only = row.createEl(\"button\", { text: \"Only this step\" }), yes = row.createEl(\"button\", { text: \"Move\", cls: \"mod-cta\" });\n    const done = v => { document.removeEventListener(\"keydown\", key, true); back.remove(); resolve(v); };\n    const key = e => { if (e.key === \"Escape\") { e.stopPropagation(); done(null); } };\n    document.addEventListener(\"keydown\", key, true);\n    no.addEventListener(\"click\", () => done(null)); only.addEventListener(\"click\", () => done({ sib: false, dep: false, widen: false })); yes.addEventListener(\"click\", () => done(st));\n    back.addEventListener(\"click\", e => { if (e.target === back) done(null); });\n    yes.focus();\n  });\n  if (!choice) return false;\n  Object.assign(C, choice); saveUi();\n  const plan = [{ x: r, fn: ownFn }];\n  if (n) for (const y of followers(r, n, choice).list.filter(hasPlanDate)) plan.push({ x: y, fn: line => shiftPlan(line, n) });\n  if (choice.widen) for (const p of widen) plan.push({ x: p, fn: line => setDate(line, \"🛫\", newStart) });\n  return applyPlan(r.path, plan, `Moved \"${clean(r.raw)}\"${plan.length > 1 ? ` and ${plan.length - 1} more` : \"\"}`);\n}\n// several line edits in one note, in one write, with the shared Undo\nasync function applyPlan(path, plan, title) {\n  const f = app.vault.getAbstractFileByPath(path);\n  if (!f) return false;\n  const items = [];\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    for (const { x, fn } of plan) { const j = findLine(L, x); if (j < 0) continue; const next = fn(L[j]); if (next === L[j]) continue; items.push({ path, before: L[j], after: next }); L[j] = next; }\n    return L.join(\"\\n\");\n  });\n  if (items.length < plan.length) notify(`${plan.length - items.length} task${plan.length - items.length === 1 ? \"\" : \"s\"} had changed in the note (or needed no change) and were left alone.`);\n  if (items.length) try { localStorage.setItem(UNDO_KEY, JSON.stringify({ title, at: Date.now(), items })); } catch (e) {}\n  return items.length > 0;\n}\n// Drag from the dot at a bar's right end onto another bar: that step now waits for this one (writes 🆔 here, ⛔ there).\nconst newId = () => Math.random().toString(36).slice(2, 8).padEnd(6, \"0\");\nconst addSign = (line, emoji, val) => { const m = line.match(/\\s\\^[\\w-]+\\s*$/); return m ? `${line.slice(0, m.index)} ${emoji} ${val}${line.slice(m.index)}` : `${line.trimEnd()} ${emoji} ${val}`; };\nfunction linkHandle(bar, r, plot) {\n  const dot = bar.createEl(\"div\", { cls: \"pg-link\", attr: { title: \"Drag onto another step: that step then waits for this one (⛔)\" } });\n  dot.addEventListener(\"touchmove\", ev => { if (dot._drag?.active) ev.preventDefault(); }, { passive: false });\n  dot.addEventListener(\"pointerdown\", ev => {\n    if (ev.button > 0) return;\n    ev.stopPropagation(); ev.preventDefault();\n    const d = { x0: ev.clientX, y0: ev.clientY, active: false, touch: ev.pointerType === \"touch\" };\n    dot._drag = d;\n    const pr = plot.getBoundingClientRect(), b = bar.getBoundingClientRect();\n    const sx = b.right - pr.left, sy = b.top + b.height / 2 - pr.top;\n    let line = null, over = null;\n    const begin = () => { d.active = true; line = plot.createEl(\"div\", { cls: \"pg-linkline\" }); };\n    if (d.touch) d.timer = setTimeout(begin, 300); else begin();\n    const targetAt = e => { const el = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList?.contains(\"pg-bar\") && x !== bar && x.closest(\".pg-plot\") === plot); return el ? (r.chart ?? []).find(y => `${y.line}` === el.dataset.key) ?? null : null; };\n    const move = e => {\n      if (!d.active) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) end(null); return; }\n      const ex = e.clientX - pr.left, ey = e.clientY - pr.top, len = Math.hypot(ex - sx, ey - sy);\n      line.style.cssText = `left:${sx}px;top:${sy}px;width:${len}px;transform:rotate(${Math.atan2(ey - sy, ex - sx)}rad)`;\n      plot.querySelectorAll(\".pg-bar.is-linktarget\").forEach(x => x.classList.remove(\"is-linktarget\"));\n      over = targetAt(e);\n      if (over) plot.querySelector(`.pg-bar[data-key=\"${CSS.escape(`${over.line}`)}\"]`)?.classList.add(\"is-linktarget\");\n    };\n    const end = async e => {\n      clearTimeout(d.timer); document.removeEventListener(\"pointermove\", move); document.removeEventListener(\"pointerup\", up); document.removeEventListener(\"pointercancel\", cancel);\n      dot._drag = null; line?.remove(); plot.querySelectorAll(\".pg-bar.is-linktarget\").forEach(x => x.classList.remove(\"is-linktarget\"));\n      if (!d.active || !e || !over || over === r) return;\n      const id = idOf(r) ?? newId();\n      if (depsOf(over).includes(id)) return notify(\"That step already waits for this one.\");\n      if (idOf(over) && depsOf(r).includes(idOf(over))) return notify(\"This step already waits for that one; a step cannot wait for itself in a loop.\");\n      const plan = [];\n      if (!idOf(r)) plan.push({ x: r, fn: l => addSign(l, \"🆔\", id) });\n      plan.push({ x: over, fn: l => (/⛔ [\\w-]/u.test(l) ? l.replace(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u, (m, ids) => `⛔ ${ids},${id}`) : addSign(l, \"⛔\", id)) });\n      if (await applyPlan(r.path, plan, `Linked: \"${clean(over.raw)}\" waits for \"${clean(r.raw)}\"`)) { notify(`\"${clean(over.raw)}\" now waits for \"${clean(r.raw)}\". Undo is above the chart.`); redraw(); }\n    };\n    const up = e => void end(e), cancel = () => void end(null);\n    document.addEventListener(\"pointermove\", move); document.addEventListener(\"pointerup\", up); document.addEventListener(\"pointercancel\", cancel);\n  });\n}\n// Remove a link: takes the blocker's id off the waiting step's ⛔ (the whole ⛔ when it was the only one); the 🆔 on\n// the other step stays, it does nothing on its own. Undo above the chart puts it back.\nconst dropDep = (line, id) => line.replace(/\\s*⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u, (m, ids) => { const left = ids.split(/\\s*,\\s*/).filter(x => x !== id); return left.length ? ` ⛔ ${left.join(\",\")}` : \"\"; });\nfunction linkMenu(evt, r, ids) {\n  const plugin = app.plugins.plugins[\"ex3c-agenda\"];\n  const items = ids.map(id => ({ title: `Remove link: no longer waits for \"${OPEN_IDS.get(id) ?? id}\"`, icon: \"unlink\", run: async () => {\n    if (await applyPlan(r.path, [{ x: r, fn: l => dropDep(l, id) }], `Removed link: \"${clean(r.raw)}\" no longer waits for \"${OPEN_IDS.get(id) ?? id}\"`)) { notify(`\"${clean(r.raw)}\" no longer waits. Undo is above the chart.`); redraw(); }\n  } }));\n  items.push({ title: `Open \"${clean(r.raw)}\" in its note`, icon: \"file-text\", run: () => app.workspace.openLinkText(r.path, \"\", false, { eState: { line: r.line } }) });\n  if (plugin?.showMenu) plugin.showMenu(evt, items); else if (items.length > 1) void items[0].run();\n}\n// thin arrows from the end of a step to the start of each step that waits for it (same chart, both shown)\nfunction depArrows(plot, vis, span, ROW) {\n  const byId = new Map(); vis.forEach((r, i) => { const id = idOf(r); if (id) byId.set(id, i); });\n  const svg = document.createElementNS(\"http://www.w3.org/2000/svg\", \"svg\");\n  svg.setAttribute(\"class\", \"pg-deps\"); plot.appendChild(svg);\n  vis.forEach((r, i) => {\n    const to = span(r); if (!to) return;\n    for (const id of depsOf(r)) {\n      const j = byId.get(id); if (j === undefined) continue;\n      const from = span(vis[j]); if (!from) continue;\n      const x1 = from.x1, y1 = 36 + j * ROW + 13, x2 = to.x0, y2 = 36 + i * ROW + 13, mx = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10));\n      const p = document.createElementNS(\"http://www.w3.org/2000/svg\", \"path\");\n      p.setAttribute(\"d\", `M${x1},${y1} H${mx} V${y2} H${x2 - 2}`);\n      p.setAttribute(\"class\", x2 < x1 ? \"is-conflict\" : \"\");\n      // a wide invisible copy of the line takes the click: Remove link\n      const hit = document.createElementNS(\"http://www.w3.org/2000/svg\", \"path\");\n      hit.setAttribute(\"d\", p.getAttribute(\"d\")); hit.setAttribute(\"class\", \"pg-dep-hit\");\n      hit.addEventListener(\"click\", e => { e.stopPropagation(); linkMenu(e, r, [id]); });\n      svg.appendChild(hit);\n      const t = document.createElementNS(\"http://www.w3.org/2000/svg\", \"title\"); t.textContent = `${clean(r.raw)} waits for ${clean(vis[j].raw)}${x2 < x1 ? \" (but starts before it ends)\" : \"\"}`; p.appendChild(t);\n      svg.appendChild(p);\n    }\n  });\n}\n\n// ---------- page ----------\nlet redraw = () => {};\nif (input?.allProjects && files.length) {\n  const root = dv.container.createEl(\"div\", { cls: \"pg\" });\n  root.createEl(\"style\", { text: `\n.pg-pick { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }\n.pg-chip { font-size: 12px; padding: 2px 10px; border-radius: 12px; border: 1px solid var(--background-modifier-border); cursor: pointer; background: var(--background-primary); user-select: none; }\n.pg-chip.is-on { background: var(--interactive-accent); color: var(--text-on-accent); border-color: var(--interactive-accent); }\n.pg-tools { display: flex; gap: 6px; align-items: center; margin-left: auto; font-size: 12px; }\n.pg-proj { margin: 10px 0 16px; }\n.pg-proj-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }\n.pg-proj-head h4 { margin: 0; }\n.pg-seg { display: inline-flex; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }\n.pg-seg span { font-size: 11px; padding: 1px 8px; cursor: pointer; }\n.pg-seg span.is-on { background: var(--background-modifier-hover); font-weight: 600; }\n.pg-box { border: 1px solid var(--background-modifier-border); border-radius: 8px; margin: 6px 0; overflow: hidden; background: var(--background-primary); }\n.pg-head { font-weight: 600; font-size: 12px; padding: 4px 8px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary); }\n.pg-wrap { display: flex; }\n.pg-labels { flex-shrink: 0; border-right: 1px solid var(--background-modifier-border); font-size: 12px; }\n.pg-axis-pad { height: 36px; border-bottom: 1px solid var(--background-modifier-border); }\n.pg-label { display: flex; align-items: center; gap: 3px; white-space: nowrap; overflow: hidden; box-sizing: border-box; border-bottom: 1px solid var(--background-modifier-border-hover, transparent); }\n.pg-label input { margin: 0 2px 0 0; flex-shrink: 0; }\n.pg-label.is-done .pg-text { color: var(--text-faint); }\n.pg-num { color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }\n.pg-text { overflow: hidden; text-overflow: ellipsis; cursor: pointer; }\n.pg-scroll { overflow-x: auto; flex: 1; min-width: 0; }\n.pg-plot { position: relative; }\n.pg-month { position: absolute; top: 2px; font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; padding-left: 3px; border-left: 1px solid var(--background-modifier-border); }\n.pg-tick { position: absolute; top: 18px; height: 18px; font-size: 10px; color: var(--text-faint); text-align: center; border-bottom: 1px solid var(--background-modifier-border); box-sizing: border-box; }\n.pg-tick.is-week { width: auto; padding-left: 2px; border-left: 1px solid var(--background-modifier-border); }\n.pg-weekend { position: absolute; top: 18px; bottom: 0; background: var(--background-secondary); }\n.pg-today { position: absolute; top: 18px; bottom: 0; border-left: 2px solid var(--text-muted); z-index: 2; }\n.pg-tick.is-today { color: var(--text-normal); font-weight: 700; }\n.pg-row.is-band { background: color-mix(in srgb, var(--area) 6%, transparent); }\n.pg-label.is-band { background: color-mix(in srgb, var(--area) 6%, transparent); box-shadow: inset 3px 0 0 var(--area); }\n.pg-label.is-parent .pg-text { font-weight: 600; }\n.pg-chev { width: 12px; flex-shrink: 0; color: var(--text-muted); cursor: pointer; font-size: 10px; text-align: center; }\n.pg-meta { margin-left: auto; padding: 0 6px 0 8px; color: var(--text-muted); font-size: 11px; white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; }\n@media (max-width: 600px) { .pg-meta { display: none; } }\n.pg-bracket { position: absolute; height: 7px; z-index: 3; box-sizing: border-box; border: 2px solid var(--text-muted); border-top: none; border-radius: 0 0 2px 2px; cursor: grab; background: transparent; }\n.pg-bracket.is-nested { border-width: 1px; height: 5px; opacity: .8; }\n.pg-bracket-fill { position: absolute; left: 0; top: 0; bottom: 0; background: color-mix(in srgb, var(--text-muted) 55%, transparent); }\n.pg-tickmark { position: absolute; width: 2px; height: 5px; background: var(--text-muted); z-index: 3; }\n.pg-donetext { position: absolute; font-size: 11px; color: var(--text-faint); white-space: nowrap; z-index: 3; }\n.pg-check { position: absolute; font-size: 11px; color: var(--text-muted); z-index: 3; }\n.pg-noest { position: absolute; font-size: 11px; color: var(--text-muted); font-style: italic; white-space: nowrap; z-index: 3; cursor: pointer; }\n.pg-noest:hover { color: var(--text-accent); }\n.pg-row { position: absolute; left: 0; right: 0; border-bottom: 1px solid var(--background-modifier-border-hover, transparent); }\n.pg-bar { position: absolute; border-radius: 4px; background: var(--interactive-accent); z-index: 3; cursor: grab; touch-action: manipulation; box-sizing: border-box; }\n.pg-bar.is-parent { background: var(--text-muted); border-radius: 2px; cursor: default; }\n.pg-bar.is-parent.is-group { cursor: grab; height: 10px !important; }\n.pg-bar.is-parent.is-group:hover { background: var(--text-normal); }\n.pg-undo { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; padding: 4px 8px; margin-bottom: 6px; border-radius: 6px; background: var(--background-secondary); }\n.pg-bar.is-inferred { background: transparent; border: 2px dashed var(--interactive-accent); }\n.pg-bar.is-parent.is-inferred { border-color: var(--text-muted); border-width: 1px; }\n.pg-bar.is-done { background: var(--text-faint); opacity: .7; cursor: default; }\n.pg-bar.is-late { background: var(--color-red); border-color: var(--color-red); }\n.pg-bar.is-dragging { opacity: .7; box-shadow: 0 0 0 2px var(--text-accent); }\n.pg-grip { position: absolute; right: -2px; top: 0; bottom: 0; width: 9px; cursor: ew-resize; touch-action: none; }\n.pg-due { position: absolute; font-size: 12px; color: var(--color-red); z-index: 4; }\n.pg-pdue { position: absolute; top: 2px; bottom: 0; border-left: 2px dashed var(--color-red); z-index: 3; font-size: 11px; color: var(--color-red); padding-left: 2px; line-height: 1; }\n.pg-bar.is-pastdue { outline: 2px solid var(--color-orange); outline-offset: -2px; }\n.pg-pdue-chip { font-size: 12px; color: var(--text-muted); border: 1px solid var(--background-modifier-border); border-radius: 10px; padding: 0 8px; }\n.pg-pdue-chip.is-over { color: var(--color-red); border-color: var(--color-red); }\n.pg-move { cursor: grab; color: var(--text-faint); padding: 0 3px 0 0; touch-action: none; user-select: none; flex-shrink: 0; font-size: 11px; letter-spacing: -2px; }\n.pg-move:hover { color: var(--text-accent); }\n.pg-label.is-dragging { background: var(--background-modifier-hover); }\n.pg-labels { position: relative; }\n.pg-split { flex: 0 0 10px; margin: 0 -5px; position: relative; z-index: 6; cursor: col-resize; touch-action: none; user-select: none; -webkit-user-select: none; }\n.pg-split::after { content: \"\"; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: transparent; transition: background .1s; }\n.pg-split:hover::after, .pg-split.is-dragging::after { background: var(--interactive-accent); }\n@media (hover: none) { .pg-split { flex-basis: 18px; margin: 0 -9px; } .pg-split::after { left: 8px; background: var(--background-modifier-border); } }\n.pg-drop { position: absolute; left: 0; right: 0; height: 0; border-top: 2px solid var(--interactive-accent); z-index: 5; pointer-events: none; }\n.pg-with { position: absolute; font-size: 11px; color: var(--text-accent); z-index: 4; }\n.pg-blocked { color: var(--color-red); font-size: 11px; flex-shrink: 0; cursor: pointer; }\n.pg-bar.is-blocked { background-image: repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in srgb, var(--background-primary) 55%, transparent) 4px 7px); }\n.pg-sum { font-size: 12px; color: var(--text-muted); }\n.pg-link { position: absolute; right: -11px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--background-primary); border: 2px solid var(--text-accent); cursor: crosshair; touch-action: none; opacity: 0; z-index: 5; }\n.pg-bar:hover .pg-link, .pg-link:active { opacity: 1; }\n@media (hover: none) { .pg-link { opacity: .8; } }\n.pg-linkline { position: absolute; height: 0; border-top: 2px dashed var(--text-accent); transform-origin: 0 0; z-index: 6; pointer-events: none; }\n.pg-bar.is-linktarget { box-shadow: 0 0 0 2px var(--text-accent); }\n.pg-deps { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2; overflow: visible; }\n.pg-deps path { fill: none; stroke: var(--text-muted); stroke-width: 1.2; marker-end: none; }\n.pg-deps path.pg-dep-hit { stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: pointer; }\n.pg-deps path.pg-dep-hit:hover { stroke: color-mix(in srgb, var(--text-accent) 30%, transparent); }\n.pg-deps path.is-conflict { stroke: var(--color-red); stroke-dasharray: 3 2; }\n.pg-legend { font-size: 11px; color: var(--text-muted); margin-top: 2px; }\n` });\n  const pick = root.createEl(\"div\", { cls: \"pg-pick\" });\n  const body = root.createEl(\"div\");\n  if (!Array.isArray(ui.selected)) ui.selected = files.slice(0, 1);\n  ui.selected = ui.selected.filter(p => files.includes(p));\n  if (!ui.selected.length) ui.selected = files.slice(0, 1);\n  const undoBar = root.createEl(\"div\");\n  pick.before(undoBar);\n  redraw = () => {\n    pick.empty(); body.empty(); undoBar.empty();\n    const u = loadUndo();\n    if (u?.items?.length && Date.now() - u.at < 86400000) {\n      const ub = undoBar.createEl(\"div\", { cls: \"pg-undo\" });\n      ub.createEl(\"span\", { text: `Last change: ${u.title} (${u.items.length} task${u.items.length === 1 ? \"\" : \"s\"}).` });\n      const b = ub.createEl(\"button\", { text: \"Undo\", cls: \"mod-warning\" });\n      b.addEventListener(\"click\", async () => { b.disabled = true; await undoLast(); redraw(); });\n      const hide = ub.createEl(\"span\", { text: \"hide\", attr: { style: \"cursor:pointer;text-decoration:underline;color:var(--text-muted)\" } });\n      hide.addEventListener(\"click\", () => { try { localStorage.removeItem(UNDO_KEY); } catch (e) {} redraw(); });\n    }\n    pick.createEl(\"span\", { text: \"Projects:\", attr: { style: \"font-size:12px;color:var(--text-muted)\" } });\n    for (const p of files) {\n      const c = pick.createEl(\"span\", { cls: `pg-chip${ui.selected.includes(p) ? \" is-on\" : \"\"}`, text: dv.page(p)?.file.name ?? p });\n      c.addEventListener(\"click\", () => { ui.selected = ui.selected.includes(p) ? ui.selected.filter(x => x !== p) : [...ui.selected, p]; saveUi(); redraw(); });\n    }\n    const tools = pick.createEl(\"span\", { cls: \"pg-tools\" });\n    tools.createEl(\"span\", { text: \"Zoom\" });\n    const seg = tools.createEl(\"span\", { cls: \"pg-seg\" });\n    for (const [z, l] of [[\"day\", \"Days\"], [\"week\", \"Weeks\"], [\"month\", \"Months\"]]) {\n      const b = seg.createEl(\"span\", { text: l, cls: ui.zoom === z ? \"is-on\" : \"\" });\n      b.addEventListener(\"click\", () => { ui.zoom = z; KEEP.scroll = {}; saveUi(); redraw(); });\n    }\n    if (!ui.selected.length) body.createEl(\"p\", { text: \"Pick one or more projects above.\", attr: { style: \"color:var(--text-muted)\" } });\n    for (const p of ui.selected) {\n      const sec = body.createEl(\"div\", { cls: \"pg-proj\" });\n      const head = sec.createEl(\"div\", { cls: \"pg-proj-head\" });\n      const a = head.createEl(\"h4\").createEl(\"a\", { text: dv.page(p)?.file.name ?? p, cls: \"internal-link\" });\n      a.addEventListener(\"click\", () => app.workspace.openLinkText(p, \"\", false));\n      const pd = projectDue(p);\n      if (pd) { const d = diffDays(TODAY, pd); head.createEl(\"span\", { cls: `pg-pdue-chip${d < 0 ? \" is-over\" : \"\"}`, text: `⚑ due ${dmy(pd)} · ${d < 0 ? `${-d}d over` : d === 0 ? \"today\" : `${d}d left`}`, attr: { title: \"The project note's due property\" } }); }\n      { // roll-up for the whole project: computed from its steps, never written into a note\n        let rs = []; walk(dv.page(p)?.file.lists.where(l => l.parent === undefined || l.parent === null).array() ?? [], \"\", 0, rs, null);\n        rs = rs.filter(r => clean(r.raw) || r.kids.length); prep(rs);\n        const ls = rs.filter(r => !r.kids.length && !isRecur(r)), open = ls.filter(r => !r.done);\n        const est = open.reduce((t, r) => t + (r.est ?? 0), 0), noEst = open.filter(r => r.est === null).length, cost = open.reduce((t, r) => t + costOf(r), 0), blk = open.filter(r => r.blockedBy.length).length;\n        if (ls.length) head.createEl(\"span\", { cls: \"pg-sum\", text: `${ls.length - open.length} of ${ls.length} done${est ? ` · ${fmtEst(est)} left` : \"\"}${noEst && est ? ` (+${noEst} without estimate)` : \"\"}${cost ? ` · ${money(cost)} to buy` : \"\"}${blk ? ` · ${blk} blocked` : \"\"}`, attr: { title: \"Steps without sub-steps; repeats not counted. Time left is the open steps' [est::]; to buy is their price × qty. Nothing here is written into the note.\" } });\n      }\n      const view = ui.view[p] ?? \"gantt\";\n      const seg2 = head.createEl(\"span\", { cls: \"pg-seg\" });\n      for (const [v, l] of [[\"gantt\", \"Gantt\"], [\"steps\", \"Steps\"]]) {\n        const b = seg2.createEl(\"span\", { text: l, cls: view === v ? \"is-on\" : \"\" });\n        b.addEventListener(\"click\", () => { ui.view[p] = v; saveUi(); redraw(); });\n      }\n      if (view === \"gantt\") {\n        const mode = timeModeOf(p);\n        const seg3 = head.createEl(\"span\", { cls: \"pg-seg\", attr: { title: \"Sequence: plan order and effort, no dates. Calendar: bars on real dates.\" } });\n        for (const [v, l] of [[\"sequence\", \"Sequence\"], [\"calendar\", \"Calendar\"]]) {\n          const b = seg3.createEl(\"span\", { text: l, cls: mode === v ? \"is-on\" : \"\" });\n          b.addEventListener(\"click\", async () => { const f = app.vault.getAbstractFileByPath(p); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.gantt_mode = v; }); ui.timeMode = { ...(ui.timeMode ?? {}), [p]: v }; saveUi(); redraw(); });\n        }\n      }\n      if (view === \"steps\") project(p, sec);\n      else {\n        charts(p, sec);\n        if (timeModeOf(p) === \"sequence\") sec.createEl(\"div\", { cls: \"pg-legend\", text: \"Sequence: the hours of work still to do, in outline order (indent to nest, [mode:: parallel] side by side, ⛔ waits for a 🆔), each as long as its estimate. Done steps are off the axis (✓ with their date). [ ] bracket = a parent over its open steps, filled to the share done; ▸ folded. Drag a bar's right edge to change its estimate; drag a step (bar or ⋮⋮) up or down to move it; drag a bar left onto the start of the step above to run them side by side (∥, writes [with:: previous]). Bands are work days of \" + HOURS_PER_DAY + \"h. Switch to Calendar once you want dates.\" });\n        else sec.createEl(\"div\", { cls: \"pg-legend\", text: `■ planned (🛫 ⏳ 📅) · dashed: not planned yet, placed in outline order at ${HOURS_PER_DAY}h a day plus ${BUFFER}% buffer · grey ✓: done, on its ✅ date · [ ] bracket: a parent over its open steps, filled to the share done · ▸ folded · red: overdue · ⚑ due date · red dashed line: the project's due date (orange outline: a step that ends after it). Dragging plans (⏳, or 🛫 and ⏳); it never moves a 📅 deadline, and asks whether the later steps and the steps waiting for it (⛔) move along. Hatched with ⛔: waits for an open step; thin lines: what waits for what. Drag the dot at a bar's end onto another bar to make that one wait for it (🆔 and ⛔); click a thin line or a ⛔ to remove a link. Each heading with tasks is its own chart.` });\n      }\n    }\n  };\n  redraw();\n} else {\n  for (const path of files) project(path);\n}\n",
  "projects-board": "// The Projects board. Usage: await dv.view(\"Meta/views/projects-board\", { area: null })\n// One card per project note (type: project), in a column by its status property: Idea, Active, Paused, Done.\n// Drag a card to another column (or pick a status on the card) to change the note's status; + Idea makes a new\n// project note with status: idea. Nothing on the board is typed by hand, so it always matches the notes.\nconst AREA_KEYS = app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst AREA = AREA_KEYS.includes(input?.area) ? input.area : null;\nconst FOLDER = (dv.page(\"Meta/EX3C Agenda Config\") || {}).projects_folder || \"04 Projects\";\nconst IDEA_TEMPLATE = \"Templates/Project Idea.md\";\nconst COLS = [\n  { id: \"idea\", label: \"Idea\", match: [\"idea\", \"someday\", \"maybe\"] },\n  { id: \"active\", label: \"Active\", match: [\"active\", \"in progress\", \"doing\", \"\"] },\n  { id: \"paused\", label: \"Paused\", match: [\"paused\", \"on hold\", \"waiting\", \"blocked\"] },\n  { id: \"done\", label: \"Done\", match: [\"done\", \"complete\", \"completed\", \"archived\", \"dropped\"] },\n];\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = m => (obs.Notice ? new obs.Notice(m) : console.warn(m));\nconst slug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, \"-\").replace(/(^-|-$)/g, \"\");\nconst dmy = s => (s ? moment(String(s)).format(\"DD-MM-YYYY\") : \"\");\nconst UI = (window.__ex3cProjectBoard ??= { undo: null });\nconst parseEst = s => { const v = String(s ?? \"\").trim().toLowerCase().replace(\",\", \".\"); if (!v) return null; if (/^\\d+(\\.\\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith(\"h\") ? 60 : 1); } return hit ? m : null; };\nconst fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : \"\", m ? `${m}m` : \"\"].filter(Boolean).join(\" \") || \"0m\"; };\nconst money = n => n.toLocaleString(undefined, { style: \"currency\", currency: \"EUR\" });\nconst OPEN_IDS = new Set(dv.pages().file.tasks.where(t => !t.completed && t.status !== \"-\").array().map(t => t.text.match(/🆔 ([\\w-]+)/u)?.[1]).filter(Boolean));\nconst statusOf = p => String(p.status ?? \"\").toLowerCase().trim();\nconst colOf = p => (COLS.find(c => c.match.includes(statusOf(p))) ?? COLS[1]).id;\nfunction projects() {\n  return dv.pages().where(p => String(p.type ?? \"\") === \"project\" && !/^(Templates|\\.trash|scripts|wiki)\\//.test(p.file.path) && !/\\/templates\\//i.test(p.file.path) && !(p.file.tags ?? []).includes(\"#example\")\n    && (!AREA || String(p.area ?? \"\").toLowerCase() === AREA)).sort(p => p.file.name).array();\n}\n// a project's tasks: the tasks in its own note, plus tasks tagged #project/<slug> anywhere else\nfunction tasksOf(p, tagged) {\n  const own = p.file.tasks.array(), seen = new Set(own.map(t => `${t.path}:${t.line}`));\n  return own.concat((tagged.get(`#project/${slug(p.file.name)}`) ?? []).filter(t => !seen.has(`${t.path}:${t.line}`)));\n}\nasync function setStatus(p, to) {\n  const f = app.vault.getAbstractFileByPath(p.file.path); if (!f) return;\n  let before = null;\n  await app.fileManager.processFrontMatter(f, fm => {\n    before = { status: fm.status ?? null, started: fm.started ?? null, quarter: fm.quarter ?? null };\n    fm.status = to;\n    if (to === \"active\") { if (!fm.started) fm.started = moment().format(\"YYYY-MM-DD\"); if (!fm.quarter) fm.quarter = moment().format(\"YYYY-[Q]Q\"); }\n  });\n  UI.undo = { path: p.file.path, name: p.file.name, before, to, at: Date.now() };\n  setTimeout(render, 250);\n}\nasync function undo() {\n  const u = UI.undo; if (!u) return; const f = app.vault.getAbstractFileByPath(u.path); if (!f) return;\n  await app.fileManager.processFrontMatter(f, fm => { for (const [k, v] of Object.entries(u.before)) { if (v === null) delete fm[k]; else fm[k] = v; } });\n  UI.undo = null; setTimeout(render, 250);\n}\nfunction ask(title, placeholder) {\n  return new Promise(res => {\n    const back = document.body.createEl(\"div\", { attr: { style: \"position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px\" } });\n    const card = back.createEl(\"div\", { attr: { style: \"background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:10px;max-width:420px;width:100%;padding:14px 16px\" } });\n    card.createEl(\"div\", { text: title, attr: { style: \"font-weight:600;margin-bottom:8px\" } });\n    const inp = card.createEl(\"input\", { type: \"text\", attr: { style: \"width:100%\", placeholder } });\n    const row = card.createEl(\"div\", { attr: { style: \"display:flex;gap:8px;justify-content:flex-end;margin-top:10px\" } });\n    const no = row.createEl(\"button\", { text: \"Cancel\" }), yes = row.createEl(\"button\", { text: \"Create\", cls: \"mod-cta\" });\n    const done = v => { back.remove(); res(v); };\n    no.addEventListener(\"click\", () => done(null)); yes.addEventListener(\"click\", () => done(inp.value.trim()));\n    inp.addEventListener(\"keydown\", e => { if (e.key === \"Enter\") done(inp.value.trim()); if (e.key === \"Escape\") done(null); });\n    setTimeout(() => inp.focus(), 0);\n  });\n}\nasync function newIdea() {\n  const name = (await ask(\"New project idea\", \"Name of the project\"))?.replace(/[\\\\/:*?\"<>|#^[\\]]/g, \"\").trim();\n  if (!name) return;\n  if (app.vault.getAbstractFileByPath(`${FOLDER}/${name}.md`)) return notify(`${name} already exists.`);\n  const tpl = app.vault.getAbstractFileByPath(IDEA_TEMPLATE), templater = app.plugins.plugins[\"templater-obsidian\"]?.templater;\n  let f;\n  if (tpl && templater?.create_new_note_from_template) f = await templater.create_new_note_from_template(tpl, FOLDER, name, false);\n  else f = await app.vault.create(`${FOLDER}/${name}.md`, \"---\\ntype: project\\nstatus: idea\\narea:\\ntags:\\n  - project\\n---\\n\");\n  if (!f) return;\n  await app.fileManager.processFrontMatter(f, fm => { fm.status = \"idea\"; if (AREA) fm.area = AREA; });\n  notify(`Project idea added: ${name}.`);\n  setTimeout(render, 400);\n}\nconst root = dv.container.createEl(\"div\", { cls: \"pjb\" });\nroot.createEl(\"style\", { text: `\n.pjb-cols { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 10px; overflow-x: auto; }\n@media (max-width: 700px) { .pjb-cols { grid-template-columns: 1fr; overflow-x: visible; } .pjb-col { min-height: 0; } }\n.pjb-col { background: var(--background-secondary); border-radius: 8px; padding: 6px; min-height: 80px; }\n.pjb-col.is-over { outline: 2px dashed var(--interactive-accent); outline-offset: -2px; }\n.pjb-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; padding: 2px 4px 6px; }\n.pjb-head span { color: var(--text-muted); font-weight: 400; }\n.pjb-head button { margin-left: auto; font-size: 11px; padding: 1px 8px; height: auto; }\n.pjb-card { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 8px; margin: 6px 0; cursor: grab; font-size: 12px; }\n.pjb-card strong { display: block; font-size: 13px; cursor: pointer; } .pjb-card strong:hover { color: var(--text-accent); }\n.pjb-sub { color: var(--text-muted); } .pjb-roll { color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; } .pjb-next { margin-top: 3px; }\n.pjb-bar { height: 4px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; margin: 4px 0; } .pjb-bar > div { height: 100%; background: var(--interactive-accent); }\n.pjb-card select { font-size: 11px; height: auto; padding: 0 4px; margin-top: 4px; }\n.pjb-chip { font-size: 10px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--background-modifier-border); margin-left: 4px; }\n.pjb-undo { font-size: 12px; margin-bottom: 6px; display: flex; gap: 8px; align-items: center; }\n.pjb-undo button { font-size: 11px; padding: 1px 8px; height: auto; }` });\nfunction render() {\n  root.querySelectorAll(\":scope > :not(style)\").forEach(e => e.remove());\n  const list = projects();\n  const tagged = new Map();\n  for (const t of dv.pages().where(p => !/^(Templates|\\.trash|scripts|wiki)\\//.test(p.file.path)).file.tasks.where(t => (t.tags ?? []).some(x => x.startsWith(\"#project/\"))).array())\n    for (const tag of t.tags.filter(x => x.startsWith(\"#project/\"))) { const k = tag.split(\"/\").slice(0, 2).join(\"/\"); if (!tagged.has(k)) tagged.set(k, []); tagged.get(k).push(t); }\n  if (UI.undo && Date.now() - UI.undo.at < 600000) {\n    const u = root.createEl(\"div\", { cls: \"pjb-undo\" });\n    u.createEl(\"span\", { text: `Moved ${UI.undo.name} to ${COLS.find(c => c.id === UI.undo.to)?.label ?? UI.undo.to}.` });\n    const b = u.createEl(\"button\", { text: \"Undo\" }); b.addEventListener(\"click\", () => void undo());\n  }\n  const cols = root.createEl(\"div\", { cls: \"pjb-cols\" });\n  for (const col of COLS) {\n    const mine = list.filter(p => colOf(p) === col.id);\n    const el = cols.createEl(\"div\", { cls: \"pjb-col\", attr: { \"data-col\": col.id } });\n    const head = el.createEl(\"div\", { cls: \"pjb-head\", text: col.label });\n    head.createEl(\"span\", { text: String(mine.length) });\n    if (col.id === \"idea\") { const add = head.createEl(\"button\", { text: \"+ Idea\" }); add.addEventListener(\"click\", () => void newIdea()); }\n    el.addEventListener(\"dragover\", e => { e.preventDefault(); el.addClass(\"is-over\"); });\n    el.addEventListener(\"dragleave\", () => el.removeClass(\"is-over\"));\n    el.addEventListener(\"drop\", e => { e.preventDefault(); el.removeClass(\"is-over\"); const p = list.find(x => x.file.path === e.dataTransfer.getData(\"text/x-ex3c-project\")); if (p && colOf(p) !== col.id) void setStatus(p, col.id); });\n    for (const p of mine) {\n      const ts = tasksOf(p, tagged), open = ts.filter(t => !t.completed && t.status !== \"-\"), done = ts.filter(t => t.completed);\n      const card = el.createEl(\"div\", { cls: \"pjb-card\", attr: { draggable: \"true\" } });\n      card.addEventListener(\"dragstart\", e => { e.dataTransfer.setData(\"text/x-ex3c-project\", p.file.path); e.dataTransfer.effectAllowed = \"move\"; });\n      const t = card.createEl(\"strong\", { text: p.file.name }); t.addEventListener(\"click\", () => app.workspace.openLinkText(p.file.path, \"\", false));\n      // roll-up (computed, never written): steps done, estimated time and money still open, blocked steps\n      const leaf = t => !(t.children ?? []).some(c => c.task), steps = ts.filter(leaf), openSteps = steps.filter(t => !t.completed && t.status !== \"-\");\n      const f = (t, k) => t.text.match(new RegExp(`\\\\[${k}::\\\\s*([^\\\\]]*)\\\\]`))?.[1]?.trim();\n      const left = openSteps.reduce((m, t) => m + (parseEst(f(t, \"est\")) ?? 0), 0), noEst = openSteps.filter(t => parseEst(f(t, \"est\")) === null).length;\n      const cost = openSteps.reduce((c, t) => { const p = Number(f(t, \"price\")); return isNaN(p) || f(t, \"price\") === undefined ? c : c + p * (Number(f(t, \"qty\")) || 1); }, 0);\n      const blocked = openSteps.filter(t => (t.text.match(/⛔ ([\\w-]+(?:\\s*,\\s*[\\w-]+)*)/u)?.[1] ?? \"\").split(/\\s*,\\s*/).some(id => id && OPEN_IDS.has(id))).length;\n      const sub = card.createEl(\"div\", { cls: \"pjb-sub\", text: steps.length ? `${steps.length - openSteps.length} of ${steps.length} done` : \"No tasks yet\" });\n      const roll = [left ? `${fmtEst(left)} left` : \"\", cost ? `${money(cost)} to buy` : \"\", blocked ? `⛔ ${blocked} blocked` : \"\"].filter(Boolean);\n      const rollEl = roll.length ? card.createEl(\"div\", { cls: \"pjb-roll\", text: roll.join(\" · \"), attr: { title: `Computed from the open steps, never written into the note. Time left: their [est::]${noEst ? ` (${noEst} without an estimate are not counted)` : \"\"}. To buy: price × qty. Blocked: waiting for an open ⛔ task.` } }) : null;\n      if (p.area && !AREA) sub.createEl(\"span\", { cls: \"pjb-chip\", text: String(p.area) });\n      if (p.due) sub.appendText(` · due ${dmy(p.due)}`);\n      if (steps.length) card.createEl(\"div\", { cls: \"pjb-bar\" }).createEl(\"div\", { attr: { style: `width:${100 * (steps.length - openSteps.length) / steps.length}%` } });\n      const next = p.file.tasks.array().find(t => !t.completed && t.status !== \"-\" && !(t.children ?? []).some(c => !c.completed));\n      if (next && col.id === \"active\") card.createEl(\"div\", { cls: \"pjb-next\", text: `Next: ${next.text.replace(/\\s*[⏳📅🛫➕✅]\\s*\\d{4}-\\d{2}-\\d{2}/gu, \"\").replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\").replace(/\\s*(?:🆔|⛔)\\s*[\\w-]+(?:\\s*,\\s*[\\w-]+)*/gu, \"\").replace(/\\s*#project\\/\\S+/g, \"\").replace(/[🔺⏫🔼🔽⏬]/gu, \"\").replace(/\\s+/g, \" \").trim().replace(/^(.{90}).+$/, \"$1…\")}` });\n      // picking a status works on phones too, where cards cannot be dragged\n      const sel = card.createEl(\"select\", { attr: { \"aria-label\": `Status of ${p.file.name}` } });\n      for (const c of COLS) { const o = sel.createEl(\"option\", { text: c.label, value: c.id }); if (c.id === col.id) o.selected = true; }\n      sel.addEventListener(\"change\", () => void setStatus(p, sel.value));\n    }\n  }\n}\nrender();\n",
  "purchases": "// Every open task with a price or a shop, from every project, in one sortable list.\n// Usage: await dv.view(\"Meta/views/purchases\", { currency: \"EUR\" })\n// Task format: - [ ] Buy timber [price:: 7.90] [qty:: 14] [shop:: Timber yard]\n// price is per item, qty defaults to 1, total = price × qty. [shop:: Ikea, Action] (or the field twice) means\n// either shop: grouped by shop, the task is listed under each, and counted once in the grand total.\n// A ticked task with a price and a ✅ date is the price history: each item shows what you last paid, where and when.\n// Any other [field:: value] on these\n// tasks shows up as an extra column and sort option. Ticked items stay visible (struck through,\n// out of the totals) until the page refreshes, so a mis-click can be undone.\nconst EXCL = [\"Templates/\", \"scripts/\", \"wiki/\", \".trash/\"];\nconst CUR = input?.currency ?? \"EUR\";\nconst money = n => n.toLocaleString(undefined, { style: \"currency\", currency: CUR });\nconst KEY = \"compass-proto-purchases\";\nconst parseEst = s => { const v = String(s ?? \"\").trim().toLowerCase().replace(\",\", \".\"); if (/^\\d+(\\.\\d+)?$/.test(v)) return parseFloat(v); let m = 0, hit = false; for (const x of v.matchAll(/(\\d+(?:\\.\\d+)?)\\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)(?![a-z])/g)) { hit = true; m += parseFloat(x[1]) * (x[2].startsWith(\"h\") ? 60 : 1); } return hit ? m : null; };\n// ---- shared task writing (Dataview views cannot import each other, so this block is repeated) ----\nconst tasksApi = app.plugins.plugins[\"obsidian-tasks-plugin\"]?.apiV1;\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = msg => (obs.Notice ? new obs.Notice(msg) : console.warn(msg));\nconst TASK_RE = /^(\\s*)[-*+] \\[(.)\\] /;\nconst strip = s => s.replace(TASK_RE, \"\").replace(/\\s*✅ \\d{4}-\\d{2}-\\d{2}/, \"\").trim();\nconst isDoneLine = s => /^\\s*[-*+] \\[[xX-]\\]/.test(s);\nconst parseFields = s => { const f = {}; for (const m of s.matchAll(/\\[([\\w-]+)::\\s*([^\\]]*)\\]/g)) f[m[1]] = m[2].trim(); return f; };\nconst num = v => (v === undefined || v === \"\" || isNaN(Number(v)) ? undefined : Number(v));\nfunction shopsOf(raw) { return [...raw.matchAll(/\\[shop::\\s*([^\\]]*)\\]/g)].flatMap(m => m[1].split(\",\")).map(s => s.trim().replace(/^\"(.*)\"$/, \"$1\")).filter(Boolean); }\nconst clean = s => strip(s).replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\").replace(/\\s*(🆔|⛔) [\\w-]+(?:\\s*,\\s*[\\w-]+)*/gu, \"\").replace(/#project\\/\\S+/g, \"\").replace(/\\s+/g, \" \").trim();\n// r = { path, line, raw } where raw is the full task line as last seen.\nfunction findLine(lines, r) {\n  const key = strip(r.raw);\n  if (lines[r.line] !== undefined && TASK_RE.test(lines[r.line]) && strip(lines[r.line]) === key) return r.line;\n  let best = -1;\n  lines.forEach((l, i) => { if (TASK_RE.test(l) && strip(l) === key && (best < 0 || Math.abs(i - r.line) < Math.abs(best - r.line))) best = i; });\n  return best;\n}\nasync function writeTask(r, mode) {\n  const f = app.vault.getAbstractFileByPath(r.path);\n  if (!f) { notify(`Note not found: ${r.path}`); return false; }\n  const lines = (await app.vault.read(f)).split(\"\\n\");\n  const i = findLine(lines, r);\n  if (i < 0) { notify(\"That task changed in its note. Reopen this page to refresh.\"); return false; }\n  const line = lines[i];\n  let next;\n  if (mode === \"edit\") {\n    if (!tasksApi?.editTaskLineModal) { notify(\"The Tasks plugin edit dialog is not available.\"); return false; }\n    next = await tasksApi.editTaskLineModal(line);\n    if (!next) return false;\n    const ind = line.match(/^\\s*/)[0];\n    next = next.split(\"\\n\").map(l => (l.startsWith(ind) ? l : ind + l.trimStart())).join(\"\\n\");\n  } else {\n    next = tasksApi?.executeToggleTaskDoneCommand\n      ? tasksApi.executeToggleTaskDoneCommand(line, r.path)\n      : line.replace(/\\[(.)\\]/, (m, c) => (c === \" \" ? \"[x]\" : \"[ ]\"));\n  }\n  let ok = false;\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    const j = findLine(L, r);\n    if (j < 0) return data;\n    const parts = next.split(\"\\n\");\n    L.splice(j, 1, ...parts);\n    r.line = j + parts.length - 1; // Tasks puts a new recurrence above the completed task\n    r.raw = parts[parts.length - 1];\n    ok = true;\n    return L.join(\"\\n\");\n  });\n  if (!ok) notify(\"That task changed in its note. Reopen this page to refresh.\");\n  return ok;\n}\nfunction iconButton(parent, icon, label, onClick) {\n  const b = parent.createEl(\"span\", { cls: \"clickable-icon\", attr: { \"aria-label\": label, style: \"padding:2px;opacity:0.6\" } });\n  if (obs.setIcon) obs.setIcon(b, icon); else b.setText(\"✎\");\n  b.addEventListener(\"click\", e => { e.preventDefault(); e.stopPropagation(); return onClick(); });\n  return b;\n}\n// ---- end shared ----\n\n// Areas: a task's #<area> tag, otherwise its note's area property (the area list is the app's Areas).\nconst AREA = input?.area || null;\nconst AREA_KEYS = app.plugins?.plugins?.[\"ex3c-agenda\"]?.areaKeys?.() ?? [\"work\", \"study\", \"personal\"];\nconst AREA_TAG = new RegExp(`(^|\\\\s)#(${AREA_KEYS.join(\"|\") || \"(?!)\"})(?=\\\\s|$)`, \"i\");\nconst areaOf = (raw, page) => { const m = String(raw).match(AREA_TAG); if (m) return m[2].toLowerCase(); const a = String(page?.area ?? \"\").toLowerCase(); return AREA_KEYS.includes(a) ? a : null; };\n// Sample notes (tagged example) are left out unless a note passes samples: true.\nconst SAMPLES = input?.samples ?? false;\nconst isSample = p => p.example === true || (p.file.tags ?? []).includes(\"#example\");\nconst allTasks = dv.pages().where(p => !EXCL.some(e => p.file.path.startsWith(e)) && !/(^|\\/)templates\\//i.test(p.file.path) && String(p.type ?? \"\") !== \"checklist\" && (SAMPLES || !isSample(p))).file.tasks;\n// what you last paid for each item: the newest ticked task with the same text, a price and a ✅ date (any area)\nconst PAID = new Map();\nfor (const t of allTasks.where(t => t.completed && /\\[price::/.test(t.text)).array()) {\n  const raw = `- [x] ${t.text}`, date = t.text.match(/✅ (\\d{4}-\\d{2}-\\d{2})/u)?.[1], price = num(parseFields(raw).price);\n  if (!date || price === undefined) continue;\n  const k = itemKey(raw), old = PAID.get(k);\n  if (!old || old.date < date) PAID.set(k, { date, price, shop: shopsOf(raw).join(\", \") });\n}\n// the item without its dates, priority and other Tasks signs, so a planned or due item still matches its history\nfunction itemKey(raw) { return clean(raw).replace(/[📅⏳🛫➕✅❌]\\uFE0F?\\s*\\d{4}-\\d{2}-\\d{2}/gu, \"\").replace(/[🔺⏫🔼🔽⏬]\\uFE0F?/gu, \"\").replace(/🔁[^📅⏳🛫➕✅❌🆔⛔]*/u, \"\").replace(/\\s+/g, \" \").trim().toLowerCase(); }\nconst dmy = d => d.split(\"-\").reverse().join(\"-\");\nconst rows = allTasks\n  .where(t => !(t.completed || t.status === \"-\") && /\\[(price|shop)::/.test(t.text) && (!AREA || areaOf(t.text, dv.page(t.path)) === AREA)).array()\n  .map(t => {\n    const tag = (t.tags ?? []).find(x => x.startsWith(\"#project/\"));\n    return { path: t.path, line: t.line, raw: `- [${t.status}] ${t.text}`, project: tag ? tag.slice(9) : (dv.page(t.path)?.file.name ?? t.path) };\n  });\nfunction info(r) {\n  const fields = parseFields(r.raw);\n  const p = num(fields.price), price = p ?? 0, qty = num(fields.qty) ?? 1, shops = shopsOf(r.raw);\n  return { fields, item: clean(r.raw), qty, price, priced: p !== undefined, total: price * qty, shops, shop: shops.join(\", \"), project: r.project, done: isDoneLine(r.raw) };\n}\n\nlet state = { sort: \"total\", desc: true, group: \"shop\" };\ntry { Object.assign(state, JSON.parse(localStorage.getItem(KEY) ?? \"{}\")); } catch (e) {}\nconst save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nif (!rows.length) { root.createEl(\"p\", { text: \"No open tasks with a [price:: ] or [shop:: ] field yet.\" }); return; }\nconst bar = root.createEl(\"div\", { attr: { style: \"display:flex;gap:0.6em;flex-wrap:wrap;align-items:center;margin-bottom:0.6em\" } });\nconst out = root.createEl(\"div\");\nconst STD = [\"total\", \"price\", \"qty\", \"shop\", \"project\", \"item\"];\nconst extras = () => [...new Set(rows.flatMap(r => Object.keys(parseFields(r.raw))))].filter(k => ![\"price\", \"qty\", \"shop\"].includes(k));\n\nfunction controls() {\n  bar.empty();\n  const sel = (label, key, opts) => {\n    bar.createEl(\"span\", { text: label, attr: { style: \"color:var(--text-muted)\" } });\n    const s = bar.createEl(\"select\", { cls: \"dropdown\" });\n    for (const [v, l] of opts) s.createEl(\"option\", { value: v, text: l });\n    s.value = opts.some(o => o[0] === state[key]) ? state[key] : opts[0][0];\n    s.addEventListener(\"change\", () => { state[key] = s.value; save(); draw(); });\n  };\n  sel(\"Sort by\", \"sort\", [[\"total\", \"Total\"], [\"price\", \"Unit price\"], [\"qty\", \"Quantity\"], [\"shop\", \"Shop\"], [\"project\", \"Project\"], [\"item\", \"Item\"], ...extras().map(k => [k, k])]);\n  const dir = bar.createEl(\"button\", { text: state.desc ? \"High to low\" : \"Low to high\" });\n  dir.addEventListener(\"click\", () => { state.desc = !state.desc; save(); controls(); draw(); });\n  sel(\"Group by\", \"group\", [[\"shop\", \"Shop\"], [\"project\", \"Project\"], [\"none\", \"Nothing\"]]);\n}\n\n// A total row under a group (idea from Operon's table summaries): items, quantity, money and, when the tasks\n// have [est::], the time they take, each under its own column.\nfunction footer(body, cols, es, title) {\n  const open = es.filter(e => !e.i.done), qty = open.reduce((s, e) => s + e.i.qty, 0);\n  const total = open.reduce((s, e) => s + e.i.total, 0), mins = open.reduce((s, e) => s + (parseEst(e.i.fields.est) ?? 0), 0);\n  const unpriced = open.filter(e => !e.i.priced).length;\n  const tr = body.createEl(\"tr\", { cls: \"pur-total\", attr: { style: \"border-top:1px solid var(--background-modifier-border);color:var(--text-muted);font-size:var(--font-smaller)\" } });\n  tr.createEl(\"td\");\n  tr.createEl(\"td\", { text: `${title}: ${open.length} item${open.length === 1 ? \"\" : \"s\"}${unpriced ? ` · ${unpriced} without a price` : \"\"}` });\n  tr.createEl(\"td\", { text: String(qty) });\n  tr.createEl(\"td\");\n  tr.createEl(\"td\", { text: money(total), attr: { style: \"font-weight:600;color:var(--text-normal)\" } });\n  for (let i = 5; i < cols.length; i++) tr.createEl(\"td\", { text: cols[i] === \"est\" && mins ? fmtEst(mins) : \"\" });\n}\nconst fmtEst = min => { const h = Math.floor(min / 60), m = Math.round(min - h * 60); return [h ? `${h}h` : \"\", m ? `${m}m` : \"\"].filter(Boolean).join(\" \") || \"0m\"; };\n\nfunction draw() {\n  out.empty();\n  const ex = extras();\n  const val = (i, k) => (STD.includes(k) ? i[k] : k === \"est\" ? (parseEst(i.fields.est) ?? -1) : (i.fields[k] ?? \"\"));\n  const list = rows.map(r => ({ r, i: info(r) })).sort((a, b) => {\n    const x = val(a.i, state.sort), y = val(b.i, state.sort);\n    const c = typeof x === \"number\" && typeof y === \"number\" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });\n    return state.desc ? -c : c;\n  });\n  const groups = new Map();\n  const add = (g, e) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); };\n  for (const e of list) {\n    if (state.group === \"none\") add(\"\", e);\n    else if (state.group === \"shop\") { if (!e.i.shops.length) add(\"No shop\", e); for (const s of e.i.shops) add(s, { ...e, here: s }); }\n    else add(e.i[state.group] || `No ${state.group}`, e);\n  }\n  const cols = [\"\", \"Item\", \"Qty\", \"Unit\", \"Total\", ...(state.group === \"shop\" ? [] : [\"Shop\"]), ...(state.group === \"project\" ? [] : [\"Project\"]), ...ex, \"\"];\n  // wide on a phone: the table scrolls sideways inside its card, the page does not\n  const table = out.createEl(\"div\", { attr: { style: \"overflow-x:auto;max-width:100%\" } }).createEl(\"table\");\n  const hr = table.createEl(\"thead\").createEl(\"tr\");\n  for (const c of cols) hr.createEl(\"th\", { text: c });\n  const body = table.createEl(\"tbody\");\n  const sum = es => es.filter(e => !e.i.done).reduce((s, e) => s + e.i.total, 0);\n  for (const [g, es] of groups) {\n    if (g) {\n      const open = es.filter(e => !e.i.done).length;\n      body.createEl(\"tr\").createEl(\"td\", { text: `${g}  ·  ${open} item${open === 1 ? \"\" : \"s\"}  ·  ${money(sum(es))}`, attr: { colspan: cols.length, style: \"font-weight:600;padding-top:0.8em\" } });\n    }\n    const groupRows = es;\n    for (const { r, i, here } of es) {\n      const tr = body.createEl(\"tr\", { attr: { style: i.done ? \"color:var(--text-faint);text-decoration:line-through\" : \"\" } });\n      const cb = tr.createEl(\"td\").createEl(\"input\", { type: \"checkbox\", cls: \"task-list-item-checkbox\" });\n      cb.checked = i.done;\n      cb.addEventListener(\"click\", async e => {\n        e.preventDefault();\n        const before = r.raw;\n        r.raw = r.raw.replace(/\\[(.)\\]/, i.done ? \"[ ]\" : \"[x]\"); // show the change right away\n        draw();\n        r.raw = before;\n        if (!(await writeTask(r, \"toggle\"))) r.raw = before;\n        draw();\n      });\n      const itd = tr.createEl(\"td\");\n      const it = itd.createEl(\"a\", { text: i.item, cls: \"internal-link\" });\n      it.addEventListener(\"click\", () => app.workspace.openLinkText(r.path, \"\", false, { eState: { line: r.line } }));\n      const notes = [];\n      const also = here ? i.shops.filter(s => s !== here) : [];\n      if (also.length) notes.push(`also at ${also.join(\", \")}`);\n      const paid = PAID.get(itemKey(r.raw));\n      if (paid) notes.push(`last paid ${money(paid.price)}${paid.shop ? ` at ${paid.shop}` : \"\"}, ${dmy(paid.date)}`);\n      if (notes.length) itd.createEl(\"div\", { text: notes.join(\" · \"), attr: { style: \"font-size:var(--font-smallest);color:var(--text-muted)\" } });\n      tr.createEl(\"td\", { text: String(i.qty) });\n      tr.createEl(\"td\", { text: i.priced ? money(i.price) : \"no price\", attr: i.priced ? {} : { style: \"color:var(--text-faint)\" } });\n      tr.createEl(\"td\", { text: i.priced ? money(i.total) : \"\" });\n      if (state.group !== \"shop\") tr.createEl(\"td\", { text: i.shop });\n      if (state.group !== \"project\") tr.createEl(\"td\", { text: i.project });\n      for (const k of ex) tr.createEl(\"td\", { text: i.fields[k] ?? \"\" });\n      iconButton(tr.createEl(\"td\"), \"pencil\", \"Edit task\", async () => { if (await writeTask(r, \"edit\")) { controls(); draw(); } });\n    }\n    if (g && groupRows.length > 1) footer(body, cols, groupRows, `${g} total`);\n  }\n  if (state.group === \"none\" && list.length > 1) footer(body, cols, list, \"Total\");\n  const open = list.filter(e => !e.i.done), noPrice = open.filter(e => !e.i.priced).length, multi = open.filter(e => e.i.shops.length > 1).length;\n  out.createEl(\"p\", { text: `${open.length} items, ${money(sum(list))} in total${noPrice ? ` (${noPrice} without a price)` : \"\"}.${state.group === \"shop\" && multi ? ` ${multi} can be bought at more than one shop: they are listed under each and counted once here.` : \"\"}`, attr: { style: \"font-weight:600\" } });\n}\ncontrols();\ndraw();\n",
  "quicklinks": "// EX3C Agenda quick links: capture buttons (QuickAdd commands) + jump to today's multi-scale planning notes.\n// Usage: await dv.view(\"Meta/views/quicklinks\")\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst DAILY = cfg.daily_folder || \"01 Journal/Daily\";\nconst WEEKLY = cfg.weekly_folder || \"01 Journal/Weekly\";\nconst QUARTERLY = cfg.quarterly_folder || \"01 Journal/Quarterly\";\nconst RETREATS = cfg.retreat_folder || \"02 Retreats\";\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\n\nconst now = moment();\nconst links = [\n  [\"Today\", `${DAILY}/${now.format(\"YYYY-MM-DD\")}`, now.format(\"YYYY-MM-DD\")],\n  [\"This week\", `${WEEKLY}/${now.format(\"gggg-[W]ww\")}`, now.format(\"gggg-[W]ww\")],\n  [\"This quarter\", `${QUARTERLY}/${now.format(\"YYYY-[Q]Q\")}`, now.format(\"YYYY-[Q]Q\")],\n  [\"Retreat\", `${RETREATS}/${now.format(\"YYYY-[Q]Q\")} Personal Retreat`, `${now.format(\"YYYY-[Q]Q\")} Personal Retreat`],\n];\nconst p = root.createEl(\"p\");\np.appendText(\"Jump: \");\nlinks.forEach(([lab, path, name], i) => {\n  if (i) p.appendText(\"  ·  \");\n  const a = p.createEl(\"a\", { text: `${lab} (${name})`, cls: \"internal-link\", attr: { href: name, \"data-href\": name } });\n  a.addEventListener(\"click\", e => { e.preventDefault(); app.workspace.openLinkText(name, path, false); });\n});\n\n// Buttons resolve the QuickAdd choice by NAME at click time, so ids may change freely.\nconst buttons = [\n  [\"📝 Journal entry\", \"Journal entry\", \"lifeos-journal\"],\n  [\"🏆 Log a win\", \"Log a win\", \"lifeos-win\"],\n  [\"🙏 Gratitude\", \"Gratitude\", \"lifeos-gratitude\"],\n  [\"✅ Add task\", \"Add task\", \"lifeos-task\"],\n];\nconst wrap = root.createEl(\"div\", { cls: \"lifeos-buttons\" });\nfor (const [lab, name, fallbackId] of buttons) {\n  const b = wrap.createEl(\"button\", { text: lab });\n  b.addEventListener(\"click\", () => {\n    const qa = app.plugins?.plugins?.quickadd;\n    const choice = qa?.settings?.choices?.find(c => (c.name || \"\").includes(name));\n    const id = `quickadd:choice:${choice ? choice.id : fallbackId}`;\n    const ok = app.commands.executeCommandById(id);\n    if (!ok) new Notice(`QuickAdd choice \"${name}\" not found or not enabled as a command. Check QuickAdd settings.`);\n  });\n}\n",
  "setup": "// EX3C Agenda Setup status widget. Usage: await dv.view(\"Meta/views/setup\")\n// Detects what is still at its template default. Renders booleans only; never shows key values. Writes only when you press a button: this note's setup_sections_done and status properties.\nconst cur = dv.current() || {};\n// The checks live in setup-checks.js, so the banner on Home counts exactly what this note shows.\nconst ex3c = app.plugins.plugins[\"ex3c-agenda\"];\nconst checks = ex3c?.widgetCode ? await ex3c.widgetCode(\"setup-checks\") : await app.vault.adapter.read(\"Meta/views/setup-checks.js\");\nconst rows = await new (Object.getPrototypeOf(async function () {}).constructor)(\"dv\", \"app\", \"moment\", \"cur\", checks)(dv, app, moment, cur);\n\n// Render\n// Tiers 0 to 2 are required; a required section is done when its required checks pass (or you mark it done).\n// Optional sections (AI, browser) only appear while the AI module is installed and never hold setup open.\n// When the three required sections are done, Finish sets status: done and the banner on Home goes away.\nconst REQUIRED = [0, 1, 2];\nconst SECTIONS = [0, 1, 2, 3, 4].filter(t => REQUIRED.includes(t) || rows.some(r => r.tier === t));\nconst tiers = { 0: \"Tier 0: the app\", 1: \"Tier 1: make it yours\", 2: \"Tier 2: the practice\", 3: \"Tier 3: AI in the vault (optional)\", 4: \"Tier 4: browser and web (optional)\" };\nconst optional = t => !REQUIRED.includes(t);\nconst passing = t => rows.filter(r => r.tier === t && !r.opt).every(r => r.ok);\nconst marked = new Set((Array.isArray(cur.setup_sections_done) ? cur.setup_sections_done : []).map(Number));\nconst isDone = t => marked.has(t) || passing(t);\nconst file = app.vault.getAbstractFileByPath(cur.file?.path || \"00 Dashboards/Setup.md\");\nconst setMarked = async (t, on) => {\n  await app.fileManager.processFrontMatter(file, fm => {\n    const list = new Set((Array.isArray(fm.setup_sections_done) ? fm.setup_sections_done : []).map(Number));\n    if (on) list.add(t); else list.delete(t);\n    fm.setup_sections_done = [...list].sort();\n  });\n  if (on) marked.add(t); else marked.delete(t);\n  draw();\n};\nlet status = cur.status;\nconst setStatus = async v => { await app.fileManager.processFrontMatter(file, fm => { fm.status = v; }); status = v; draw(); };\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget setup-sections\" });\nroot.createEl(\"style\", { text: `.setup-sections .ss-bar { height: 6px; border-radius: 3px; background: var(--background-modifier-border); overflow: hidden; margin: 4px 0 10px; }\n.setup-sections .ss-bar > div { height: 100%; background: var(--interactive-accent); }\n.setup-sections .ss-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 14px 0 4px; }\n.setup-sections .ss-head h4 { margin: 0; }\n.setup-sections .ss-state { font-size: 12px; color: var(--text-muted); }\n.setup-sections .ss-state.is-done { color: var(--color-green); font-weight: 600; }\n.setup-sections button { font-size: 12px; padding: 2px 10px; height: auto; }\n.setup-sections details > summary { cursor: pointer; color: var(--text-muted); font-size: 12px; }\n.setup-sections .ss-finish { padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--color-green) 12%, var(--background-secondary)); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }` });\nfunction draw() {\nroot.querySelectorAll(\":scope > :not(style)\").forEach(e => e.remove());\nif (status === \"done\") {\n  const box = root.createEl(\"div\", { cls: \"ss-finish\" });\n  box.createEl(\"span\", { text: \"✅ Setup finished. The banner on Home is gone.\" });\n  const re = box.createEl(\"button\", { text: \"Reopen setup\" });\n  re.addEventListener(\"click\", () => void setStatus(\"open\"));\n} else {\n  const doneCount = REQUIRED.filter(isDone).length;\n  const total = rows.filter(r => r.tier <= 2 && !r.opt).length, req = rows.filter(r => r.tier <= 2 && !r.opt && r.ok).length;\n  root.createEl(\"p\", { text: `Required sections done: ${doneCount} of ${REQUIRED.length}. Required checks passing: ${req} of ${total}. Checks marked \"later\" and optional sections never hold setup open.` });\n  root.createEl(\"div\", { cls: \"ss-bar\" }).createEl(\"div\", { attr: { style: `width:${100 * doneCount / REQUIRED.length}%` } });\n  if (doneCount === REQUIRED.length) {\n    const box = root.createEl(\"div\", { cls: \"ss-finish\" });\n    box.createEl(\"span\", { text: \"Every section is done.\" });\n    const fin = box.createEl(\"button\", { text: \"Finish setup\", cls: \"mod-cta\" });\n    fin.addEventListener(\"click\", () => void setStatus(\"done\"));\n  }\n  for (const t of SECTIONS) {\n    const list = rows.filter(x => x.tier === t), ok = list.filter(r => r.ok).length, all = ok === list.length;\n    const head = root.createEl(\"div\", { cls: \"ss-head\" });\n    head.createEl(\"h4\", { text: tiers[t] });\n    head.createEl(\"span\", { cls: `ss-state${isDone(t) ? \" is-done\" : \"\"}`, text: isDone(t) ? (all ? \"Done\" : `Done (${ok} of ${list.length} checks)`) : `${ok} of ${list.length} checks pass` });\n    if (marked.has(t) || !passing(t)) {\n      const btn = head.createEl(\"button\", { text: marked.has(t) ? \"Reopen\" : optional(t) ? \"Skip\" : \"Mark done anyway\" });\n      btn.addEventListener(\"click\", () => void setMarked(t, !marked.has(t)));\n    }\n    // a done section folds away; open it again from its summary\n    const holder = isDone(t) ? root.createEl(\"details\") : root;\n    if (isDone(t)) holder.createEl(\"summary\", { text: \"Show checks\" });\n    const table = holder.createEl(\"table\", { cls: \"lifeos-table\" });\n    const th = table.createEl(\"thead\").createEl(\"tr\"); for (const h of [\"\", \"Item\", \"Where to fix\", \"Note\"]) th.createEl(\"th\", { text: h });\n    const tb = table.createEl(\"tbody\");\n    for (const r of list) {\n      const tr = tb.createEl(\"tr\");\n      tr.createEl(\"td\", { text: r.ok ? \"✅\" : r.opt ? \"◻️\" : \"⬜\", attr: r.opt && !r.ok ? { title: \"Later or nice to have: does not hold setup open\" } : {} });\n      tr.createEl(\"td\", { text: r.item });\n      const td = tr.createEl(\"td\");\n      const m = r.where.match(/^\\[\\[([^\\]]+)\\]\\]/);\n      if (m) { const a = td.createEl(\"a\", { text: m[1], cls: \"internal-link\", attr: { href: m[1], \"data-href\": m[1] } }); a.addEventListener(\"click\", e => { e.preventDefault(); app.workspace.openLinkText(m[1], \"\", false); }); td.appendText(r.where.slice(m[0].length)); }\n      else td.setText(r.where);\n      tr.createEl(\"td\", { text: [r.opt ? \"later / nice to have\" : \"\", r.note].filter(Boolean).join(\"; \") });\n    }\n  }\n}\n}\ndraw();\n",
  "setup-checks": "// EX3C Agenda setup checks, shared by the Setup note (Meta/views/setup.js) and the setup banner on Home.\n// Runs as the body of an async function(dv, app, moment, cur) and returns the rows; cur is the Setup note's properties.\n// Reads settings only; never shows key values; writes nothing.\n// tier: 0 the app, 1 make it yours, 2 the practice (these three are required), 3 AI, 4 browser and web (optional).\n// opt: a check that is nice to have but does not hold its section open (goals that take weeks, cosmetic settings).\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst rows = [];\nconst add = (tier, item, ok, where, note, opt = false) => rows.push({ tier, item, ok: !!ok, where, note: note || \"\", opt });\nconst readJson = async p => { try { return JSON.parse(await app.vault.adapter.read(p)); } catch (e) { return null; } };\nconst readText = async p => { try { const f = app.vault.getAbstractFileByPath(p); return f ? await app.vault.cachedRead(f) : \"\"; } catch (e) { return \"\"; } };\nconst enabled = id => { try { return app.plugins.enabledPlugins.has(id); } catch (e) { return false; } };\nconst pset = id => { try { return app.plugins.plugins[id]?.settings || null; } catch (e) { return null; } };\nconst today = moment();\nconst aiOn = app.plugins.plugins[\"ex3c-agenda\"]?.aiOn?.() !== false;\n\n// Tier 0: the app\nfor (const [id, name] of [[\"ex3c-agenda\", \"EX3C Agenda\"], [\"dataview\", \"Dataview\"], [\"templater-obsidian\", \"Templater\"], [\"periodic-notes\", \"Periodic Notes\"], [\"quickadd\", \"QuickAdd\"], [\"obsidian-tasks-plugin\", \"Tasks\"]])\n  add(0, `${name} plugin enabled`, enabled(id), \"Settings → Community plugins\");\n// Kanban only draws the Writing boards: not required, and only listed while the Writing module is in the vault.\nif (app.vault.getAbstractFileByPath(\"06 Writing\")) add(0, \"Kanban plugin enabled (Writing boards)\", enabled(\"obsidian-kanban\"), \"Setup → Optional modules → Writing boards → Switch Kanban on\", \"only the Writing boards use it\", true);\nadd(0, \"Day Planner plugin enabled (timeline and week view)\", enabled(\"obsidian-day-planner\"), \"Settings → Community plugins\", \"the planner works without it\", true);\nadd(0, \"EX3C Agenda application command registered\", !!app.commands.findCommand(\"ex3c-agenda:open-home\"), \"Command palette → EX3C Agenda: Open EX3C Agenda home\");\nadd(0, \"Dataview JavaScript queries on\", !!(pset(\"dataview\")?.enableDataviewJs), \"Settings → Dataview\");\nadd(0, \"CSS snippet ex3c-agenda on (callout colours)\", (() => { try { return app.customCss.enabledSnippets.has(\"ex3c-agenda\"); } catch (e) { return false; } })(), \"Settings → Appearance → CSS snippets\", \"cosmetic\", true);\nadd(0, \"Periodic Notes daily folder matches config\", (() => { const pn = pset(\"periodic-notes\"); return !!pn && pn.daily?.folder === (cfg.daily_folder || \"01 Journal/Daily\") && /Daily Note\\.md$/.test(pn.daily?.template || \"\"); })(), \"Settings → Periodic Notes\");\nadd(0, \"Templater triggers on new files\", (() => { const t = pset(\"templater-obsidian\"); return !!t && (t.trigger_on_file_creation === true || t.trigger_on_file_creation_mode === \"folder\"); })(), \"Settings → Templater\");\nadd(0, \"QuickAdd captures available as commands\", (() => { const ch = pset(\"quickadd\")?.choices || []; return [\"Journal entry\", \"Log a win\", \"Gratitude\", \"Add task\"].every(n => ch.find(c => (c.name || \"\").includes(n))?.command === true); })(), \"Settings → QuickAdd (lightning icon per choice)\");\nadd(0, \"Hotkeys for today's note and the questions prompt\", (() => { try { const hk = app.hotkeyManager.customKeys || {}; return [\"quickadd:choice:lifeos-daily\", \"templater-obsidian:Templates/Daily Questions Prompt.md\"].every(id => (hk[id] || []).length > 0); } catch (e) { return false; } })(), \"Settings → Hotkeys\");\n\n// Tier 1: make it yours\nconst theme = await readText(\"03 Planning/Life Theme.md\");\nadd(1, \"Life theme written\", theme.length > 0 && !theme.includes(\"Replace this line with your life theme\"), \"[[Life Theme]]\");\nconst values = await readText(\"03 Planning/Core Values.md\");\nadd(1, \"Core values written\", values.length > 0 && !/\\*\\*Value one\\*\\*/.test(values), \"[[Core Values]]\");\nadd(1, \"Ideal week is yours (example property removed)\", !((dv.page(\"03 Planning/Ideal Week\") || {}).example === true), \"[[Ideal Week]]\", \"fill the grid, then delete the example property\");\nadd(1, \"Questions, habits, wheel areas reviewed\", Array.isArray(cfg.questions) && cfg.questions.length > 0 && Array.isArray(cfg.habits) && cfg.habits.length <= 5, \"[[EX3C Agenda Config]]\", Array.isArray(cfg.habits) && cfg.habits.length > 5 ? \"more than 5 habits; keep 3 to 5 per season\" : \"\");\nconst examples = dv.pages(\"#example\").length;\nadd(1, \"Example notes deleted\", examples === 0, \"Setup → Optional modules → Examples → Remove, or delete notes tagged example\", examples ? `${examples} example notes remain` : \"\");\nadd(1, \"Backup of the vault folder exists (self-declared)\", cur.setup_backup === true, \"copy the folder somewhere else, then tick setup_backup in this note's properties\", \"\", true);\n\n// Tier 2: the practice (the first days; the long-run goals are listed but do not hold setup open)\nconst daily = cfg.daily_folder || \"01 Journal/Daily\";\nconst dqp = cfg.dq_prefix || \"dq_\";\nconst real = dv.pages(`\"${daily}\"`).where(p => /^\\d{4}-\\d{2}-\\d{2}$/.test(p.file.name) && !(p.tags || []).includes(\"example\")).array();\nadd(2, \"A daily note exists\", real.length > 0, \"Ctrl/Cmd+Shift+D\");\nconst answered = real.filter(p => Object.entries(p.file.frontmatter || {}).some(([k, v]) => k.startsWith(dqp) && v !== null && v !== \"\" && v !== undefined));\nconst last30 = answered.filter(p => today.diff(moment(p.file.name), \"days\") < 30).length;\nadd(2, \"First real daily questions answered\", answered.length > 0, \"Ctrl/Cmd+Shift+Q tonight, or the Check-in tab\");\nadd(2, \"A weekly note exists\", dv.pages(`\"${cfg.weekly_folder || \"01 Journal/Weekly\"}\"`).where(p => !(p.tags || []).includes(\"example\")).length > 0, \"Command palette: Periodic Notes: Open weekly note\", \"from week 2\", true);\nadd(2, \"Days answered in the last 30 (goal 25)\", last30 >= 25, \"keep going\", `${last30}/30`, true);\nadd(2, \"A personal retreat note exists for this quarter\", !!dv.page(`${cfg.retreat_folder || \"02 Retreats\"}/${today.format(\"YYYY-[Q]Q\")} Personal Retreat`), \"Guide: Personal Retreat workflow\", \"from day 60\", true);\n\n// Tier 3: AI in the vault (optional; only while the AI module is installed)\nif (aiOn) {\n  add(3, \"Agent Client plugin enabled\", enabled(\"agent-client\"), \"Settings → Community plugins\");\n  const ac = await readJson(\".obsidian/plugins/agent-client/data.json\");\n  const configuredCommands = Object.values(ac?.presetAgents || {}).map(p => p?.command || \"\").filter(Boolean);\n  const isLinux = navigator.userAgent.includes(\"Linux\") && !navigator.userAgent.includes(\"Android\");\n  add(3, \"At least one local agent path set in Agent Client\", configuredCommands.some(cmd => !isLinux || cmd.startsWith(\"/\")), \"Settings → Agent Client → choose an agent → Auto-detect\", \"on Linux Flatpak use the full path to the wrapper\");\n  add(3, \"Agent login done (self-declared)\", cur.setup_claude_login === true, \"tick setup_claude_login in this note's properties\", \"the property name is kept for older vaults\");\n  add(3, \"Obsidian MCP server registered for your agent (self-declared)\", cur.setup_mcp_registered === true, \"Guide: Obsidian MCP Bridge, then tick setup_mcp_registered\");\n  add(3, \"Agent Client has had a conversation\", (ac?.savedSessions || []).length > 0, \"[[Assistant]]\");\n  // Tier 4: browser and web (optional; the REST API belongs to the AI module)\n  add(4, \"Local REST API enabled\", enabled(\"obsidian-local-rest-api\"), \"Settings → Community plugins\");\n  const ra = await readJson(\".obsidian/plugins/obsidian-local-rest-api/data.json\");\n  add(4, \"REST API key generated (never shown here)\", typeof ra?.apiKey === \"string\" && ra.apiKey.length > 0 && ra?.enableInsecureServer === true, \"Settings → Local REST API\");\n  add(4, \"Web viewer core plugin on\", (() => { try { return app.internalPlugins.plugins.webviewer?.enabled === true; } catch (e) { return false; } })(), \"Settings → Core plugins\");\n}\nreturn rows;\n",
  "triage": "// Inbox triage. Usage: await dv.view(\"Meta/views/triage\")\n// 08 Tasks/Tasks.md has three lists: ## Inbox (just captured), ## Soon (plan within a month of capture),\n// ## Eventually (no time frame). Each inbox task without a date gets three buttons:\n//   Today      writes ⏳ today and stays where it is (the planner and today's note show it)\n//   Soon       moves it under ## Soon with 🔼 medium (unless it has a priority): the planner counts down to a month after ➕\n// Soon lines (## Soon, or #soon anywhere) written before Soon meant 🔼 get it once, from a list you confirm, with undo.\n//   Eventually moves it under ## Eventually: the planner leaves it out until you move it back\nconst PATH = \"08 Tasks/Tasks.md\";\nconst obs = (() => { try { return require(\"obsidian\"); } catch (e) { return {}; } })();\nconst notify = m => (obs.Notice ? new obs.Notice(m, 8000) : console.warn(m));\nconst pad = n => String(n).padStart(2, \"0\");\nconst d = new Date(), TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nconst TASK_RE = /^[-*+] \\[ \\] (.*)$/;\nconst dated = l => /[⏳📅]\\s*\\d{4}-\\d{2}-\\d{2}/u.test(l);\nconst clean = l => l.replace(TASK_RE, \"$1\").replace(/\\s*➕ \\d{4}-\\d{2}-\\d{2}/u, \"\").replace(/\\[[\\w-]+::[^\\]]*\\]/g, \"\").replace(/\\s+/g, \" \").trim();\nconst file = app.vault.getAbstractFileByPath(PATH);\nconst root = dv.container.createEl(\"div\", { cls: \"trg\" });\nroot.createEl(\"style\", { text: `.trg { font-size: 13px; } .trg h4 { margin: 0 0 4px; } .trg-sub { color: var(--text-muted); font-size: 12px; margin: 4px 0 0; }\n.trg-row { display: flex; gap: 6px; align-items: center; padding: 4px 0; border-top: 1px solid var(--background-modifier-border); flex-wrap: wrap; }\n.trg-row .t { flex: 1 1 200px; min-width: 0; cursor: pointer; } .trg button { font-size: 12px; padding: 1px 9px; height: auto; }` });\nif (!file) { root.createEl(\"p\", { cls: \"trg-sub\", text: `${PATH} not found.` }); return; }\nconst L = (await app.vault.read(file)).split(\"\\n\");\nconst section = name => { const s = L.findIndex(l => new RegExp(`^##\\\\s+${name}\\\\s*$`, \"i\").test(l)); if (s < 0) return []; let e = L.findIndex((l, i) => i > s && /^#{1,6}\\s/.test(l)); if (e < 0) e = L.length; return L.slice(s + 1, e).map((l, k) => ({ l, i: s + 1 + k })).filter(x => TASK_RE.test(x.l)); };\nconst waiting = section(\"Inbox\").filter(x => !dated(x.l));\nconst soon = section(\"Soon\").length, later = section(\"Eventually\").length;\nasync function change(line, fn) { await app.vault.process(file, data => { const A = data.split(\"\\n\"), i = A.indexOf(line); return i < 0 ? data : fn(A, i).join(\"\\n\"); }); }\nconst addDate = l => { const out = l.replace(/\\s*⏳ \\d{4}-\\d{2}-\\d{2}/u, \"\"); const m = out.match(/\\s(?:[🔺⏫🔼🔽⏬🔁➕🛫📅✅❌🆔⛔]|\\^[\\w-]+\\s*$)/u); return m ? `${out.slice(0, m.index)} ⏳ ${TODAY}${out.slice(m.index)}` : `${out.trimEnd()} ⏳ ${TODAY}`; };\n// 🔼 medium unless the line already has a priority, before its date fields like the Tasks plugin writes it\nconst PRI_RE = /[🔺⏫🔼🔽⏬]/u;\nconst addMedium = l => { if (PRI_RE.test(l)) return l; const m = l.match(/\\s(?:[🔁➕🛫⏳📅✅❌🆔⛔]|\\^[\\w-]+\\s*$)/u); return m ? `${l.slice(0, m.index)} 🔼${l.slice(m.index)}` : `${l.trimEnd()} 🔼`; };\n// moves a line to the end of a ## section (made if missing, after Inbox), dropping an empty \"- \" placeholder there\nfunction moveTo(A, i, heading) {\n  const [line] = A.splice(i, 1);\n  let s = A.findIndex(l => new RegExp(`^##\\\\s+${heading}\\\\s*$`, \"i\").test(l));\n  if (s < 0) { const inb = A.findIndex(l => /^##\\s+Inbox\\s*$/i.test(l)); let e = A.findIndex((l, k) => k > inb && /^#{1,6}\\s/.test(l)); if (e < 0) e = A.length; A.splice(e, 0, `## ${heading}`, \"\"); s = e; }\n  let e = A.findIndex((l, k) => k > s && /^#{1,6}\\s/.test(l)); if (e < 0) e = A.length;\n  for (let k = s + 1; k < e; k++) if (/^\\s*-\\s*$/.test(A[k])) { A.splice(k, 1); e--; break; }\n  let at = e; while (at > s + 1 && A[at - 1].trim() === \"\") at--;\n  A.splice(at, 0, line);\n  if (at + 1 < A.length && /^#{1,6}\\s/.test(A[at + 1])) A.splice(at + 1, 0, \"\");\n  return A;\n}\nroot.createEl(\"h4\", { text: waiting.length ? `Inbox (${waiting.length})` : \"Inbox: nothing to sort\" });\nfor (const x of waiting) {\n  const row = root.createEl(\"div\", { cls: \"trg-row\" });\n  const t = row.createEl(\"span\", { cls: \"t\", text: clean(x.l) });\n  t.addEventListener(\"click\", () => app.workspace.openLinkText(PATH, \"\", false, { eState: { line: x.i } }));\n  row.createEl(\"button\", { text: \"Today\", cls: \"mod-cta\", attr: { title: \"Plan it for today (⏳)\" } }).addEventListener(\"click\", () => change(x.l, (A, i) => { A[i] = addDate(A[i]); return A; }));\n  row.createEl(\"button\", { text: \"Soon\", attr: { title: \"Move it to ## Soon with 🔼 medium: plan it within a month\" } }).addEventListener(\"click\", () => change(x.l, (A, i) => { A[i] = addMedium(A[i]); return moveTo(A, i, \"Soon\"); }));\n  row.createEl(\"button\", { text: \"Eventually\", attr: { title: \"Move it to ## Eventually: no time frame, out of the planner\" } }).addEventListener(\"click\", () => change(x.l, (A, i) => moveTo(A, i, \"Eventually\")));\n}\n// once: Soon lines without a priority get 🔼, after you have seen the list; Undo puts them back as they were\nconst STORE = app.plugins.plugins[\"ex3c-agenda\"] ?? {}, UNDO = STORE.__soonUndo;\nconst oldSoon = [...section(\"Soon\").filter(x => TASK_RE.test(x.l.trim()) && !PRI_RE.test(x.l)).map(x => ({ path: PATH, line: x.l })),\n  ...dv.pages().file.tasks.where(t => !t.completed && /(^|\\s)#soon\\b/i.test(t.text) && !PRI_RE.test(t.text) && t.path !== PATH).array().map(t => ({ path: t.path, text: t.text }))];\nasync function rewrite(items, fn) {\n  const done = [];\n  for (const [path, list] of Object.entries(Object.groupBy ? Object.groupBy(items, x => x.path) : items.reduce((g, x) => ((g[x.path] ??= []).push(x), g), {}))) {\n    const f = app.vault.getAbstractFileByPath(path); if (!f) continue;\n    await app.vault.process(f, data => { const A = data.split(\"\\n\"); for (const x of list) { const i = A.findIndex(l => (x.line ? l === x.line : /^\\s*[-*+] \\[ \\] /.test(l) && l.includes(x.text))); if (i < 0) continue; const after = fn(A[i]); if (after !== A[i]) { done.push({ path, before: A[i], after }); A[i] = after; } } return A.join(\"\\n\"); });\n  }\n  return done;\n}\nif (oldSoon.length) {\n  const box = root.createEl(\"div\", { cls: \"trg-sub\", attr: { style: \"margin-top:8px\" } });\n  box.createEl(\"div\", { text: `${oldSoon.length} Soon task${oldSoon.length === 1 ? \" has\" : \"s have\"} no priority. Soon now means 🔼 medium; give ${oldSoon.length === 1 ? \"it\" : \"them\"} 🔼 once?` });\n  const ul = box.createEl(\"ul\", { attr: { style: \"margin:4px 0\" } });\n  for (const x of oldSoon.slice(0, 20)) ul.createEl(\"li\", { text: `${clean(x.line ?? `- [ ] ${x.text}`)}${x.path === PATH ? \"\" : `  (${x.path.split(\"/\").pop().replace(/\\.md$/, \"\")})`}` });\n  if (oldSoon.length > 20) ul.createEl(\"li\", { text: `and ${oldSoon.length - 20} more` });\n  box.createEl(\"button\", { text: `Give ${oldSoon.length === 1 ? \"it\" : `all ${oldSoon.length}`} 🔼 medium` }).addEventListener(\"click\", async () => {\n    const done = await rewrite(oldSoon, addMedium);\n    STORE.__soonUndo = done;\n    notify(`${done.length} Soon task${done.length === 1 ? \"\" : \"s\"} now 🔼 medium. Undo is under the inbox until you restart Obsidian.`);\n  });\n} else if (UNDO?.length) {\n  const box = root.createEl(\"div\", { cls: \"trg-sub\", attr: { style: \"margin-top:8px\" } });\n  box.createEl(\"span\", { text: `${UNDO.length} Soon task${UNDO.length === 1 ? \"\" : \"s\"} got 🔼 medium. ` });\n  box.createEl(\"button\", { text: \"Undo\" }).addEventListener(\"click\", async () => {\n    let n = 0;\n    for (const u of UNDO) { const f = app.vault.getAbstractFileByPath(u.path); if (!f) continue; await app.vault.process(f, data => { const A = data.split(\"\\n\"), i = A.indexOf(u.after); if (i < 0) return data; A[i] = u.before; n++; return A.join(\"\\n\"); }); }\n    STORE.__soonUndo = null;\n    notify(`Undone: ${n} of ${UNDO.length} back as they were${n < UNDO.length ? \" (the others were edited since)\" : \"\"}.`);\n  });\n}\nconst sub = root.createEl(\"p\", { cls: \"trg-sub\", text: `Soon ${soon} · Eventually ${later} · ` });\nsub.createEl(\"a\", { text: \"open the Tasks note\", attr: { style: \"cursor:pointer\" } }).addEventListener(\"click\", () => app.workspace.openLinkText(PATH, \"\", false));\n",
  "week": "// EX3C Agenda weekly review table: one row per day of the week with daily-question scores and habit hits.\n// Usage: await dv.view(\"Meta/views/week\", { week: dv.current().file.name })   // file named gggg-[W]ww\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst FOLDER = cfg.daily_folder || \"01 Journal/Daily\";\nconst DQ = cfg.dq_prefix || \"dq_\";\nconst HB = cfg.habit_prefix || \"habit_\";\nconst weekName = (input && input.week) || moment().format(\"gggg-[W]ww\");\nconst start = moment(weekName, \"gggg-[W]ww\").startOf(\"week\");\nconst label = (k, pre) => k.slice(pre.length).replace(/[_-]+/g, \" \").replace(/\\b\\w/g, c => c.toUpperCase());\n\nconst days = [];\nfor (let i = 0; i < 7; i++) days.push(start.clone().add(i, \"day\"));\nconst pagesByName = new Map(dv.pages(`\"${FOLDER}\"`).array().map(p => [p.file.name, p]));\nconst dqKeys = new Set(), hbKeys = new Set();\nfor (const d of days) {\n  const p = pagesByName.get(d.format(\"YYYY-MM-DD\"));\n  if (!p) continue;\n  for (const k of Object.keys(p.file.frontmatter || {})) { if (k.startsWith(DQ)) dqKeys.add(k); if (k.startsWith(HB)) hbKeys.add(k); }\n}\nconst dqs = [...dqKeys].sort(), hbs = [...hbKeys].sort();\nconst header = [\"Day\", ...dqs.map(k => label(k, DQ)), \"Habits\"];\nconst rows = [];\nconst sums = {}, counts = {};\nfor (const d of days) {\n  const name = d.format(\"YYYY-MM-DD\");\n  const p = pagesByName.get(name);\n  const fm = p ? (p.file.frontmatter || {}) : null;\n  const cells = [p ? dv.fileLink(p.file.path, false, d.format(\"ddd D\")) : d.format(\"ddd D\")];\n  for (const k of dqs) {\n    const v = fm && fm[k] !== null && fm[k] !== \"\" && !isNaN(Number(fm[k])) ? Number(fm[k]) : null;\n    if (v !== null) { sums[k] = (sums[k] || 0) + v; counts[k] = (counts[k] || 0) + 1; }\n    cells.push(v === null ? \"\" : String(v));\n  }\n  const hit = fm ? hbs.filter(k => fm[k] === true).length : 0;\n  cells.push(fm ? `${hit}/${hbs.length}` : \"\");\n  rows.push(cells);\n}\nrows.push([\"**Average**\", ...dqs.map(k => counts[k] ? (sums[k] / counts[k]).toFixed(1) : \"\"), \"\"]);\nif (dqs.length === 0 && hbs.length === 0) dv.paragraph(`No daily notes with ${DQ}* or ${HB}* properties found for ${weekName} yet.`);\nelse dv.table(header, rows);\n",
  "wheel": "// EX3C Agenda Wheel of Life widget: radar chart from wheel_* number properties.\n// Usage:\n//   await dv.view(\"Meta/views/wheel\")                                  -> this quarter's retreat (by naming convention), else most recent\n//   await dv.view(\"Meta/views/wheel\", { page: dv.current().file.path })  -> a specific retreat note (used inside the retreat template)\nconst cfg = dv.page(\"Meta/EX3C Agenda Config\") || {};\nconst FOLDER = cfg.retreat_folder || \"02 Retreats\";\nconst PREFIX = cfg.wheel_prefix || \"wheel_\";\n\nlet page = input && input.page ? dv.page(input.page) : null;\nlet how = \"\";\nif (!page) {\n  const q = moment().quarter(), yr = moment().year();\n  page = dv.page(`${FOLDER}/${yr}-Q${q} Personal Retreat`);\n  how = page ? `this quarter (${yr}-Q${q})` : \"\";\n}\nif (!page) {\n  const all = dv.pages(`\"${FOLDER}\"`).where(p => /^\\d{4}-Q[1-4] Personal Retreat$/.test(p.file.name)).sort(p => p.file.name, \"desc\").array();\n  page = all[0];\n  how = page ? \"most recent retreat\" : \"\";\n}\n\nconst root = dv.container.createEl(\"div\", { cls: \"lifeos-widget\" });\nif (!page) {\n  root.createEl(\"p\", { text: `No personal retreat note found in ${FOLDER}. Create one named \"YYYY-QN Personal Retreat\" (for example ${moment().year()}-Q${moment().quarter()} Personal Retreat) and fill in the ${PREFIX}* properties.` });\n} else {\n  const fm = page.file.frontmatter || {};\n  const axes = Object.keys(fm)\n    .filter(k => k.startsWith(PREFIX) && fm[k] !== null && fm[k] !== \"\" && !isNaN(Number(fm[k])))\n    .map(k => ({ key: k, name: k.slice(PREFIX.length).replace(/[_-]+/g, \" \").replace(/\\b\\w/g, c => c.toUpperCase()), v: Math.max(0, Math.min(10, Number(fm[k]))) }));\n  if (how) root.createEl(\"p\", { text: `Source: ${page.file.name} (${how})` }).style.opacity = \"0.7\";\n  if (axes.length < 3) {\n    root.createEl(\"p\", { text: `Retreat note ${page.file.name} has fewer than 3 filled ${PREFIX}* properties.` });\n  } else {\n    const n = axes.length, cx = 170, cy = 160, R = 105, W = 340, H = 320;\n    const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;\n    const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];\n    let svg = `<svg viewBox=\"0 0 ${W} ${H}\" xmlns=\"http://www.w3.org/2000/svg\" style=\"max-width:${W}px\">`;\n    for (const ring of [2, 4, 6, 8, 10]) {\n      const pts = axes.map((_, i) => pt(i, R * ring / 10).map(c => c.toFixed(1)).join(\",\")).join(\" \");\n      svg += `<polygon points=\"${pts}\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\"${ring === 10 ? 0.4 : 0.15}\" />`;\n    }\n    axes.forEach((a, i) => {\n      const [x2, y2] = pt(i, R);\n      svg += `<line x1=\"${cx}\" y1=\"${cy}\" x2=\"${x2.toFixed(1)}\" y2=\"${y2.toFixed(1)}\" stroke=\"currentColor\" stroke-opacity=\"0.2\" />`;\n      const [lx, ly] = pt(i, R + 22);\n      const anchor = Math.abs(lx - cx) < 5 ? \"middle\" : (lx > cx ? \"start\" : \"end\");\n      svg += `<text x=\"${lx.toFixed(1)}\" y=\"${(ly + 4).toFixed(1)}\" font-size=\"11\" text-anchor=\"${anchor}\" fill=\"currentColor\">${a.name} (${a.v})</text>`;\n    });\n    const poly = axes.map((a, i) => pt(i, R * a.v / 10).map(c => c.toFixed(1)).join(\",\")).join(\" \");\n    svg += `<polygon points=\"${poly}\" fill=\"var(--interactive-accent)\" fill-opacity=\"0.35\" stroke=\"var(--interactive-accent)\" stroke-width=\"2\" />`;\n    axes.forEach((a, i) => { const [px, py] = pt(i, R * a.v / 10); svg += `<circle cx=\"${px.toFixed(1)}\" cy=\"${py.toFixed(1)}\" r=\"3\" fill=\"var(--interactive-accent)\" />`; });\n    svg += `</svg>`;\n    root.createEl(\"div\", { cls: \"lifeos-chart\" }).innerHTML = svg;\n    const avg = axes.reduce((s, a) => s + a.v, 0) / n;\n    const low = [...axes].sort((a, b) => a.v - b.v)[0];\n    root.createEl(\"p\", { text: `Average ${avg.toFixed(1)} / 10. Lowest area: ${low.name} (${low.v}). That is the candidate for the next 90 days.` });\n  }\n}\n",
  "worknote": "// Writes your Work schedule into a note Day Planner can read. Usage: await dv.view(\"Meta/views/worknote\")\n// The #work lines under \"## Blocks\" in 03 Planning/Ideal Week.md (the Work tab's Work schedule writes them) and the note's\n// commute_minutes become dated task lines in 10 Areas/Work/Work schedule.md, from today to the end of the third week\n// after this one: \"- [ ] 07:30 - 16:30 Work #work #event ⏳ 2026-10-27\". #event makes them fixed busy time, not tasks.\n// The EX3C AgendA app runs this at start-up and whenever the Ideal Week changes; it writes only when something changed.\nconst IDEAL = \"03 Planning/Ideal Week.md\", NOTE = input?.path ?? \"10 Areas/Work/Work schedule.md\";\nconst DAYN = [\"mon\", \"tue\", \"wed\", \"thu\", \"fri\", \"sat\", \"sun\"];\nconst pad = n => String(n).padStart(2, \"0\");\nconst clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;\nconst iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;\nfunction daysOf(spec) {\n  const out = new Set();\n  for (const part of String(spec).toLowerCase().split(/\\s*,\\s*/)) {\n    if (part === \"daily\" || part === \"every day\") DAYN.forEach((d, i) => out.add(i));\n    else if (part === \"weekdays\") [0, 1, 2, 3, 4].forEach(i => out.add(i));\n    else if (part === \"weekend\") [5, 6].forEach(i => out.add(i));\n    else { const [a, b] = part.split(/\\s*-\\s*/).map(x => DAYN.indexOf(x.slice(0, 3))); if (a < 0) continue; if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; } }\n  }\n  return [...out];\n}\nconst LINE_RE = /^\\s*[-*+]\\s+([A-Za-z][A-Za-z, -]*?)\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+(.+)$/;\nconst src = app.vault.getAbstractFileByPath(IDEAL);\nif (!src) return;\n// read the file itself, not the Dataview index, which may not have caught up with the edit that triggered this\nconst text = await app.vault.cachedRead(src);\nconst commute = Number(app.metadataCache.getFileCache(src)?.frontmatter?.commute_minutes ?? 0) || 0;\nconst perDay = {};\nfor (const l of text.split(\"\\n\")) {\n  const m = l.match(LINE_RE);\n  if (!m || !/(^|\\s)#work\\b/i.test(m[6])) continue;\n  const what = m[6].replace(/(^|\\s)#work\\b/gi, \" \").trim() || \"Work\";\n  for (const i of daysOf(m[1])) (perDay[i] ??= []).push({ s: +m[2] * 60 + +m[3], e: +m[4] * 60 + +m[5], what });\n}\nconst file = app.vault.getAbstractFileByPath(NOTE);\nif (!Object.keys(perDay).length && !file) return; // no work schedule and no note: nothing to do\nconst start = new Date(); start.setHours(12, 0, 0, 0);\nconst end = new Date(start); end.setDate(end.getDate() + (6 - (start.getDay() + 6) % 7) + 21); // Sunday, three weeks on\nconst lines = [];\nfor (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {\n  for (const b of perDay[(d.getDay() + 6) % 7] ?? []) {\n    if (b.e <= b.s) continue;\n    const day = iso(d);\n    if (commute) lines.push(`- [ ] ${clock(b.s - commute)} - ${clock(b.s)} Commute #work #event ⏳ ${day}`);\n    lines.push(`- [ ] ${clock(b.s)} - ${clock(b.e)} ${b.what} #work #event ⏳ ${day}`);\n    if (commute) lines.push(`- [ ] ${clock(b.e)} - ${clock(b.e + commute)} Commute #work #event ⏳ ${day}`);\n  }\n}\nconst body = `---\ntags:\n  - generated\narea: work\n---\nGenerated from your Work schedule (the \\`#work\\` lines in [[Ideal Week]]), from today to the end of the third week after this one. Refreshed automatically; edits here are overwritten. Change your hours in the Work schedule on the Work tab.\n\n## Work blocks\n${lines.length ? lines.join(\"\\n\") : \"No work days in your Work schedule.\"}\n`;\nif (file) { if ((await app.vault.read(file)) !== body) await app.vault.modify(file, body); }\nelse {\n  const dir = NOTE.split(\"/\").slice(0, -1).join(\"/\");\n  if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);\n  await app.vault.create(NOTE, body);\n}\n",
  "workschedule": "// Work schedule. Usage: await dv.view(\"Meta/views/workschedule\")\n// An editor for the work part of your Ideal Week: it reads and writes the #work lines under \"## Blocks\" in\n// 03 Planning/Ideal Week.md (\"Tue-Thu 07:30 - 16:30 Work #work\") and the note's commute_minutes. The Ideal Week switch\n// (planner_use_ideal_week in the config note) turns it on in the planner: work and the commute before and after it\n// are kept free of tasks and drawn behind the week view.\nconst IDEAL = \"03 Planning/Ideal Week.md\", CFG = \"Meta/EX3C Agenda Config.md\";\nconst DAYS = [[\"mon\", \"Mon\"], [\"tue\", \"Tue\"], [\"wed\", \"Wed\"], [\"thu\", \"Thu\"], [\"fri\", \"Fri\"], [\"sat\", \"Sat\"], [\"sun\", \"Sun\"]];\nconst DAYN = DAYS.map(d => d[0]);\nconst page = dv.page(IDEAL) ?? {};\nconst pad = n => String(n).padStart(2, \"0\");\nconst clock = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;\nconst parseClock = s => { const m = String(s ?? \"\").trim().match(/^(\\d{1,2})[:.](\\d{2})$/); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };\nconst fmt = m => { const h = Math.floor(m / 60), r = m % 60; return [h ? `${h}h` : \"\", r ? `${r}m` : \"\"].filter(Boolean).join(\" \") || \"0h\"; };\nfunction daysOf(spec) {\n  const out = new Set();\n  for (const part of String(spec).toLowerCase().split(/\\s*,\\s*/)) {\n    if (part === \"daily\" || part === \"every day\") DAYN.forEach((d, i) => out.add(i));\n    else if (part === \"weekdays\") [0, 1, 2, 3, 4].forEach(i => out.add(i));\n    else if (part === \"weekend\") [5, 6].forEach(i => out.add(i));\n    else { const [a, b] = part.split(/\\s*-\\s*/).map(x => DAYN.indexOf(x.slice(0, 3))); if (a < 0) continue; if (b === undefined) out.add(a); else if (b >= 0) for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; } }\n  }\n  return [...out];\n}\nconst LINE_RE = /^\\s*([A-Za-z][A-Za-z, -]*?)\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s+(.+)$/;\n// the work hours per weekday, from the #work lines (the first one on a day counts)\nconst hours = {};\nfor (const [k] of DAYS) hours[k] = null;\nfor (const l of page.file?.lists?.array() ?? []) {\n  const m = String(l.text).match(LINE_RE);\n  if (!m || !/(^|\\s)#work\\b/i.test(m[6])) continue;\n  for (const i of daysOf(m[1])) if (!hours[DAYN[i]]) hours[DAYN[i]] = { s: +m[2] * 60 + +m[3], e: +m[4] * 60 + +m[5] };\n}\nlet commute = Number(page.commute_minutes ?? 0) || 0;\nconst using = dv.page(CFG)?.planner_use_ideal_week === true;\n// days with the same hours next to each other become one line: Tue-Thu 07:30 - 16:30 Work #work\nfunction workLines() {\n  const out = [];\n  for (let i = 0; i < 7; i++) {\n    const h = hours[DAYN[i]]; if (!h || h.e <= h.s) continue;\n    let j = i; while (j + 1 < 7 && hours[DAYN[j + 1]] && hours[DAYN[j + 1]].s === h.s && hours[DAYN[j + 1]].e === h.e) j++;\n    const name = k => DAYS[k][1];\n    out.push(`- ${i === j ? name(i) : `${name(i)}-${name(j)}`} ${clock(h.s)} - ${clock(h.e)} Work #work`);\n    i = j;\n  }\n  return out;\n}\nasync function saveWork() {\n  const f = app.vault.getAbstractFileByPath(IDEAL); if (!f) return;\n  await app.vault.process(f, data => {\n    const L = data.split(\"\\n\");\n    let start = L.findIndex(l => /^##\\s+Blocks\\s*$/.test(l));\n    if (start < 0) { const r = L.findIndex(l => /^##\\s+Rules/.test(l)); const at = r < 0 ? L.length : r; L.splice(at, 0, \"## Blocks\", \"\"); start = at; }\n    let end = L.findIndex((l, k) => k > start && /^#{1,6}\\s/.test(l)); if (end < 0) end = L.length;\n    const kept = L.slice(start + 1, end).filter(l => !(LINE_RE.test(l.replace(/^\\s*-\\s*/, \"\")) && /(^|\\s)#work\\b/i.test(l)));\n    while (kept.length && kept[kept.length - 1].trim() === \"\") kept.pop();\n    L.splice(start + 1, end - start - 1, ...kept, ...workLines(), \"\");\n    return L.join(\"\\n\");\n  });\n}\nconst saveCommute = async v => { const f = app.vault.getAbstractFileByPath(IDEAL); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.commute_minutes = v; }); };\nconst saveSwitch = async v => { const f = app.vault.getAbstractFileByPath(CFG); if (f) await app.fileManager.processFrontMatter(f, fm => { fm.planner_use_ideal_week = v; }); };\n\nconst root = dv.container.createEl(\"div\", { cls: \"wsch\" });\nroot.createEl(\"style\", { text: `\n.wsch { font-size: 13px; }\n.wsch h4 { margin: 0 0 4px; }\n.wsch-sub { color: var(--text-muted); font-size: 12px; margin: 2px 0 8px; }\n.wsch-grid { display: grid; grid-template-columns: auto auto auto auto 1fr; gap: 4px 8px; align-items: center; }\n.wsch-grid input[type=text] { width: 4.6em; text-align: center; }\n.wsch-grid .is-off { color: var(--text-faint); }\n.wsch-grid input.is-off { opacity: .55; }\n.wsch-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 8px 0 0; }\n.wsch-row input[type=number] { width: 4.5em; }\n.wsch-bar { position: relative; height: 18px; border-radius: 4px; background: var(--background-modifier-border); min-width: 120px; touch-action: none; user-select: none; -webkit-user-select: none; }\n.wsch-bar span { position: absolute; top: 0; bottom: 0; border-radius: 4px; }\n.wsch-bar .w { cursor: grab; }\n.wsch-bar.is-dragging .w { cursor: grabbing; }\n.wsch-bar .w i { position: absolute; top: 2px; bottom: 2px; width: 4px; border-radius: 2px; background: var(--background-primary); opacity: .8; cursor: ew-resize; }\n.wsch-bar .w .hl { left: 2px; } .wsch-bar .w .hr { right: 2px; }\n@media (max-width: 520px) { .wsch-grid { grid-template-columns: auto auto auto auto; } .wsch-bar { grid-column: 1 / -1; margin: 0 0 6px; height: 22px; } }\n.wsch-bar .w { background: color-mix(in srgb, var(--interactive-accent) 70%, transparent); }\n.wsch-bar .c { background: color-mix(in srgb, var(--text-faint) 55%, transparent); }\n` });\nroot.createEl(\"h4\", { text: \"Work schedule\" });\nconst total = DAYS.reduce((t, [k]) => t + (hours[k] && hours[k].e > hours[k].s ? hours[k].e - hours[k].s : 0), 0);\nconst workdays = DAYS.filter(([k]) => hours[k] && hours[k].e > hours[k].s).length;\nroot.createEl(\"p\", { cls: \"wsch-sub\", text: workdays\n  ? `${fmt(total)} of work on ${workdays} day${workdays === 1 ? \"\" : \"s\"}${commute ? `, plus ${fmt(commute * 2 * workdays)} of commuting` : \"\"}. The planner shows it as blocks on the hours and plans tasks around it. Stored as #work lines in your Ideal Week, and written out day by day to 10 Areas/Work/Work schedule so Day Planner shows it too.`\n  : \"Fill in the days you work. They are written into your Ideal Week as #work blocks, show in the planner as blocks that tasks are planned around, and appear in Day Planner through 10 Areas/Work/Work schedule.\" });\nconst sw = root.createEl(\"label\", { cls: \"wsch-row\" });\nconst swi = sw.createEl(\"input\", { attr: { type: \"checkbox\" } });\nswi.checked = using;\nsw.appendText(\" Also use the rest of my Ideal Week (#tasks hours and blocks) in the planner\");\nswi.addEventListener(\"change\", () => void saveSwitch(swi.checked));\n\nconst grid = root.createEl(\"div\", { cls: \"wsch-grid\", attr: { style: \"margin-top:8px\" } });\n// A day you switch off keeps its hours for when you switch it back on (while Obsidian stays open); a day that never\n// had hours starts from your other workdays' hours instead of 09:00 - 17:00.\nconst MEM = (window.__ex3cWorkHours ??= {});\nconst R0 = 5 * 60, R1 = 23 * 60;\nfor (const [k] of DAYS) if (hours[k]) MEM[k] = { ...hours[k] };\nconst typical = DAYS.map(([k]) => hours[k]).find(Boolean) ?? null;\nfor (const [k, name] of DAYS) {\n  const h = hours[k], shown = h ?? MEM[k] ?? typical;\n  const on = grid.createEl(\"label\");\n  const cb = on.createEl(\"input\", { attr: { type: \"checkbox\" } });\n  cb.checked = !!h;\n  on.appendText(` ${name}`);\n  const s = grid.createEl(\"input\", { attr: { type: \"text\", value: shown ? clock(shown.s) : \"\", placeholder: \"09:00\", \"aria-label\": `${name} start`, ...(h ? {} : { class: \"is-off\" }) } });\n  grid.createEl(\"span\", { cls: h ? \"\" : \"is-off\", text: \"to\" });\n  const e = grid.createEl(\"input\", { attr: { type: \"text\", value: shown ? clock(shown.e) : \"\", placeholder: \"17:00\", \"aria-label\": `${name} end`, ...(h ? {} : { class: \"is-off\" }) } });\n  // the day from 05:00 to 23:00: commute grey, work in colour. Drag an end of the work part to change the start or the\n  // end, its middle to move the whole day (15-minute steps); the times update as you drag and are saved on release.\n  const bar = grid.createEl(\"div\", { cls: \"wsch-bar\" });\n  const pct = m => Math.max(0, Math.min(100, ((m - R0) / (R1 - R0)) * 100));\n  const draw = x => {\n    bar.empty();\n    bar.title = x ? `${clock(x.s - commute)} leave · ${clock(x.s)} - ${clock(x.e)} work · home ${clock(x.e + commute)}. Drag an end to change it, the middle to move it.` : \"Day off\";\n    if (!x || x.e <= x.s) return;\n    if (commute) for (const [a, b] of [[x.s - commute, x.s], [x.e, x.e + commute]]) bar.createEl(\"span\", { cls: \"c\", attr: { style: `left:${pct(a)}%;right:${100 - pct(b)}%` } });\n    const w = bar.createEl(\"span\", { cls: \"w\", attr: { style: `left:${pct(x.s)}%;right:${100 - pct(x.e)}%` } });\n    w.createEl(\"i\", { cls: \"hl\" }); w.createEl(\"i\", { cls: \"hr\" });\n  };\n  draw(h);\n  bar.addEventListener(\"pointerdown\", ev => {\n    const cur0 = hours[k]; if (!cur0) return;\n    const r = bar.getBoundingClientRect(), at = cx => R0 + ((cx - r.left) / r.width) * (R1 - R0);\n    const xs = r.left + (pct(cur0.s) / 100) * r.width, xe = r.left + (pct(cur0.e) / 100) * r.width, grab = Math.max(8, Math.min(14, (xe - xs) / 4));\n    const mode = Math.abs(ev.clientX - xs) <= grab ? \"s\" : Math.abs(ev.clientX - xe) <= grab ? \"e\" : ev.clientX > xs && ev.clientX < xe ? \"m\" : null;\n    if (!mode) return;\n    ev.preventDefault(); try { bar.setPointerCapture(ev.pointerId); } catch (err) { /* not a real pointer */ } bar.addClass(\"is-dragging\");\n    const m0 = at(ev.clientX); let cur = { ...cur0 };\n    const move = e2 => {\n      const d = Math.round((at(e2.clientX) - m0) / 15) * 15;\n      cur = mode === \"s\" ? { s: Math.max(0, Math.min(cur0.s + d, cur0.e - 15)), e: cur0.e } : mode === \"e\" ? { s: cur0.s, e: Math.min(24 * 60 - 1, Math.max(cur0.e + d, cur0.s + 15)) }\n        : { s: Math.max(0, Math.min(cur0.s + d, 24 * 60 - 1 - (cur0.e - cur0.s))), e: 0 };\n      if (mode === \"m\") cur.e = cur.s + (cur0.e - cur0.s);\n      draw(cur); s.value = clock(cur.s); e.value = clock(cur.e);\n    };\n    const up = () => {\n      bar.removeEventListener(\"pointermove\", move); bar.removeEventListener(\"pointerup\", up); bar.removeEventListener(\"pointercancel\", up); bar.removeClass(\"is-dragging\");\n      if (cur.s !== cur0.s || cur.e !== cur0.e) { hours[k] = cur; MEM[k] = { ...cur }; void saveWork(); }\n    };\n    bar.addEventListener(\"pointermove\", move); bar.addEventListener(\"pointerup\", up); bar.addEventListener(\"pointercancel\", up);\n  });\n  const commit = () => {\n    if (!cb.checked) { if (hours[k]) MEM[k] = { ...hours[k] }; hours[k] = null; }\n    else { const a = parseClock(s.value) ?? shown?.s ?? 9 * 60, b = parseClock(e.value) ?? shown?.e ?? 17 * 60; hours[k] = { s: a, e: b > a ? b : a + 8 * 60 }; MEM[k] = { ...hours[k] }; }\n    void saveWork();\n  };\n  cb.addEventListener(\"change\", commit);\n  s.addEventListener(\"change\", () => { cb.checked = true; commit(); });\n  e.addEventListener(\"change\", () => { cb.checked = true; commit(); });\n}\nconst row = root.createEl(\"div\", { cls: \"wsch-row\" });\nconst cl = row.createEl(\"label\", { text: \"Commute, each way \" });\nconst ci = cl.createEl(\"input\", { attr: { type: \"number\", min: \"0\", max: \"240\", step: \"5\", value: String(commute) } });\ncl.appendText(\" min\");\nci.addEventListener(\"change\", () => void saveCommute(Math.max(0, Number(ci.value) || 0)));\nconst copy = row.createEl(\"button\", { text: \"Monday's hours to Tue-Fri\" });\ncopy.addEventListener(\"click\", () => { if (!hours.mon) return; for (const k of [\"tue\", \"wed\", \"thu\", \"fri\"]) hours[k] = { ...hours.mon }; void saveWork(); });\n",
});
// ---------- end of built-in widget code ----------
