"""Log, job, import, sign-in and security vocabularies."""

from __future__ import annotations

from src.core.vocabulary.records import Vocabulary

#: Ordered by severity, quietest first, and *relied upon* to be: the log
#: viewer's "this level and worse" filter is a slice of this tuple, so the
#: order is the meaning and not a presentation choice.
LOG_LEVEL: Vocabulary = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


#: What a background job is for. The queue a job runs on is *not* a closed set
#: — a deployment adds queues — so it is faceted from the data instead.
JOB_KIND: Vocabulary = (
    "EXPORT", "IMPORT", "REPORT", "EMAIL", "MAINTENANCE", "SYNC", "REINDEX",
    # Reading a document into passages for "Ask your documents" (§44).
    "INGEST",
)


#: A job's lifecycle. RETRYING is deliberately its own state rather than a
#: flag on FAILED: "failed and will be tried again" and "failed and will not"
#: are the two answers an operator needs to tell apart at a glance.
JOB_STATUS: Vocabulary = (
    "QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED",
)


#: The states from which nothing more happens on its own. Retry is offered on
#: these and refused on the others, because retrying a running job is how one
#: job becomes two writing the same rows.
JOB_TERMINAL: Vocabulary = ("SUCCEEDED", "FAILED", "CANCELLED")


#: And the states a cancel can still reach.
JOB_CANCELLABLE: Vocabulary = ("QUEUED", "RUNNING", "RETRYING")


#: Where one run of the import wizard stands (§29).
#:
#: DRAFT and VALIDATED are the two the wizard moves between — a mapping change
#: sends a validated run back to DRAFT when it leaves nothing valid, because
#: "validated" has to mean "there is something to import". COMPLETED, FAILED
#: and CANCELLED are the three ways it ends, and they are kept apart because
#: the questions differ: what was written, what went wrong, and who stopped it.
IMPORT_STATUS: Vocabulary = (
    "DRAFT", "VALIDATED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED",
)


#: The states from which the wizard can still be worked on. A run in one of
#: these holds a copy of somebody's file, which is why the limit on how many a
#: person may have at once is expressed over this set rather than over rows.
IMPORT_OPEN: Vocabulary = ("DRAFT", "VALIDATED")


#: How a sign-in ended (§41).
#:
#: Two values and they are the page's whole point: a *failure* is what somebody
#: opens their security page to look for, and it must not be flattened into a
#: "recent activity" list where it reads as ordinary.
LOGIN_RESULT: Vocabulary = ("SUCCESS", "FAILURE")


#: How somebody proved who they were.
LOGIN_METHOD: Vocabulary = ("PASSWORD", "SSO", "MFA")


#: What one session is, derived rather than stored (§41).
#:
#: Three outcomes and they are not interchangeable: REVOKED is somebody's
#: decision, EXPIRED is time passing, ACTIVE is a live sign-in. Collapsing the
#: first two into "inactive" would hide the only one anybody acted on.
SESSION_STATE: Vocabulary = ("ACTIVE", "EXPIRED", "REVOKED")


#: How serious a security event is.
#:
#: Deliberately `NOTIFICATION_SEVERITY`'s three rather than `SEVERITY`'s four:
#: this grades *a thing that happened to an account*, and "moderate" is not an
#: answer anybody wants about their own sign-ins. Declared separately because
#: the two vocabularies answer different questions and a shared tuple would
#: eventually be widened for one of them.
SECURITY_SEVERITY: Vocabulary = ("INFO", "WARNING", "CRITICAL")


#: The states in which a run's four row counts are facts about something.
#:
#: `total = valid + invalid + skipped` holds here and nowhere else. A DRAFT has
#: been *read* and not yet checked, so its outcome counts are zero because
#: nothing has decided them — and a CANCELLED run may have been abandoned from
#: either side of that line, which is why "not DRAFT" was the wrong way to say
#: this and briefly made every discarded draft look broken.
IMPORT_COUNTED: Vocabulary = ("VALIDATED", "RUNNING", "COMPLETED", "FAILED")


#: Which step of the wizard a run is on, in order.
#:
#: Stored as well as derivable because a *resumed* draft has to reopen where it
#: was left, and "wherever the data implies" is not the same thing: a run whose
#: mapping is complete but which the person had not looked at yet should reopen
#: on the preview, not skip past it.
IMPORT_STEP: Vocabulary = ("UPLOAD", "MAPPING", "PREVIEW", "EXECUTE", "DONE")


#: How much a data-quality finding should worry somebody (§65).
#:
#: Its own vocabulary rather than a share of `NOTIFICATION_SEVERITY`, for the
#: reason `SECURITY_SEVERITY` is: the three grade different questions. A
#: notification's severity is "how loudly should this interrupt you"; this is
#: "how wrong is the data, and does anything downstream depend on it being
#: right". A fourth notification level added one day must not silently become a
#: data-quality grade nothing renders.
#:
#: CRITICAL is reserved for a *contradiction* — a ticket marked resolved with
#: no moment of resolution, an order shipped and never paid — because those are
#: not a matter of taste. WARNING is a gap somebody should close. INFO is a
#: fact worth publishing that nobody has to act on today.
QUALITY_SEVERITY: Vocabulary = ("INFO", "WARNING", "CRITICAL")


def weighted(values: Vocabulary, weights: tuple[float, ...]) -> tuple[tuple[str, float], ...]:
    """Pair a vocabulary with the seed's distribution, positionally.

    Raises rather than truncating: a vocabulary that grew without its weights
    would otherwise silently stop generating its newest value, which is exactly
    the drift this module exists to prevent.
    """
    if len(values) != len(weights):
        raise ValueError(
            f"{len(values)} values but {len(weights)} weights: "
            "every value in a vocabulary needs a share of the distribution"
        )
    return tuple(zip(values, weights, strict=True))
