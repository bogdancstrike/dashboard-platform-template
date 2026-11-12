"""insights: generated pages that answer a question about the records (§43)

Revision: 9c4e1f7a2b63
Parent:   e5f7c2d8a1b9
Created:  2026-11-13 01:00:00+00:00

One table: the question, the validated UI spec (components and the queries
behind them), the last rendered copy with data bound in, and the platform's
sharing columns (owner, scope) plus a pin.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '9c4e1f7a2b63'
down_revision: str | None = 'e5f7c2d8a1b9'
branch_labels: str | None = None
depends_on: str | None = None

_UUID = postgresql.UUID(as_uuid=True)
_JSON = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        'insights',
        sa.Column('id', _UUID, server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('datasets', _JSON, nullable=True),
        sa.Column('spec', _JSON, nullable=False),
        sa.Column('rendered', _JSON, nullable=True),
        sa.Column('warnings', _JSON, nullable=True),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=True),
        sa.Column('usage', _JSON, nullable=True),
        sa.Column('scope', sa.String(length=16), nullable=False),
        sa.Column('pinned', sa.Boolean(), nullable=False),
        sa.Column('refreshed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('owner_id', _UUID, nullable=True),
        sa.Column('organization_id', _UUID, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name='fk_insights_owner_id_users', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name='fk_insights_organization_id_organizations', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_insights'),
    )
    for column in ('title', 'source', 'scope', 'pinned', 'owner_id', 'organization_id', 'created_at', 'deleted_at'):
        op.create_index(f'ix_insights_{column}', 'insights', [column])


def downgrade() -> None:
    op.drop_table('insights')
