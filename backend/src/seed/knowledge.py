"""Seeded document collections for "Ask your documents" (§44).

Real PDFs, drawn here with reportlab, so the preview opens a genuine document
and a citation's page and highlight land on the passage it quotes. Because
this module draws every paragraph it knows exactly where each one sits, so the
passages are stored with exact boxes without running the converter — a fresh
`make reseed` needs no Docling service. Embeddings go through the gateway like
any upload (or the deterministic fake with no key); with neither, the passages
are still found by full-text search.

`--sync-knowledge` adds whatever is missing to a running database and leaves
everything else — including collections somebody made — alone.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from src.core.clock import now

PAGE_W, PAGE_H = 595.0, 842.0
MARGIN = 64.0
BODY_W = PAGE_W - 2 * MARGIN


@dataclass(frozen=True)
class Doc:
    name: str
    title: str
    #: (heading, [paragraphs]) in reading order.
    sections: tuple[tuple[str, tuple[str, ...]], ...]


HANDBOOK = Doc("Employee Handbook 2026.pdf", "Employee Handbook 2026", (
    ("Working hours", (
        "Core hours are 10:00 to 16:00 local time, Monday to Friday. Outside core hours people plan their own day, "
        "provided their team can reach them and meetings are not booked before 09:00 or after 17:30.",
        "Overtime must be approved in advance by your line manager and is compensated as time off within three months. "
        "Overtime that has not been approved in writing cannot be claimed later.",
    )),
    ("Remote work", (
        "Employees may work remotely up to three days a week. Teams agree on one shared office day, which is Tuesday "
        "unless the team lead records another day in the team charter.",
        "Working from another country is allowed for up to 20 working days per calendar year and needs HR approval at "
        "least two weeks before travel, because of tax and insurance obligations.",
        "The company pays a home-office allowance of 45 EUR per month, added to the payroll automatically for "
        "everyone on a hybrid or remote contract.",
    )),
    ("Annual leave", (
        "Full-time employees receive 26 days of paid annual leave per year, plus public holidays of the country they "
        "are employed in. Part-time employees receive leave pro rata.",
        "Up to 5 unused days may be carried over to the next year and must be taken before 31 March; anything above "
        "that expires. Leave requests longer than two weeks need four weeks' notice.",
        "Parental leave is 20 weeks at full pay for the primary carer and 6 weeks at full pay for the second parent, "
        "and can be taken any time within the child's first 18 months.",
    )),
    ("Travel and expenses", (
        "Economy class is required for flights under six hours; premium economy is allowed for longer flights. Rail "
        "is preferred over flying for trips under four hours door to door.",
        "Hotels may cost at most 180 EUR per night in capital cities and 140 EUR per night elsewhere, breakfast "
        "included. The daily meal allowance is 55 EUR.",
        "Expense claims must be submitted in the finance tool within 30 days of the end of the trip, with an itemised "
        "receipt for every amount above 10 EUR. Late claims need the approval of a director.",
    )),
    ("Equipment", (
        "Every employee receives a laptop, a headset and a monitor. Equipment is replaced every four years, or "
        "earlier when the IT service desk confirms a fault that cannot be repaired.",
        "Lost or stolen equipment must be reported to the IT service desk within 24 hours so that the device can be "
        "locked and wiped remotely.",
    )),
))

SECURITY = Doc("Information Security Policy.pdf", "Information Security Policy", (
    ("Scope", (
        "This policy applies to every employee, contractor and partner with access to company systems or data, on "
        "company devices and on personal devices used for work.",
    )),
    ("Passwords and sign-in", (
        "Passwords must be at least 14 characters long and must not be reused across services. A password manager "
        "is provided to everyone and is the only approved place to store work credentials.",
        "Multi-factor authentication is mandatory for email, the VPN, source control and every system that holds "
        "customer data. Hardware security keys are required for administrators.",
    )),
    ("Data classification", (
        "Data is classified as Public, Internal, Confidential or Restricted. Customer personal data and payment data "
        "are always Restricted and may only be stored in the approved production systems.",
        "Confidential and Restricted data must never be pasted into external AI tools or personal cloud storage. "
        "Use the company's approved AI gateway, which does not retain prompts.",
    )),
    ("Incident reporting", (
        "Suspected security incidents, including phishing emails that were clicked, must be reported to the security "
        "team within one hour through the #security-incidents channel or by calling the on-call number.",
        "Do not try to investigate an incident yourself and do not delete evidence. The security team leads every "
        "investigation and decides when customers must be notified.",
    )),
    ("Access reviews", (
        "Managers review the access rights of their team every quarter. Access that is no longer needed is removed "
        "within five working days of the review.",
        "When somebody leaves, their accounts are disabled on their last working day by 18:00, and shared "
        "credentials they knew are rotated within 48 hours.",
    )),
))

PLAYBOOK = Doc("Customer Support Playbook.pdf", "Customer Support Playbook", (
    ("Response targets", (
        "First response targets by priority: Critical within 30 minutes, 24 hours a day; High within 2 business hours; "
        "Medium within 8 business hours; Low within 2 business days.",
        "Resolution targets: Critical within 4 hours, High within 1 business day, Medium within 3 business days and "
        "Low within 10 business days. The clock pauses while we wait for the customer.",
    )),
    ("Escalation", (
        "A Critical ticket is escalated to the on-call engineer immediately and to the support manager if it is not "
        "acknowledged within 15 minutes.",
        "Any ticket that has breached its resolution target is reviewed in the daily stand-up, and the account "
        "manager is informed for customers on Enterprise plans.",
    )),
    ("Refunds and credits", (
        "Agents may issue service credits of up to 10% of the monthly fee without approval. Credits above that, and "
        "every refund, need the support manager's approval.",
        "Refunds are only possible within 30 days of the invoice date. After that, a credit on the next invoice is "
        "offered instead.",
    )),
    ("Tone of voice", (
        "Write the way you would speak to a colleague: clear, warm and specific. Say what will happen next and when, "
        "and never close a ticket without confirming the customer agrees it is solved.",
    )),
))

RELEASE = Doc("Nucleus 4.2 Release Notes.pdf", "Nucleus 4.2 Release Notes", (
    ("Highlights", (
        "Version 4.2 introduces Ask your documents, which answers questions from uploaded files with citations to the "
        "page, and generated Insights that turn a question about your records into a small dashboard.",
        "Dashboards can now hold insight widgets, which refresh their data every time the dashboard is opened.",
    )),
    ("Improvements", (
        "The kanban board keeps a hand-made order within each lane, and exports of more than 50,000 rows run in the "
        "background with a notification when the file is ready.",
        "Search results load about 40% faster on large tenants because counts and facets are now computed in a "
        "single query.",
    )),
    ("Known issues", (
        "Scanned PDFs without a text layer are read with OCR, which can take several minutes for long documents. "
        "Very large spreadsheets may be summarised rather than read cell by cell.",
    )),
))

ONBOARDING_MD = """# New starter onboarding

A checklist for the first two weeks. Your buddy is named in the welcome email.

## Day one

Collect your laptop from the IT service desk on the second floor, set up the password manager, and enable
multi-factor authentication before signing in to anything else.

## First week

Read the Employee Handbook and the Information Security Policy, and complete the security awareness course
in the learning portal by Friday of your first week.

## Second week

Shadow two customer calls with your buddy and agree your 90-day goals with your manager in a one-to-one.
"""

#: (collection name, description, scope, owner username, members, color, documents)
COLLECTIONS: tuple[tuple[str, str, str, str, tuple[str, ...], str, tuple[Any, ...]], ...] = (
    ("Company policies", "The handbook and the security policy every employee is bound by.",
     "PUBLIC", "admin", (), "#2457D6", (HANDBOOK, SECURITY)),
    ("Support knowledge base", "How the support team works: targets, escalation, refunds and onboarding.",
     "SHARED", "manager", ("operator", "analyst", "admin"), "#0E9F6E", (PLAYBOOK, ("New starter onboarding.md", ONBOARDING_MD))),
    ("Product updates", "Release notes, for answering 'when did that change?'.",
     "PRIVATE", "admin", (), "#7C3AED", (RELEASE,)),
)

#: Questions already asked, so the page opens on a conversation: (collection, username, question, answer).
QUESTIONS = (
    ("Company policies", "admin", "How much can I spend on a hotel?",
     "Hotels may cost at most **180 EUR per night** in capital cities and **140 EUR** elsewhere, breakfast "
     "included [{hotel}]. Claims must be submitted within 30 days of the trip [{claims}]."),
    ("Company policies", "admin", "How many days can I work from another country?",
     "Up to **20 working days per calendar year**, with HR approval at least two weeks before you travel [{abroad}]."),
)


def render(doc: Doc) -> tuple[bytes, list[dict[str, Any]], int]:
    """Draw the PDF and return it with its sections (and their boxes) and page count."""
    from reportlab.lib.utils import simpleSplit
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(PAGE_W, PAGE_H))
    pdf.setTitle(doc.title)
    sections: list[dict[str, Any]] = []
    page, y = 1, MARGIN

    def box(top: float, height: float, width: float) -> dict[str, Any]:
        return {"page": page, "x": round(MARGIN / PAGE_W, 4), "y": round(top / PAGE_H, 4),
                "w": round(width / PAGE_W, 4), "h": round(height / PAGE_H, 4)}

    def new_page() -> None:
        nonlocal page, y
        pdf.setFont("Helvetica", 8)
        pdf.drawString(MARGIN, 32, f"{doc.title} · page {page}")
        pdf.showPage()
        page, y = page + 1, MARGIN

    pdf.setFont("Helvetica-Bold", 22)
    pdf.drawString(MARGIN, PAGE_H - y - 22, doc.title)
    sections.append({"kind": "text", "text": doc.title, "heading_path": [doc.title],
                     "page_from": 1, "page_to": 1, "boxes": [box(y, 28, BODY_W * 0.7)]})
    y += 52
    for index, (heading, paragraphs) in enumerate(doc.sections):
        # A new page every two sections, so even a short policy has pages to cite.
        if index and index % 2 == 0:
            new_page()
        if y > PAGE_H - 160:
            new_page()
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(MARGIN, PAGE_H - y - 14, heading)
        path = [doc.title, heading]
        sections.append({"kind": "text", "text": heading, "heading_path": path,
                         "page_from": page, "page_to": page, "boxes": [box(y, 18, BODY_W * 0.5)]})
        y += 28
        for paragraph in paragraphs:
            lines = simpleSplit(paragraph, "Helvetica", 10.5, BODY_W)
            height = len(lines) * 15
            if y + height > PAGE_H - MARGIN:
                new_page()
            pdf.setFont("Helvetica", 10.5)
            top = y
            for line in lines:
                pdf.drawString(MARGIN, PAGE_H - y - 11, line)
                y += 15
            sections.append({"kind": "text", "text": paragraph, "heading_path": path,
                             "page_from": page, "page_to": page, "boxes": [box(top - 2, height + 4, BODY_W)]})
            y += 10
        y += 12
    pdf.setFont("Helvetica", 8)
    pdf.drawString(MARGIN, 32, f"{doc.title} · page {page}")
    pdf.save()
    return buffer.getvalue(), sections, page


def seed(session, *, store=None) -> dict[str, int]:
    """Create the seeded collections that are missing. Idempotent."""
    from src.core import storage
    from src.models.content import FileObject, Folder
    from src.models.identity import User
    from src.models.knowledge import KnowledgeCollection, KnowledgeDocument
    from src.models.personal import ResourceShare
    from src.services.knowledge import ingest as ingest

    users = {u.username: u for u in session.scalars(
        select(User).where(User.username.in_(("admin", "manager", "operator", "analyst", "user"))))}
    if "admin" not in users:
        return {"collections": 0, "documents": 0, "skipped": "no personas"}
    store = store or storage.for_config()
    anchor = now()
    made = documents = 0

    root = session.scalars(select(Folder).where(Folder.path == "/Knowledge", Folder.deleted_at.is_(None))).first()
    if root is None:
        root = Folder(name="Knowledge", path="/Knowledge", owner_id=users["admin"].id,
                      organization_id=users["admin"].organization_id, is_shared=True, color="#7C3AED")
        session.add(root)
        session.flush()

    for offset, (name, description, scope, owner_name, members, color, docs) in enumerate(COLLECTIONS):
        owner = users.get(owner_name) or users["admin"]
        exists = session.scalars(select(KnowledgeCollection).where(
            KnowledgeCollection.name == name, KnowledgeCollection.owner_id == owner.id,
            KnowledgeCollection.deleted_at.is_(None))).first()
        if exists is not None:
            continue
        created = anchor - timedelta(days=24 - offset * 5)
        folder = session.scalars(select(Folder).where(Folder.path == f"/Knowledge/{name}",
                                                      Folder.deleted_at.is_(None))).first()
        if folder is None:
            folder = Folder(name=name, path=f"/Knowledge/{name}", parent_id=root.id, owner_id=owner.id,
                            organization_id=owner.organization_id)
            session.add(folder)
            session.flush()
        collection = KnowledgeCollection(name=name, description=description, scope=scope, color=color,
                                         owner_id=owner.id, organization_id=owner.organization_id,
                                         folder_id=folder.id, created_at=created, updated_at=created)
        session.add(collection)
        session.flush()
        for member in members:
            if member in users and users[member].id != owner.id:
                session.add(ResourceShare(resource_type="knowledge_collection", resource_id=str(collection.id),
                                          user_id=users[member].id, shared_by_id=owner.id, permission="VIEW"))
        made += 1

        for position, doc in enumerate(docs):
            if isinstance(doc, Doc):
                filename, (body, sections, pages) = doc.name, render(doc)
                parsed = ingest.Parsed(
                    sections=[ingest.Section(**s) for s in sections], pages=pages,
                    outline=[{"title": s["text"], "page": s["page_from"]} for s in sections
                             if len(s["heading_path"]) and s["text"] == s["heading_path"][-1]],
                    warnings=[], parser="seed")
                content_type = "application/pdf"
            else:
                filename, text = doc
                body = text.encode()
                parsed = ingest.parse_text(body, "md")
                content_type = "text/markdown"
            key = storage.key_for("files", "knowledge", f"{uuid4().hex}.{storage.extension_of(filename)}")
            stored = store.put(key, body, content_type=content_type)
            when = created + timedelta(hours=2 + position)
            file = FileObject(name=filename, extension=storage.extension_of(filename), mime_type=content_type,
                              kind="DOCUMENT", size_bytes=stored.size_bytes, checksum=stored.checksum,
                              storage_key=key, folder_id=folder.id, owner_id=owner.id,
                              organization_id=owner.organization_id, status="READY", visibility="PRIVATE",
                              created_at=when, updated_at=when)
            session.add(file)
            session.flush()
            document = KnowledgeDocument(collection_id=collection.id, file_id=file.id, status="READY",
                                         added_by_id=owner.id, started_at=when, ingested_at=when,
                                         created_at=when, updated_at=when)
            session.add(document)
            session.flush()
            ingest.store(session, document, parsed)
            documents += 1

    session.flush()
    _questions(session, users)
    return {"collections": made, "documents": documents}


def _questions(session, users) -> None:
    from src.models.knowledge import KnowledgeCollection, KnowledgeQuestion
    from src.services.knowledge import collections as knowledge

    thread = uuid4()
    for index, (collection_name, username, question, answer) in enumerate(QUESTIONS):
        user = users.get(username)
        collection = session.scalars(select(KnowledgeCollection).where(
            KnowledgeCollection.name == collection_name, KnowledgeCollection.deleted_at.is_(None))).first()
        if user is None or collection is None:
            continue
        if session.scalar(select(KnowledgeQuestion.id).where(KnowledgeQuestion.collection_id == collection.id,
                                                             KnowledgeQuestion.question == question)):
            continue
        sources = knowledge.search(session, [collection.id], question + " " + answer, limit=8)
        wanted = {"hotel": "180 EUR", "claims": "30 days of the end", "abroad": "20 working days"}
        numbers = {}
        for key, phrase in wanted.items():
            hit = next((s for s in sources if phrase in s["text"]), None)
            numbers[key] = hit["n"] if hit else 99
        text, citations = knowledge.cite(answer.format(**numbers), sources)
        when = now() - timedelta(days=3, minutes=40 - index * 7)
        session.add(KnowledgeQuestion(collection_id=collection.id, user_id=user.id, thread_id=thread,
                                      question=question, answer=text, citations=citations,
                                      status="ANSWERED" if citations else "NO_ANSWER",
                                      model="seed", created_at=when, updated_at=when))
        collection.last_asked_at = when
    session.flush()


def seed_safely(session) -> dict[str, Any]:
    """`seed`, inside a savepoint: no object storage means no collections, not no seed."""
    from framework.commons.logger import logger as log

    try:
        with session.begin_nested():
            return seed(session)
    except Exception as exc:  # noqa: BLE001 - the rest of the dataset must still land
        log.warning(f"seed[knowledge] skipped: {type(exc).__name__}: {exc} — "
                    "run 'python -m src.seed --sync-knowledge' once storage is up", "yellow")
        return {"collections": 0, "documents": 0, "skipped": type(exc).__name__}
