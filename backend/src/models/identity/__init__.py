"""Identity: organizations, departments, teams, roles, groups, users and their sessions.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.identity.organization import (  # noqa: F401
    Department,
    Group,
    Organization,
    Region,
    Role,
    Team,
    user_groups,
)
from src.models.identity.users import (  # noqa: F401
    LoginEvent,
    SecurityEvent,
    User,
    UserSession,
)
