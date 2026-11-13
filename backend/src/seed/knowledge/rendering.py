"""Seed data for knowledge: render."""

from __future__ import annotations

import io
from datetime import timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import select

from src.core.clock import now
from src.seed.knowledge.doc import (
    BODY_W,
    HANDBOOK,
    MARGIN,
    ONBOARDING_MD,
    PAGE_H,
    PAGE_W,
    PLAYBOOK,
    RELEASE,
    SECURITY,
    Doc,
)

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
