const {
  Component,
  ItemView,
  MarkdownPreviewRenderer,
  Modal,
  Notice,
  Plugin,
  TFile,
  requestUrl,
  moment,
  setIcon,
} = require("obsidian");

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

// The Markdown dashboards were retired on 25-10-2026; a shortcut that pointed at one opens the tab that shows the same.
const RETIRED_DASHBOARDS = { "00 Dashboards/Dashboard.md": "home", "00 Dashboards/Task Dashboard.md": "home", "00 Dashboards/Projects Dashboard.md": "projects", "00 Dashboards/Habit Canvas.md": "review", "00 Dashboards/Daily Questions.md": "review", "00 Dashboards/Boards.md": "library" };
const DESTINATIONS = [
  {
    icon: "layout-dashboard",
    label: "EX3C AgendA",
    description: "Direction, habits, questions, and life wheel.",
    path: "00 Dashboards/Dashboard.md",
  },
  {
    icon: "list-checks",
    label: "Tasks",
    description: "See the full task system.",
    path: "00 Dashboards/Task Dashboard.md",
  },
  {
    icon: "folder-kanban",
    label: "Projects",
    description: "Review active projects and ideas.",
    path: "00 Dashboards/Projects Dashboard.md",
  },
  {
    icon: "columns-3",
    label: "Boards",
    description: "Open writing and project boards.",
    path: "00 Dashboards/Boards.md",
  },
];

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
      {
        icon: "list-checks",
        label: "Today’s tasks",
        description: "Open the task recommendation dashboard.",
        path: "00 Dashboards/Task Dashboard.md",
      },
      {
        icon: "activity",
        label: "Habits",
        description: "Review current habit consistency.",
        path: "00 Dashboards/Habit Canvas.md",
      },
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
        icon: "folder-kanban",
        label: "Projects",
        description: "Review active projects and quarter alignment.",
        path: "00 Dashboards/Projects Dashboard.md",
      },
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
    actions: [
      {
        icon: "compass",
        label: "EX3C AgendA",
        description: "Return to the whole-life overview.",
        path: "00 Dashboards/Dashboard.md",
      },
      {
        icon: "list-checks",
        label: "Task recommendations",
        description: "Review due, scheduled, priority, and discuss tasks.",
        path: "00 Dashboards/Task Dashboard.md",
      },
      {
        icon: "folder-kanban",
        label: "Project momentum",
        description: "Find active projects that need a next action.",
        path: "00 Dashboards/Projects Dashboard.md",
      },
      {
        icon: "activity",
        label: "Habit signals",
        description: "See consistency alongside the days that explain it.",
        path: "00 Dashboards/Habit Canvas.md",
      },
    ],
  },
  review: {
    eyebrow: "Evidence over memory",
    title: "Review",
    description:
      "Look back across days and quarters before deciding what should change next.",
    actions: [
      {
        icon: "line-chart",
        label: "Daily questions",
        description: "Review effort scores and trends.",
        path: "00 Dashboards/Daily Questions.md",
      },
      {
        icon: "activity",
        label: "Habit canvas",
        description: "Review streaks, gaps, and completion.",
        path: "00 Dashboards/Habit Canvas.md",
      },
      PERIOD_ACTIONS[1],
      PERIOD_ACTIONS[2],
      PERIOD_ACTIONS[3],
      {
        icon: "compass",
        label: "Whole-life review",
        description: "Open the Dashboard and life wheel.",
        path: "00 Dashboards/Dashboard.md",
      },
    ],
  },
  projects: {
    eyebrow: "Outcomes with context",
    title: "Projects",
    description:
      "Keep outcomes, next actions, people, notes, and quarter commitments together.",
    actions: [
      {
        icon: "layout-dashboard",
        label: "Projects dashboard",
        description: "Review all active projects.",
        path: "00 Dashboards/Projects Dashboard.md",
      },
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
        icon: "messages-square",
        label: "Discuss queue",
        description: "Open tasks grouped by person and discussion context.",
        path: "00 Dashboards/Task Dashboard.md",
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
      {
        icon: "columns-3",
        label: "Creative boards",
        description: "Open every writing pipeline.",
        path: "00 Dashboards/Boards.md",
      },
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
      {
        icon: "pen-tool",
        label: "Writing pipelines",
        description: "Use the library in active creative work.",
        path: "00 Dashboards/Boards.md",
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
        icon: "sun",
        label: "What matters today",
        description: "Open the EX3C AgendA brief and daily context.",
        path: "00 Dashboards/Dashboard.md",
      },
      {
        icon: "list-checks",
        label: "Task triage",
        description: "Open the task dashboard and its AI workflow.",
        path: "00 Dashboards/Task Dashboard.md",
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
const LAYOUT_SEED_PATH = "Prototypes/EX3C Agenda Layout/Layout.md";
// The name shown in the app (rail, header, tab title). You can change it in Configure; it is saved in the layout note.
const DEFAULT_APP_NAME = "EX3C AgendA";
// Your own widgets: every .js file in this folder is a DataviewJS view that shows up in the Widgets panel.
const USER_WIDGET_DIR = "Meta/widgets";
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
  "desc": "Today, 4 captures, Today's tasks, Habits.",
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
  "desc": "Today, This week, This quarter, Retreat, Projects, Ideal week.",
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
  "id": "focus.actions",
  "label": "Focus shortcuts",
  "desc": "EX3C AgendA, Task recommendations, Project momentum, Habit signals.",
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
  "desc": "Daily questions, Habit canvas, This week, This quarter, Retreat, Whole-life review.",
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
  "desc": "Projects dashboard, Projects board, Capture an idea, New project, Quarter plan.",
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
  "desc": "New person, Discuss queue, Search people.",
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
  "desc": "Creative boards, 3 idea captures, 3 new drafts.",
  "from": "Create"
 },
 {
  "id": "library.shelf",
  "label": "Library shelf",
  "desc": "Typed library notes, filtered by type and status, with local covers.",
  "from": "Library"
 },
 {
  "id": "library.actions",
  "label": "Library shortcuts",
  "desc": "New book note, Search the library, Writing pipelines.",
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
  "desc": "Open assistant, What matters today, Task triage, Setup and permissions.",
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
  "from": "Prototype"
 },
 {
  "id": "proto.sequence",
  "label": "Project steps",
  "desc": "Pick projects; see each as Gantt charts (one per heading) or as numbered steps with the next step and time left.",
  "from": "Prototype"
 },
 {
  "id": "proto.capture",
  "label": "Quick capture box",
  "desc": "Type a task the way you say it; dates, times, length, priority and project become task fields.",
  "from": "Prototype"
 },
 {
  "id": "proto.projectboard",
  "label": "Projects board",
  "desc": "Every project note as a card in the column of its status (Idea, Active, Paused, Done); drag or pick a status to change it; + Idea makes a new project note.",
  "from": "Prototype"
 },
 {
  "id": "proto.workschedule",
  "label": "Work schedule",
  "desc": "Your working hours per weekday and your commute: blocks in the planner that tasks are planned around, also written to 10 Areas/Work/Work schedule for Day Planner.",
  "from": "Prototype"
 },
 {
  "id": "proto.birthdays",
  "label": "Birthdays",
  "desc": "Coming birthdays from the birthday property of your people notes, with the age they turn; Present adds a task a week before.",
  "from": "Prototype"
 },
 {
  "id": "proto.triage",
  "label": "Inbox to sort",
  "desc": "Every task waiting in the inbox with three buttons: Today (⏳ today), Soon (moves it under ## Soon, to plan within a month), Eventually (moves it under ## Eventually).",
  "from": "Prototype"
 },
 {
  "id": "proto.checklists",
  "label": "Checklists",
  "desc": "Reusable checklists (packing list, routines): progress, tick items, Reset to untick them for next time.",
  "from": "Prototype"
 },
 {
  "id": "proto.courses",
  "label": "Courses",
  "desc": "Each course: exam countdown, next deadline, progress, this week's study time; then study deadlines in the next four weeks.",
  "from": "Prototype"
 },
 {
  "id": "proto.modules",
  "label": "Optional modules",
  "desc": "Remove parts of the standard vault you do not use (wiki, retreats, writing, prompts and AI, examples); shows the list and moves it to .trash.",
  "from": "Prototype"
 },
 {
  "id": "proto.purchases",
  "label": "Purchases",
  "desc": "Every priced task across projects, grouped by shop.",
  "from": "Prototype"
 }
];
const WIDGET_BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));
const DEFAULT_LAYOUT = {"tabs": [{"id": "home", "label": "Home", "widgets": ["proto.capture", "proto.triage", "home.setup", "today.attention", "proto.planner", "proto.checklists"]}, {"id": "today", "label": "Check-in", "icon": "moon", "widgets": ["today.glance", "today.actions"]}, {"id": "projects", "label": "Projects", "widgets": ["proto.projectboard", "proto.sequence", "proto.purchases", "projects.actions"]}, {"id": "work", "label": "Work", "area": "work", "widgets": ["today.attention", "proto.workschedule", "proto.planner", "proto.sequence", "projects.pulse"]}, {"id": "study", "label": "Study", "area": "study", "widgets": ["proto.courses", "today.attention", "proto.planner", "proto.sequence"]}, {"id": "personal", "label": "Personal", "area": "personal", "widgets": ["today.attention", "proto.planner", "proto.sequence", "proto.purchases"]}, {"id": "people", "label": "People", "widgets": ["people.directory", "proto.birthdays", "people.discuss", "people.actions"]}, {"id": "library", "label": "Library", "widgets": ["library.shelf", "library.actions"]}, {"id": "review", "label": "Review", "widgets": ["review.week", "review.effort", "review.habits", "review.areas", "review.calendar", "plan.horizons", "review.actions"]}, {"id": "ai", "label": "AI", "widgets": ["ai.control", "ai.diagram", "ai.system", "ai.actions", "ai.principle"]}]};
// Widgets every layout saved before 21-10-2026 already knew about (the default of that time, minus the capture box,
// which never reached saved layouts). A widget added to the default later is put on the saved layout's matching tab once.
const LEGACY_KNOWN = ["ai.actions", "ai.control", "ai.diagram", "ai.principle", "ai.system", "brain.graph", "focus.actions", "focus.commitments", "focus.feed", "focus.groups", "home.brain", "home.capture", "home.hero", "home.horizons", "home.now", "home.setup", "home.signals", "library.actions", "library.shelf", "people.actions", "people.directory", "people.discuss", "plan.actions", "plan.horizons", "projects.actions", "projects.pulse", "proto.checklists", "proto.courses", "proto.planner", "proto.projectboard", "proto.purchases", "proto.sequence", "review.actions", "review.areas", "review.calendar", "review.effort", "review.habits", "review.week", "today.actions", "today.attention", "today.glance"];
const SIDE_WIDGETS = new Set(["home.brain"]);
// Areas: a tab can be tied to one. A task belongs to an area by its #work/#study/#personal tag,
// otherwise by the area property of the note it lives in (for example a project note's area: study).
const AREAS = ["work", "study", "personal"];
// The AI module counts as on while either of these exists (the Optional modules widget removes and restores them).
const AI_MODULE_PATHS = ["Prompts", "00 Dashboards/Assistant.md"];
// Optional modules the workflow canvas shows: each counts as removed when none of its paths are left.
const MAP_MODULE_PATHS = { ai: AI_MODULE_PATHS, retreats: ["02 Retreats"], writing: ["06 Writing"] };
const WORKFLOW_CANVAS = "Guide/Workflow Map.canvas";
const AREA_TAG_RE = /(^|\s)#(work|study|personal)(?=\s|$)/i;
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
  for (const a of AREAS) areas[a] = HEX.test(t.areas?.[a]) ? t.areas[a] : DEFAULT_AREA_COLORS[a];
  return { preset, areas, areaTint: t.areaTint !== false };
}
function themeAccent(theme, area) {
  return area && theme.areas[area] ? theme.areas[area] : THEME_PRESETS[theme.preset] || THEME_PRESETS.default;
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
    const area = AREAS.includes(String(tab.area || "").toLowerCase()) ? String(tab.area).toLowerCase() : null;
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
    return tabs.find((tab) => tab.id === this.activeScreen) || tabs[0] || null;
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
    if (tab.area) header.createEl("p", { cls: "life-os-area-note", text: `Showing ${tab.area} only: tasks tagged #${tab.area}, and notes whose area property is ${tab.area}.` });
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
      chip.createSpan({ text: `${tab.label} (${tab.widgets.length})` });
      this.registerDomEvent(chip, "click", () => { this.activeScreen = tab.id; this.render(true); this.plugin.refreshPalettes(); });
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
      for (const value of ["", ...AREAS]) select.createEl("option", { text: value ? value[0].toUpperCase() + value.slice(1) : "Everything", attr: { value } });
      select.value = current.area || "";
      this.registerDomEvent(select, "change", () => void this.plugin.setTabArea(current.id, select.value || null));
      areaRow.createSpan({ text: "A tab with an area shows only that area's tasks, projects, and plans." });
      // the tab's colour: an area tab shares its area's colour (notes with that area use it too); any other tab
      // uses the theme unless you give it its own
      const colorRow = bar.createDiv({ cls: "life-os-edit-theme life-os-edit-color" });
      const themeNow = this.layout.theme || normalizeTheme(null);
      colorRow.createSpan({ text: `Colour for “${current.label}”:` });
      if (current.area) {
        const lab = colorRow.createEl("label", { text: `${current.area[0].toUpperCase()}${current.area.slice(1)} area colour ` });
        const input = lab.createEl("input", { attr: { type: "color", value: themeNow.areas[current.area], "aria-label": `${current.area} colour` } });
        this.registerDomEvent(input, "change", () => void this.plugin.setTheme({ areas: { ...themeNow.areas, [current.area]: input.value } }));
        this.colourDots(colorRow, themeNow.areas[current.area], (hex) => this.plugin.setTheme({ areas: { ...themeNow.areas, [current.area]: hex } }));
        colorRow.createSpan({ cls: "life-os-edit-note", text: `Shared by every ${current.area} page and note.` });
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
      const currentIcon = current.icon || TAB_ICONS[current.id] || { work: "briefcase", study: "graduation-cap", personal: "user" }[current.area] || "layout-grid";
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
        const ic = b.createSpan(); setIcon(ic, std.icon || TAB_ICONS[std.id] || { work: "briefcase", study: "graduation-cap", personal: "user" }[std.area] || "layout-grid");
        b.createSpan({ text: ` + ${std.label}` });
        this.registerDomEvent(b, "click", () => void this.plugin.restoreTab(std.id));
      }
    }
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
    const areaColors = bar.createDiv({ cls: "life-os-edit-theme" });
    areaColors.createSpan({ text: "Area colours (Work, Study, Personal pages and notes):" });
    for (const a of AREAS) {
      const lab = areaColors.createEl("label", { text: `${a[0].toUpperCase()}${a.slice(1)} ` });
      const input = lab.createEl("input", { attr: { type: "color", value: theme.areas[a], "aria-label": `${a} colour` } });
      this.registerDomEvent(input, "change", () => void this.plugin.setTheme({ areas: { ...theme.areas, [a]: input.value } }));
    }
    const tint = areaColors.createEl("label", { text: " Tint area pages " });
    const tintBox = tint.createEl("input", { attr: { type: "checkbox" } });
    tintBox.checked = theme.areaTint;
    this.registerDomEvent(tintBox, "change", () => void this.plugin.setTheme({ areaTint: tintBox.checked }));
    const resetColors = areaColors.createEl("button", { text: "Default colours" });
    resetColors.type = "button";
    this.registerDomEvent(resetColors, "click", () => void this.plugin.setTheme({ preset: "default", areas: { ...DEFAULT_AREA_COLORS }, areaTint: true }));
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
      case "library.shelf": return this.renderCollectionLive(parent, COLLECTIONS.library);
      case "brain.graph": return this.renderBrainEmbedded(parent);
      case "ai.control": return this.renderAiLive(parent, "checks");
      case "ai.diagram": return this.renderAiLive(parent, "diagram");
      case "ai.system": return this.renderSystemSummary(parent);
      case "ai.principle": return this.renderPrinciple(parent);
      case "capture.quick": return this.renderActionSection(parent, "Quick capture", "Journal, wins, gratitude, and tasks.", CAPTURE_MENU_ACTIONS.slice(0, 4), run);
      case "capture.ideas": return this.renderActionSection(parent, "Ideas", "Drop an idea onto a board.", CAPTURE_MENU_ACTIONS.slice(4, 8), run);
      case "capture.create": return this.renderActionSection(parent, "Create notes", "New notes from their templates.", CAPTURE_MENU_ACTIONS.slice(8), run);
      case "proto.planner": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Planner/views/planner", { folders: [""], area: ${JSON.stringify(this.tabArea())} });`);
      case "proto.sequence": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Task Properties/views/sequence", { allProjects: true, area: ${JSON.stringify(this.tabArea())} });`);
      case "proto.capture": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Quick Capture/views/capture", { area: ${JSON.stringify(this.tabArea())} });`);
      case "proto.projectboard": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Projects/views/board", { area: ${JSON.stringify(this.tabArea())} });`);
      case "proto.workschedule": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Planner/views/workschedule");`);
      case "proto.birthdays": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/People/views/birthdays");`);
      case "proto.triage": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Planner/views/triage");`);
      case "proto.checklists": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Checklists/views/checklists", { folder: "09 Checklists" });`);
      case "proto.courses": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Study/views/courses");`);
      case "proto.modules": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Modules/views/modules");`);
      case "proto.purchases": return this.renderDataviewWidget(parent, `await dv.view("Prototypes/Task Properties/views/purchases", { currency: "EUR", area: ${JSON.stringify(this.tabArea())} });`);
      default: {
        if (id.startsWith("user:")) return this.renderDataviewWidget(parent, `await dv.view(${JSON.stringify(`${USER_WIDGET_DIR}/${id.slice(5)}`)}, { area: ${JSON.stringify(this.tabArea())} });`);
        const moduleId = id.endsWith(".actions") ? id.slice(0, -".actions".length) : null;
        if (moduleId && MODULES[moduleId]) {
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
      setIcon(icon, tab.icon || TAB_ICONS[tab.id] || { work: "briefcase", study: "graduation-cap", personal: "user" }[tab.area] || "layout-grid");
      button.createSpan({ text: tab.label });
      button.addEventListener("click", () => {
        this.activeScreen = tab.id;
        this.render(true);
        this.plugin.refreshPalettes();
      });
      if (this.plugin.editing) makeDropTarget(this, this.plugin, button, (drag) => void this.plugin.moveWidget(drag.id, tab.id, null, drag.fromTab));
    }
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
    const high = raw.includes("⏫") || raw.includes("🔺");
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

  // Runs Meta/views/setup-checks.js (the Setup note's checks) through the Dataview API.
  async setupProgress(fm) {
    const REQUIRED = [0, 1, 2];
    const marked = new Set((Array.isArray(fm.setup_sections_done) ? fm.setup_sections_done : []).map(Number));
    const dv = this.app.plugins?.plugins?.dataview?.api;
    let rows = [];
    try {
      const src = await this.app.vault.adapter.read("Meta/views/setup-checks.js");
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
        item.createDiv({ cls: "life-os-palette-meta", text: onTabs.length ? `On ${onTabs.map((t) => t.label).join(", ")}` : widget.from === "Prototype" ? "Not on a tab · prototype" : "Not on a tab" });
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

    // Other plugins (Day Planner, Periodic Notes links) can create a journal note by
    // copying the template text without running Templater; run it once on such notes.
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (this.app.workspace.layoutReady && file instanceof TFile && file.extension === "md" && file.path.startsWith("01 Journal/")) {
        window.setTimeout(() => void this.renderRawTemplate(file), 600);
      }
    }));

    const widgetFolderChanged = (file, oldPath = "") => {
      if (![file.path, oldPath].some((p) => p.startsWith(`${USER_WIDGET_DIR}/`) && p.endsWith(".js"))) return;
      window.clearTimeout(this.userWidgetTimer);
      this.userWidgetTimer = window.setTimeout(() => void this.loadLayout().then(() => this.refreshViews()), 400);
    };
    for (const kind of ["create", "delete", "rename", "modify"]) this.registerEvent(this.app.vault.on(kind, widgetFolderChanged));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (file.path === LAYOUT_PATH && !this.savingLayout) void this.loadLayout().then(() => this.refreshViews());
    }));

    // one command per page, offered only while that page is in your layout (ids stay the same as before)
    const PAGE_COMMANDS = [["today", "Check-in"], ["projects", "Projects"], ["work", "Work"], ["study", "Study"], ["personal", "Personal"], ["people", "People"], ["library", "Library"], ["review", "Review"], ["plan", "Plan"], ["focus", "Focus"], ["create", "Create"], ["ai", "AI"]];
    for (const [id, label] of PAGE_COMMANDS) {
      this.addCommand({
        id: `open-${id}`,
        name: `Open EX3C AgendA ${label}`,
        checkCallback: (checking) => {
          if (!this.layout?.tabs?.some((t) => t.id === id) || (id === "ai" && !this.aiOn())) return false;
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
    if (!api?.executeJs || !this.app.vault.getAbstractFileByPath("Prototypes/Calendar/views/ics.js")) return;
    const host = document.createElement("div"), component = new Component();
    component.load();
    try { await api.executeJs(`await dv.view("Prototypes/Calendar/views/ics", { refresh: ${force ? "\"all\"" : "\"stale\""} })`, host, component, LAYOUT_PATH); }
    catch (error) { console.warn("EX3C AgendA: calendar refresh", error); }
    finally { window.setTimeout(() => component.unload(), 60000); }
  }

  async syncWorkNote() {
    const api = this.app.plugins?.plugins?.dataview?.api;
    if (!api?.executeJs || !this.app.vault.getAbstractFileByPath("Prototypes/Planner/views/worknote.js")) return;
    this.workNoteDay = moment().format("YYYY-MM-DD");
    const host = document.createElement("div"), component = new Component();
    component.load();
    try { await api.executeJs(`await dv.view("Prototypes/Planner/views/worknote")`, host, component, LAYOUT_PATH); }
    catch (error) { console.warn("EX3C AgendA: work schedule note", error); }
    finally { window.setTimeout(() => component.unload(), 10000); }
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

  widgetShown(id) { return !id.startsWith("ai.") || this.aiOn(); }
  tabShown(tab) { return tab.id !== "ai" || this.aiOn(); }

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
    for (const path of [LAYOUT_PATH, LAYOUT_SEED_PATH]) {
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
    if (on) {
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
