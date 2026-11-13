"""Device, notification, mail and calendar vocabularies."""

from __future__ import annotations

from src.core.vocabulary.records import Vocabulary

DEVICE_KIND: Vocabulary = ("SENSOR", "GATEWAY", "CONTROLLER", "CAMERA", "METER", "BEACON")


DEVICE_STATUS: Vocabulary = (
    "ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE", "DECOMMISSIONED",
)


#: What a notification is *about*. `ALERT` is here because an automation
#: writes one when it fires (§49) — and it was missing from the filter
#: vocabulary for a while, which made every notification an automation had
#: sent unfilterable: present in the list, absent from the only control that
#: narrows it.
NOTIFICATION_CATEGORY: Vocabulary = (
    "MENTION", "ASSIGNMENT", "APPROVAL", "ALERT", "SYSTEM", "SECURITY", "REPORT",
)


#: Deliberately not `SEVERITY`. That vocabulary grades an *incident*
#: (MINOR…CRITICAL); this grades how loudly to say something, and the two have
#: only the last value in common.
NOTIFICATION_SEVERITY: Vocabulary = ("INFO", "WARNING", "CRITICAL")


#: Where a thread lives. `OUTBOX` is the honest folder for a message the
#: platform has written and nothing has transported: there is no mail transport
#: here, and calling it `SENT` would have the mailbox claim delivery it cannot
#: make. `TRASH` is a folder rather than a flag so "empty the bin" is one
#: query and a deleted thread is still recoverable until it is not.
EMAIL_FOLDER: Vocabulary = (
    "INBOX", "OUTBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH",
)


#: The folders the seed fills. `OUTBOX` and `TRASH` are reached by using the
#: product, and seeding them would be inventing history.
EMAIL_SEEDED_FOLDER: Vocabulary = ("INBOX", "SENT", "ARCHIVE", "DRAFTS", "SPAM")


EMAIL_PRIORITY: Vocabulary = ("LOW", "NORMAL", "HIGH")


EVENT_CATEGORY: Vocabulary = (
    "MEETING", "REVIEW", "DEADLINE", "TRAINING", "MAINTENANCE", "HOLIDAY",
)


EVENT_STATUS: Vocabulary = ("CONFIRMED", "TENTATIVE", "CANCELLED")


#: What a person has said about an invitation. `NEEDS_ACTION` is the state an
#: invitation starts in and is deliberately not "declined": an unanswered
#: invitation and a refused one are different facts about the same person.
EVENT_RESPONSE: Vocabulary = ("NEEDS_ACTION", "ACCEPTED", "TENTATIVE", "DECLINED")


#: The recurrence frequencies the expander understands. Stored on the event as
#: an RRULE-shaped document; anything outside this list is refused on write
#: rather than silently producing a series nobody sees.
EVENT_FREQUENCY: Vocabulary = ("DAILY", "WEEKLY", "MONTHLY")


USER_STATUS: Vocabulary = ("ACTIVE", "INVITED", "SUSPENDED", "DISABLED")


#: What happened the last time the platform tried to reach an integration.
#:
#: NOT_CONFIGURED is not really an outcome — it is a fact about the settings,
#: and `services/integrations` *derives* it rather than trusting the column.
#: The seed used to draw a status independently of the configuration and so
#: wrote it on rows that were fully configured; deriving it is what makes the
#: word impossible to contradict.
INTEGRATION_STATUS: Vocabulary = ("NOT_CONFIGURED", "DISCONNECTED", "CONNECTED", "ERROR")


#: The categories an integration can be filed under. A closed set because it
#: is the page's grouping, and a category spelled only in a seed row is one
#: the filter has never heard of.
INTEGRATION_CATEGORY: Vocabulary = (
    "MESSAGING", "ISSUE_TRACKING", "SOURCE_CONTROL", "CRM", "PAYMENTS",
    "EMAIL", "STORAGE", "ANALYTICS", "ALERTING", "IDENTITY",
)


#: What an API client is allowed to do right now.
#:
#: SUSPENDED is its own state rather than a flag on ACTIVE: "turned off for
#: now" and "gone for good" are the two answers somebody investigating an
#: outage needs to tell apart, and only one of them is reversible.
API_CLIENT_STATUS: Vocabulary = ("ACTIVE", "SUSPENDED", "REVOKED")


#: A credential's state, *derived* from its dates rather than read from its
#: column — a key whose `expires_at` passed last Tuesday is expired whatever
#: the column says. See `services/api_clients.credential_state`.
API_CREDENTIAL_STATE: Vocabulary = ("ACTIVE", "EXPIRED", "REVOKED")


#: A tenant's commercial tier, ordered smallest first — the order is the
#: meaning, so a page can render them as a scale rather than alphabetically.
ORG_TIER: Vocabulary = ("TRIAL", "STARTER", "STANDARD", "ENTERPRISE")


#: A tenant's lifecycle. Its own set rather than `CUSTOMER_STATUS`: those are
#: the same three words today, and an organisation is the *installation's own*
#: tenant while a customer is a record inside it — sharing the tuple would tie
#: two unrelated lifecycles together the first time either grew a state.
ORG_STATUS: Vocabulary = ("ACTIVE", "SUSPENDED", "ARCHIVED")


#: What a group is *for*, which is not what it grants.
#:
#: A closed set because the kind is a filter and a heading on
#: `/admin/groups`, and a kind typed into a seed row (which is where these
#: lived) is one the page's filter has never heard of.
GROUP_KIND: Vocabulary = ("TEAM", "OPERATIONAL", "GOVERNANCE", "BUSINESS")
