"""assistant sources: what a Data-mode conversation may read (§41, §44)

Revision: 3d8b5e1a9c72
Parent:   f5a1c0de2701
Created:  2026-11-13 03:00:00+00:00

One nullable JSONB column on `assistant_conversations`:
`{"records": bool, "collections": [id], "documents": [id]}`. Absent means
records only — every existing conversation keeps behaving as it did.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '3d8b5e1a9c72'
down_revision: str | None = 'f5a1c0de2701'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column('assistant_conversations',
                  sa.Column('sources', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('assistant_conversations', 'sources')
