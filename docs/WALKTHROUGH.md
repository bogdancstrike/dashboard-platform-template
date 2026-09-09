# Walking through the platform

*Generated from `scripts/render-walkthrough.py`. Every route is checked
against the router, every capability §77 asks for is covered by a stop, and
`frontend/e2e/walkthrough.spec.ts` walks all 18 of them in a
browser as the persona named — so a stop nobody can complete fails the
suite rather than the reader.*

Start the stack with `make up` and sign in at
[localhost:5174](http://localhost:5174). The five demo personas are
`admin`, `manager`, `operator`, `analyst` and `user`; each password is the
username. Sign in as the one each stop names — the platform looks different
to each of them on purpose, and being refused something is part of the tour.

The last stop is the point of the other 17: the same dataset,
held from five angles, with the links between them doing the work.

| # | Stop | Where | As |
| --- | --- | --- | --- |
| 1 | [The front page](#1-the-front-page) | `/dashboard` | `admin` |
| 2 | [A list built for its subject](#2-a-list-built-for-its-subject) | `/orders` | `manager` |
| 3 | [The queue somebody works](#3-the-queue-somebody-works) | `/tickets` | `operator` |
| 4 | [Everything, from one box](#4-everything-from-one-box) | `/find/global?q=migration` | `analyst` |
| 5 | [A question nobody anticipated](#5-a-question-nobody-anticipated) | `/explore` | `analyst` |
| 6 | [Asking for a number, and drawing it](#6-asking-for-a-number-and-drawing-it) | `/reports` | `analyst` |
| 7 | [A mailbox, as a master/detail page](#7-a-mailbox-as-a-master-detail-page) | `/mail` | `manager` |
| 8 | [The work itself](#8-the-work-itself) | `/tasks` | `operator` |
| 9 | [Files, and where the bytes are](#9-files-and-where-the-bytes-are) | `/files` | `manager` |
| 10 | [What the platform wants to tell you](#10-what-the-platform-wants-to-tell-you) | `/notifications` | `admin` |
| 11 | [Multi-step, because the decision has parts](#11-multi-step-because-the-decision-has-parts) | `/import` | `manager` |
| 12 | [Who am I, as the platform sees me](#12-who-am-i-as-the-platform-sees-me) | `/settings/security` | `user` |
| 13 | [Running the place](#13-running-the-place) | `/admin` | `admin` |
| 14 | [What happened, and who did it](#14-what-happened-and-who-did-it) | `/admin/audit` | `admin` |
| 15 | [Work the platform does on its own](#15-work-the-platform-does-on-its-own) | `/admin/jobs` | `admin` |
| 16 | [Whether it is healthy, and whether the data is](#16-whether-it-is-healthy-and-whether-the-data-is) | `/admin/quality` | `admin` |
| 17 | [The parts, and when to reach for each](#17-the-parts-and-when-to-reach-for-each) | `/showcase/components` | `admin` |
| 18 | [One thread, through five pages](#18-one-thread-through-five-pages) | `/tickets` | `manager` |

## 1. The front page

**Where** `/dashboard` · **As** `admin` · **Shows** dashboards  

**Do this.** Change the period. Click a bar in “Tickets by category”.

**Notice.** Every number is computed in PostgreSQL over the whole dataset, not in the browser over a page of it — and every chart can be read as a table and downloaded, because a chart you cannot get the numbers out of is a chart people screenshot into a spreadsheet. Clicking a bar opens the records behind it with the filter already applied.

**Also worth opening.** `/dashboards`

## 2. A list built for its subject

**Where** `/orders` · **As** `manager` · **Shows** data tables, entity management  

**Do this.** Narrow it by status, sort by total, change the page size, then export it.

**Notice.** Six entity pages share a contract and no layout: this one is a ledger with a running total, the fleet is a grid of health cards, the board is lanes. Filtering, sorting, paging and faceting all happen in SQL off one field declaration, the whole state is in the URL so the view can be pasted to a colleague, and the export writes the *question* rather than the page.

**Also worth opening.** `/customers`, `/devices`, `/projects`

## 3. The queue somebody works

**Where** `/tickets` · **As** `operator` · **Shows** entity management  

**Do this.** Open the top ticket. Re-triage it from the console without opening a form.

**Notice.** A support console rather than a record page: the clock leads, because the SLA is what decides what happens next, and the breach is the server's judgement rather than the browser's arithmetic. Every inline write carries the version it read, so an edit against a record somebody else has moved is refused and reloaded rather than silently applied over theirs.

## 4. Everything, from one box

**Where** `/find/global?q=migration` · **As** `analyst` · **Shows** search  

**Do this.** The term is in the address, so the search is shareable. Change it, then press Ctrl-K anywhere and type it again.

**Notice.** One endpoint searches every dataset the reader may see, ranked, with the matched words marked in the snippet. The palette is the same search plus the actions of the page you are on, which is why it is the fastest way to get anywhere in this application.

## 5. A question nobody anticipated

**Where** `/explore` · **As** `analyst` · **Shows** advanced filtering  

**Do this.** Build a nested rule — severity is critical AND (assignee is empty OR the SLA has breached) — then save it as a view.

**Notice.** The rule tree is compiled to SQL by the server, and the query inspector shows what it compiled to; the operators offered per field come from the same declaration that answers the query, so the builder cannot compose something the compiler rejects. A saved view is a saved search, so the thing the explorer saves is the thing the six lists reuse.

**Also worth opening.** `/search/saved`, `/compare`

## 6. Asking for a number, and drawing it

**Where** `/reports` · **As** `analyst` · **Shows** reporting  

**Do this.** Open a report, change its period, then open it in the chart builder and pick a different picture.

**Notice.** A chart is a saved analysis and so is a report — one store, one sharing model, one lifecycle. The builders refuse a picture the current question cannot feed *by name* (“Heatmap — needs a second grouping”) rather than hiding it, and a saved chart goes onto a dashboard as a reference: the widget names the report and runs its stored definition.

**Also worth opening.** `/analytics`, `/reports/builder`, `/charts/builder`, `/maps`

## 7. A mailbox, as a master/detail page

**Where** `/mail` · **As** `manager` · **Shows** email, master/detail  

**Do this.** Open a thread, reply, then use the keyboard: j and k move, Enter opens.

**Notice.** Three panes that each own their scroll, the list keyed on the thread rather than the message, and the reading pane addressable — a thread has a URL. This is the shape to copy when the work is *working through* a queue rather than finding one record in it.

**Also worth opening.** `/tickets`, `/explore`

## 8. The work itself

**Where** `/tasks` · **As** `operator` · **Shows** task management  

**Do this.** Drag a card between lanes, then do the same move from the keyboard. Tick a checklist item on the detail page.

**Notice.** The drag is optimistic and reconciled against the server's answer, so a refused move is explained rather than quietly snapped back — and every lane is counted and paged by the server, so the numbers are the whole dataset. Everything the mouse can do here the keyboard can do too.

**Also worth opening.** `/kanban`, `/calendar`, `/activity`

## 9. Files, and where the bytes are

**Where** `/files` · **As** `manager` · **Shows** file management  

**Do this.** Drop a file in. Watch the network tab: the bytes do not go through the API.

**Notice.** The browser uploads straight to object storage with a presigned URL and then tells the API the object is there, so a hundred-megabyte upload never occupies a worker. Previews are rendered from the same signed links, and a preview is deliberately not counted as a download.

## 10. What the platform wants to tell you

**Where** `/notifications` · **As** `admin` · **Shows** notifications  

**Do this.** Leave the page open and let something arrive. Then read the noticeboard.

**Notice.** Notifications arrive over a WebSocket the server owns, fanned out across workers through Redis so it works with more than one; the unread count in the header is the same store. An announcement that needs agreement holds its band until it is acknowledged, and says who has.

**Also worth opening.** `/announcements`

## 11. Multi-step, because the decision has parts

**Where** `/import` · **As** `manager` · **Shows** multi-step forms  

**Do this.** Upload a CSV, map its columns, read the sample check, then run it.

**Notice.** Nothing is written until the last step, and the check step is the point: it validates rows with the *same* function a form uses, so what the wizard accepts and what the API accepts cannot disagree. Compare it with the dashboard wizard, and with the modal that asks for a folder name — three sizes of decision, three shapes.

**Also worth opening.** `/dashboards`, `/showcase/templates`

## 12. Who am I, as the platform sees me

**Where** `/settings/security` · **As** `user` · **Shows** security settings  

**Do this.** Read the sessions. Revoke the others. Change the theme and the date format.

**Notice.** Sessions are the identity provider's, so revoking one really ends it rather than clearing a row; the security events are the ledger's own. Preferences are per person and applied by the formatters every rendered date goes through, so “09/06/2026” means the same thing on every page.

**Also worth opening.** `/settings/preferences`, `/profile`

## 13. Running the place

**Where** `/admin` · **As** `admin` · **Shows** administration  

**Do this.** Add a permission to a role and watch a control change for that role.

**Notice.** Roles are permission sets, the permissions are declared in one place in the backend, and `docs/RBAC.md` is *rendered* from that declaration rather than typed beside it. Every refusal in the product names the permission it wants, in the same sentence, and a control the reader may not use is disabled with the reason rather than hidden.

**Also worth opening.** `/admin/users`, `/admin/roles`, `/admin/groups`, `/admin/settings`, `/admin/tags`

## 14. What happened, and who did it

**Where** `/admin/audit` · **As** `admin` · **Shows** audit logs  

**Do this.** Filter by actor, open one entry, and read the before-and-after.

**Notice.** One ledger, written inside the same transaction as the change it records — so there is no state in which the change exists and the audit entry does not. Every record page's own history reads from it, which is why the two cannot disagree.

## 15. Work the platform does on its own

**Where** `/admin/jobs` · **As** `admin` · **Shows** background jobs  

**Do this.** Find a failed job and read its error. Retry it.

**Notice.** An export too large for a response becomes a job, and a job is a row with a status, an attempt count and its own error — visible rather than a log line somebody has to be told to grep for.

## 16. Whether it is healthy, and whether the data is

**Where** `/admin/quality` · **As** `admin` · **Shows** monitoring  

**Do this.** Read the findings, then open the rows behind one. Watch the log tail live.

**Notice.** Data quality is computed from the declarations rather than from a hand-kept list of rules, so a new field is checked the day it ships. The health page separates *liveness* from *readiness* and says what degrades to what: a dashboard that 503s because a cache is down is worse than a slow dashboard.

**Also worth opening.** `/admin/logs`, `/admin/health`, `/admin/integrations`, `/admin/api`

## 17. The parts, and when to reach for each

**Where** `/showcase/components` · **As** `admin` · **Shows** reusable components  

**Do this.** Read what the page says it is *not* showing, and why.

**Notice.** The component inventory and the page-layout gallery are both derived from the code — a hand-kept gallery is wrong by the third new page and then misleads everybody who reads it. Both say when each thing is the *wrong* answer, which is the half a pattern library usually omits.

**Also worth opening.** `/showcase/templates`

## 18. One thread, through five pages

**Where** `/tickets` · **As** `manager` · **Shows** entity management, data tables  

**Do this.** Open a ticket. Follow it to the customer who raised it, from there to their orders, export those, and find the export in the audit ledger.

**Notice.** This is the half of §77 that a feature list cannot demonstrate. The links are the application: a ticket knows its account, an account knows its orders, an export knows the question it answered, and the ledger knows who asked. Nothing here is a demo of a widget — every page is holding the same dataset from a different angle.

**Also worth opening.** `/customers`, `/orders`, `/exports`, `/admin/audit`

---

## What this leaves out

The error pages, deliberately: `/errors/404`, `/errors/403` and the rest are
reachable and worth two minutes, but a tour that ends on a 500 reads oddly.
The same goes for `/favorites` and `/find/relationships`, which are better
found by using the platform for an hour than by being pointed at.

For what exists rather than what to look at, `docs/features.md` maps every
section of the specification to its route and its endpoints. For why things
are built the way they are, the README's *decisions worth knowing* and the
notes at the top of each module.
