"""Seed data for knowledge: Doc."""

from __future__ import annotations

from dataclasses import dataclass

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
