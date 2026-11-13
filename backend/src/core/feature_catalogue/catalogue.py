"""Every feature the platform can switch (data), and the entity grids."""

from __future__ import annotations

from src.core.feature_catalogue.model import Feature

ENTITY_GRIDS = tuple(f"/{entity}/grid" for entity in ("tasks", "projects", "tickets", "customers", "orders", "devices"))


FEATURES: tuple[Feature, ...] = (
    # ── Overview ────────────────────────────────────────────────────────
    Feature(
        "dashboard-builder", "Dashboard builder", "Compose your own dashboards from widgets.", "overview",
        routes=("/dashboards", "/dashboards/:id"), nav=("/dashboards",),
        components=("“Add to a dashboard” on reports, saved searches and insights", "The Dashboards door on Home"),
        endpoints=("/api/dashboards*",),
    ),
    Feature(
        "approvals", "Approvals inbox", "One inbox for timesheets, access requests, held changes and report publishing.",
        "overview",
        routes=("/approvals",), nav=("/approvals",),
        components=("Approvals badge in the menu", "“Request approval” on reports and access", "Approval hooks on record pages"),
        endpoints=("/api/approvals*",),
    ),
    Feature(
        "onboarding", "Onboarding checklist", "Per-role getting-started checklist, empty-state guides and sample data.",
        "overview",
        routes=("/onboarding",), nav=("/onboarding",),
        components=("Getting-started card on Home", "Empty-state guides with sample data"),
        endpoints=("/api/onboarding*",),
    ),
    # ── AI ──────────────────────────────────────────────────────────────
    Feature(
        "ai", "AI features", "Master switch for every feature that calls the language model.", "ai",
        components=("Everything in the AI group",),
    ),
    Feature(
        "ai-assistant", "AI assistant", "Chat with the assistant about your data, with tools and history.", "ai",
        requires=("ai",), routes=("/assistant", "/assistant/:conversationId"), nav=("/assistant",),
        components=("Assistant launcher in the header", "⌘J shortcut", "Command-palette entry “Ask the assistant”"),
        endpoints=("/api/assistant/conversations*", "/api/assistant/usage"),
    ),
    Feature(
        "ai-page-help", "AI page help", "“Ask about this page” and explain-this answers grounded in the page.", "ai",
        requires=("ai",),
        components=("“Ask about this page” in the header help menu", "Explain buttons on charts and KPIs"),
        endpoints=("/api/assistant/page-help*",),
    ),
    Feature(
        "ai-daily-brief", "AI daily brief", "A generated morning brief of what changed and what needs you.", "ai",
        requires=("ai",), components=("Daily brief card on Home",), endpoints=("/api/assistant/brief",),
    ),
    Feature(
        "ai-filters", "AI filters", "Describe a filter in words, or ask a question of a list.", "ai",
        requires=("ai",), components=("“Describe” and “Ask” controls in the Data Explorer and list pages",),
        endpoints=("/api/assistant/filters",),
    ),
    Feature(
        "ai-insights", "AI insights", "Generated insight cards and the insight dashboard widget.", "ai",
        requires=("ai",), routes=("/ai/insights",), nav=("/ai/insights",),
        components=("Insight dashboard widget kind",), endpoints=("/api/insights*",),
    ),
    Feature(
        "ai-documents", "Ask your documents", "Document collections with parsing, retrieval and cited answers.", "ai",
        requires=("ai",), routes=("/ai/documents",), nav=("/ai/documents",),
        endpoints=("/api/knowledge/*",), jobs=("knowledge.ingest",),
    ),
    Feature(
        "ai-summaries", "AI summaries", "Generated summaries of wiki pages and records.", "ai",
        requires=("ai",), stage="BETA", components=("“Summarise” on wiki pages",),
        endpoints=("/api/docs/pages/<uuid:page_id>/summary",),
    ),
    # ── Find ────────────────────────────────────────────────────────────
    Feature(
        "advanced-search", "Advanced search builder", "Nested condition builder on the Data Explorer and lists.", "find",
        components=("“Advanced” button and condition builder in the Data Explorer",),
    ),
    Feature(
        "saved-views", "Saved views", "Save, share and reopen searches and list views.", "find",
        routes=("/search/saved", "/search/saved/:searchId"),
        components=("Saved-search controls in the Data Explorer", "Save view buttons on lists"),
        endpoints=("/api/saved-searches*",),
    ),
    Feature(
        "global-search", "Global search", "Search every dataset at once.", "find",
        routes=("/find/global",), nav=("/find/global",), components=("Search results across datasets",),
        endpoints=("/api/search/global",),
    ),
    Feature(
        "relationships", "Relationships", "The relationship graph between records.", "find",
        routes=("/find/relationships",), nav=("/find/relationships",),
        components=("Relationships panel on record pages",), endpoints=("/api/relationships/*",),
    ),
    Feature(
        "catalog", "Data catalog", "Browse every dataset, its fields and owners.", "find",
        routes=("/find/catalog",), nav=("/find/catalog",), endpoints=("/api/catalog/*",),
    ),
    Feature(
        "favorites", "Favorites", "Star records and pages and find them again.", "find",
        routes=("/favorites",), nav=("/favorites",), components=("Star buttons on records and pages",),
        endpoints=("/favorites*",),
    ),
    # ── Analyse ─────────────────────────────────────────────────────────
    Feature(
        "analytics", "Analytics", "Ad-hoc analysis over every dataset.", "analyse",
        routes=("/analytics",), nav=("/analytics",), endpoints=("/api/analysis/*",),
    ),
    Feature(
        "reports", "Reports", "Saved reports and their runs.", "analyse",
        routes=("/reports",), nav=("/reports",), endpoints=("/api/reports*",),
    ),
    Feature(
        "report-builder", "Report builder", "Block-based report documents with charts and text.", "analyse",
        routes=("/reports/builder",), nav=("/reports/builder",), endpoints=("/api/report-documents*",),
    ),
    Feature(
        "report-scheduling", "Scheduled reports", "Email a report on a schedule.", "analyse", stage="BETA",
        requires=("reports",), components=("Schedule field in the report editor",),
        payload_rules=("POST/PUT /api/reports* with a `schedule` refuses",),
    ),
    Feature(
        "chart-builder", "Chart builder", "Build a chart from any dataset.", "analyse",
        routes=("/charts/builder",), nav=("/charts/builder",),
    ),
    Feature(
        "maps", "Maps", "Records on a map.", "analyse",
        routes=("/maps",), nav=("/maps",), endpoints=("/api/maps/*",),
    ),
    Feature(
        "anomaly-alerts", "Anomaly alerts", "Watch a metric and get told about spikes and drops.", "analyse",
        routes=("/alerts", "/alerts/:id"), nav=("/alerts",), endpoints=("/api/alerts/*",),
        jobs=("analytics.anomaly-watch",),
    ),
    Feature(
        "public-dashboards", "Public dashboard links", "Share a dashboard by link, with expiry and password.", "analyse",
        requires=("dashboard-builder",), components=("“Public link” button on dashboards",),
        endpoints=("/api/dashboards/<uuid:dashboard_id>/links*", "/public/dashboards/*"),
    ),
    # ── Work ────────────────────────────────────────────────────────────
    Feature(
        "kanban-board", "Kanban boards", "Drag-and-drop boards.", "work",
        routes=("/kanban",), nav=("/kanban",), endpoints=("/api/kanban/*",),
    ),
    Feature(
        "timeline", "Timeline / Gantt", "Projects and tasks on a timeline with dependencies.", "work",
        routes=("/timeline",), nav=("/timeline",),
        components=("Dependencies and scheduling on task pages",),
        endpoints=("/api/work/timeline", "/api/work/dependencies*", "/api/tasks/<uuid:task_id>/schedule"),
    ),
    Feature(
        "sprints", "Sprints", "Backlog, sprint planning, burndown and velocity.", "work",
        routes=("/sprints",), nav=("/sprints",), components=("Sprint and epic fields on tasks",),
        endpoints=("/api/work/sprints*", "/api/work/backlog*", "/api/work/velocity", "/api/work/epics"),
        jobs=("work.sprint-snapshots",),
    ),
    Feature(
        "recurring-tasks", "Recurring tasks & templates", "Repeat tasks on a schedule and start from templates.", "work",
        components=("Recurrence and “Save as template” on task pages", "Templates in the new-task form"),
        endpoints=(
            "/api/tasks/<uuid:task_id>/recurrence", "/api/tasks/<uuid:task_id>/save-as-template",
            "/api/work/templates*", "/api/work/scheduler/run",
        ),
        jobs=("work.recurring-tasks",),
    ),
    Feature(
        "workflows", "Workflows & automations", "Rules that react to record changes and schedules.", "work",
        routes=("/workflows",), nav=("/workflows",), endpoints=("/api/automations/*",),
        jobs=("automation.scheduler", "automation.record-triggers"),
    ),
    Feature(
        "workflow-canvas", "Workflow canvas", "The visual node-based workflow builder.", "work",
        requires=("workflows",), routes=("/workflows/:ruleId/canvas",),
        components=("“Open canvas” on workflows",),
        endpoints=(
            "/api/automations/rules/<uuid:rule_id>/graph", "/api/automations/rules/<uuid:rule_id>/publish",
            "/api/automations/rules/<uuid:rule_id>/restore", "/api/automations/rules/<uuid:rule_id>/test",
            "/api/automations/rules/<uuid:rule_id>/samples",
        ),
    ),
    Feature(
        "webhooks", "Webhooks", "Inbound webhook triggers and the outbound webhook action.", "work",
        stage="BETA", requires=("workflows",), components=("Webhook trigger and action in workflows",),
        endpoints=("/public/automations/hooks/*",),
        jobs=("automation.webhook-action",),
    ),
    Feature(
        "calendar", "Calendar", "Events, invitations and responses.", "work",
        routes=("/calendar",), nav=("/calendar",), endpoints=("/api/calendar/*",),
    ),
    Feature(
        "mail", "Mail", "The shared inbox.", "work",
        routes=("/mail",), nav=("/mail",), components=("Unread mail badge",), endpoints=("/api/mail/*",),
    ),
    Feature(
        "files", "Files", "Folders and documents.", "work",
        routes=("/files",), nav=("/files",),
        # Only the browser of the file store: uploads and downloads under
        # `/api/files/<id>` serve every other feature's attachments.
        endpoints=("/api/files/tree", "/api/files", "/api/files/folders*"),
    ),
    Feature(
        "time-tracking", "Time tracking", "Timers, timesheets and their approval.", "work",
        routes=("/time",), nav=("/time",),
        components=("Timer pill in the header", "Log time on tasks and tickets"),
        endpoints=("/api/time/*",),
    ),
    # ── Collaboration ───────────────────────────────────────────────────
    Feature(
        "chat", "Team chat", "Channels, direct messages, record threads, reactions and presence.", "collaboration",
        routes=("/chat", "/chat/:channelId"), nav=("/chat",),
        components=("Chat badge", "Reactions, typing and read state on record threads", "Presence dots"),
        endpoints=("/api/chat/*", "/api/comments/read", "/api/comments/typing", "/api/comments/<uuid:comment_id>/reactions"),
        live=("chat.channel", "typing", "thread.read", "presence"),
    ),
    Feature(
        "docs", "Docs & wiki", "Spaces and pages linked to records.", "collaboration",
        routes=("/docs", "/docs/:pageId"), nav=("/docs",), components=("Backlinks to docs on record pages",),
        endpoints=("/api/docs/*",),
    ),
    Feature(
        "meeting-notes", "Meeting notes", "Notes on calendar events with action items that become tasks.",
        "collaboration", requires=("docs",), components=("Meeting notes on calendar events",),
        endpoints=("/api/docs/meetings",),
    ),
    # ── Records ─────────────────────────────────────────────────────────
    Feature(
        "customer-health", "Customer health", "Weighted health score per customer, with trend.", "records",
        routes=("/customers/health",), nav=("/customers/health",), components=("Health tab on customer pages",),
        endpoints=("/api/customer-health*",), jobs=("analytics.customer-health",),
    ),
    Feature(
        "contracts", "Contracts & renewals", "Contracts pipeline, renewal calendar and forecast.", "records",
        routes=("/contracts", "/contracts/:id"), nav=("/contracts",), endpoints=("/api/contracts*",),
    ),
    Feature(
        "version-history", "Version history", "Field-level history of a record and point-in-time restore.", "records",
        components=("History / versions panel on record pages",),
        endpoints=("/api/records/<string:resource_type>/<uuid:record_id>/versions*",),
    ),
    Feature(
        "spreadsheet-grid", "Spreadsheet grid", "Bulk-edit a list as a grid, paste from Excel or CSV.", "records",
        routes=ENTITY_GRIDS, components=("“Grid” button on list pages",),
    ),
    Feature(
        "sla-policies", "SLA policies", "Per-priority targets, business hours and escalation.", "records",
        routes=("/admin/sla",), nav=("/admin/sla",), components=("SLA badges on tickets",),
        endpoints=("/api/sla/*",),
    ),
    Feature(
        "forms", "Forms builder", "Intake forms that create tickets and records.", "data",
        routes=("/admin/forms", "/admin/forms/:id"), nav=("/admin/forms",), endpoints=("/api/forms*",),
    ),
    Feature(
        "public-forms", "Public forms", "Forms anyone with the link can submit.", "data",
        requires=("forms",), components=("Public link on forms",), endpoints=("/public/forms/*",),
    ),
    # ── Data ────────────────────────────────────────────────────────────
    Feature(
        "csv-import", "Import", "Guided CSV import with column mapping.", "data",
        routes=("/import",), nav=("/import",), endpoints=("/imports*",),
    ),
    Feature(
        "exports", "Exports", "Queued exports of any list.", "data",
        routes=("/exports",), nav=("/exports",), components=("Export menus on lists",),
        endpoints=("/exports*", "/api/explorer/export"),
    ),
    Feature(
        "bulk-operations", "Bulk operations", "Multi-select actions on lists.", "data",
        components=("Tick boxes and the bulk bar on lists",),
        endpoints=("/api/records/<string:resource_type>/bulk*",),
    ),
    # ── Platform ────────────────────────────────────────────────────────
    Feature(
        "command-palette", "Command palette", "⌘K navigation and actions.", "platform",
        components=("⌘K palette", "Search button in the header"),
    ),
    Feature(
        "live-updates", "Live updates", "The live channel: instant notifications, chat and presence.", "platform",
        components=("“Live” chip in the header", "Instant delivery (falls back to polling)"),
        live=("*",),
    ),
    Feature(
        "impersonation", "User impersonation", "Administrators may act as another user.", "platform",
        stage="BETA", components=("“Impersonate” on user pages",),
        endpoints=("/admin/users/<uuid:user_id>/impersonate",),
    ),
    Feature(
        "live-log-stream", "Live log stream", "Tail system logs in the browser.", "platform",
        stage="BETA", components=("“Live tail” on System logs",), endpoints=("/admin/logs/tail",),
    ),
    Feature(
        "dark-mode", "Dark mode", "The dark colour scheme.", "platform",
        components=("Theme switch in the header", "Appearance item in the profile menu"),
    ),
    # ── Developers ──────────────────────────────────────────────────────
    Feature(
        "developer-portal", "Developer portal", "API reference, try-it console and API usage.", "developers",
        routes=("/developers", "/developers/:tab"), nav=("/developers", "/developers/console", "/developers/usage"),
        endpoints=("/api/developers/*",),
    ),
)
