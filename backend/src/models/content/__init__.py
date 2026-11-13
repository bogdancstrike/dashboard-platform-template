"""Content: files and folders, mail, comments and tags.

Every submodule is imported here: importing the package registers all its tables."""

from __future__ import annotations

from src.models.content.comments import (  # noqa: F401
    Comment,
    Tag,
    TagLink,
)
from src.models.content.files import (  # noqa: F401
    FileObject,
    Folder,
)
from src.models.content.mail import (  # noqa: F401
    EmailAttachment,
    EmailMessage,
    EmailTemplate,
    EmailThread,
)
