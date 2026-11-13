"""The permission catalogue (§13): every permission, grouped and labelled."""

from __future__ import annotations

PERMISSION_GROUPS: dict[str, list[tuple[str, str]]] = {
    "Records": [
        ("records.view", "View records"),
        ("records.create", "Create records"),
        ("records.update", "Update records"),
        ("records.delete", "Delete records"),
        ("records.comment", "Comment on records"),
        ("records.export", "Export records"),
        ("records.import", "Import records"),
        ("records.bulk", "Run bulk operations"),
        # *Applying* a tag is editing a record, so it needs `records.update`
        # and nothing more. This is the vocabulary: creating, renaming,
        # recolouring and removing a tag changes what every record carrying it
        # says, which is a governance act rather than an edit (§37).
        ("tags.manage", "Manage the tag vocabulary"),
    ],
    "Administration": [
        ("admin.access", "Open the administration area"),
        ("users.view", "View users"),
        ("users.manage", "Manage users"),
        ("users.impersonate", "Impersonate users"),
        ("roles.manage", "Manage roles and permissions"),
        ("orgs.manage", "Manage organizations"),
        ("settings.manage", "Manage system settings"),
        # Reading a notice needs nothing beyond being signed in — it is
        # addressed to everybody by definition. Writing one is a broadcast,
        # and that is the privilege.
        ("announcements.manage", "Write and publish announcements"),
        # An automation reaches other people's inboxes and raises work in a
        # shared queue, so reading the list is privileged too: a rule's
        # condition quotes the fields and values of records its reader may
        # have no other way to see.
        ("automations.manage", "Write and run automations"),
        ("flags.manage", "Manage feature flags"),
        ("integrations.manage", "Manage integrations"),
        ("api.manage", "Manage API credentials"),
    ],
    "Operations": [
        ("jobs.view", "View background jobs"),
        ("jobs.manage", "Retry and cancel jobs"),
        ("logs.view", "View system logs"),
        ("audit.view", "View audit logs"),
        ("health.view", "View system health"),
    ],
    "Workspace": [
        ("tasks.view", "View tasks"),
        ("tasks.manage", "Assign and edit tasks"),
        ("mail.access", "Use the mailbox"),
        ("files.view", "View files"),
        ("files.manage", "Upload and organise files"),
        ("calendar.view", "View the calendar"),
        ("calendar.manage", "Create and edit events"),
        ("reports.view", "View reports"),
        ("reports.manage", "Build and save reports"),
        ("dashboards.manage", "Customise dashboards"),
        ("searches.share", "Share saved searches and views"),
        # Collaboration (§47–49). Chat is for everybody signed in; reading the
        # wiki is too, and writing in it is a separate grant.
        ("chat.use", "Use team chat"),
        ("docs.view", "Read the wiki and meeting notes"),
        ("docs.edit", "Write wiki pages and meeting notes"),
    ],
    # The AI features (§41–46). Using the assistant reads only what its user
    # could already read — every tool it calls is checked against the caller's
    # own permissions — so the grant is about cost and policy, not about data.
    "AI": [
        ("ai.use", "Use the AI assistant"),
        # Building a document collection (§44) puts files in front of the
        # model and spends embedding tokens on every page; asking one is ai.use.
        ("knowledge.manage", "Create document collections and add files to them"),
    ],
    # Time & decisions. Tracking one's own time is not writing a record, so
    # every role holds it; *approving* somebody else's week, deciding a held
    # edit, writing SLA policy and publishing an intake form are not.
    "Time & decisions": [
        ("time.track", "Track and submit own time"),
        ("time.approve", "Approve timesheets and see everybody's time"),
        ("approvals.decide", "Decide change and publishing requests"),
        ("sla.manage", "Edit SLA policies and business calendars"),
        ("forms.manage", "Build and publish intake forms"),
    ],
    # Records & analytics (§12, §13, §17, §22, §25). Reading health scores,
    # contracts and alerts is `records.view`; changing what drives them, and
    # putting a dashboard on the open internet, are grants of their own.
    "Records & analytics": [
        ("contracts.manage", "Create, edit and move contracts and renewals"),
        ("health.configure", "Change the customer health model"),
        ("alerts.manage", "Create and silence metric anomaly watches"),
        ("dashboards.publish", "Publish dashboards as public or embeddable links"),
        ("records.restore", "Restore earlier versions of records"),
    ],
}


ALL_PERMISSIONS: tuple[str, ...] = tuple(
    code for group in PERMISSION_GROUPS.values() for code, _ in group
)


PERMISSION_LABELS: dict[str, str] = {
    code: label for group in PERMISSION_GROUPS.values() for code, label in group
}


#: `admin.access` is the single gate the frontend reads to decide whether the
#: administration section exists at all. Only ADMINISTRATOR holds it, which is
#: what makes `user` unable to see the admin panels that `admin` can.
ADMIN_AREA_PERMISSION = "admin.access"
