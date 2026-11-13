"""developer portal: API examples captured from real calls

Revision: f5d3e7a10431
Parent:   3d8b5e1a9c72
Created:  2026-11-13 04:00:00+00:00

The latest successful request and response per route and method, with its
inferred schema — what the API reference shows as "an answer looks like this".
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f5d3e7a10431'
down_revision: str | None = '3d8b5e1a9c72'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('api_examples',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('method', sa.String(length=8), nullable=False),
    sa.Column('route', sa.String(length=300), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('path', sa.String(length=500), nullable=True),
    sa.Column('request_body', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('response_sample', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('response_schema', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('captured_by_id', sa.UUID(), nullable=True),
    sa.Column('captured_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['captured_by_id'], ['users.id'], name=op.f('fk_api_examples_captured_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_examples')),
    sa.UniqueConstraint('method', 'route', name='uq_api_example_route'),
    )
    op.create_index(op.f('ix_api_examples_route'), 'api_examples', ['route'], unique=False)
    op.create_index(op.f('ix_api_examples_captured_by_id'), 'api_examples', ['captured_by_id'], unique=False)
    op.create_index(op.f('ix_api_examples_created_at'), 'api_examples', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_table('api_examples')
