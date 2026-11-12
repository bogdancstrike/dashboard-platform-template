"""Importing this package registers every table on `Base.metadata`.

Schema creation and the seed both rely on that: `create_all` can only build
what has been imported, and a model that no module happens to import is a table
that silently does not exist.
"""

from src.models.base import Base  # noqa: F401
from src.models.assistant import AiUsage, AssistantBrief, AssistantConversation, AssistantMessage  # noqa: F401
from src.models.business import (  # noqa: F401
    CalendarEvent, Customer, Device, Order, Project, Task, Ticket,
)
from src.models.collab import (  # noqa: F401
    ChatChannel, ChatMember, DocLink, DocPage, DocRevision, DocSpace, ThreadRead,
)
from src.models.content import (  # noqa: F401
    Comment, EmailAttachment, EmailMessage, EmailTemplate, EmailThread,
    FileObject, Folder, Tag, TagLink,
)
from src.models.kanban import Board, BoardCard, BoardLane  # noqa: F401
from src.models.knowledge import (  # noqa: F401
    KnowledgeChunk, KnowledgeCollection, KnowledgeDocument, KnowledgeQuestion,
)
from src.models.planning import (  # noqa: F401
    Sprint, SprintSnapshot, TaskDependency, TaskLaneSetting, TaskRecurrence, TaskTemplate,
    TaskWatcher,
)
from src.models.identity import (  # noqa: F401
    Department, Group, LoginEvent, Organization, Region, Role, SecurityEvent,
    Team, User, UserSession, user_groups,
)
from src.models.personal import (  # noqa: F401
    Dashboard, DashboardWidget, Favorite, NotificationPreference, RecentItem,
    Report, ReportDocument, ResourceShare, SavedSearch,
)
from src.models.platform import (  # noqa: F401
    ActivityEntry, AlertRule, AlertRuleFire, AlertRuleRun, Announcement,
    AnnouncementReceipt, ApiClient,
    ApiCredential, ApiRequestLog, AuditLog, BackgroundJob, FeatureFlag,
    ImportRun, Integration, Notification, ScheduledTask, ServiceHealth,
    SystemLog, SystemSetting,
)

__all__ = ["Base"]
