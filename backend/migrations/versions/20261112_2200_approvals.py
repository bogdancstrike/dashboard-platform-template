"""approvals: one inbox for every decision, and the rules that hold an edit back

Revision: b7d1a0c4e2f1
Parent:   c0ab1a7e5d01
Created:  2026-11-12 22:00:00+00:00

`approval_requests` is the queue every feature raises decisions into (timesheets,
access requests, held-back record edits, report publishing); `change_rules` says
which record edits need a second pair of eyes.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'b7d1a0c4e2f1'
down_revision: str | None = 'c0ab1a7e5d01'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('approval_requests',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=24), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('requester_id', sa.UUID(), nullable=True),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('decide_permission', sa.String(length=64), nullable=False),
    sa.Column('subject_type', sa.String(length=48), nullable=True),
    sa.Column('subject_id', sa.String(length=64), nullable=True),
    sa.Column('subject_label', sa.String(length=240), nullable=True),
    sa.Column('link', sa.String(length=500), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_by_id', sa.UUID(), nullable=True),
    sa.Column('decision_comment', sa.Text(), nullable=True),
    sa.Column('history', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_approval_requests_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], name=op.f('fk_approval_requests_decided_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name=op.f('fk_approval_requests_requester_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_approval_requests'))
    )
    op.create_index('ix_approval_kind_status', 'approval_requests', ['kind', 'status'], unique=False)
    op.create_index(op.f('ix_approval_requests_assignee_id'), 'approval_requests', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_approval_requests_created_at'), 'approval_requests', ['created_at'], unique=False)
    op.create_index(op.f('ix_approval_requests_decided_at'), 'approval_requests', ['decided_at'], unique=False)
    op.create_index(op.f('ix_approval_requests_decided_by_id'), 'approval_requests', ['decided_by_id'], unique=False)
    op.create_index(op.f('ix_approval_requests_due_at'), 'approval_requests', ['due_at'], unique=False)
    op.create_index(op.f('ix_approval_requests_kind'), 'approval_requests', ['kind'], unique=False)
    op.create_index(op.f('ix_approval_requests_reference'), 'approval_requests', ['reference'], unique=True)
    op.create_index(op.f('ix_approval_requests_requester_id'), 'approval_requests', ['requester_id'], unique=False)
    op.create_index(op.f('ix_approval_requests_status'), 'approval_requests', ['status'], unique=False)
    op.create_index(op.f('ix_approval_requests_subject_id'), 'approval_requests', ['subject_id'], unique=False)
    op.create_index(op.f('ix_approval_requests_subject_type'), 'approval_requests', ['subject_type'], unique=False)
    op.create_table('change_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('field', sa.String(length=64), nullable=False),
    sa.Column('operator', sa.String(length=16), nullable=False),
    sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_by_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_change_rules_created_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_change_rules'))
    )
    op.create_index(op.f('ix_change_rules_active'), 'change_rules', ['active'], unique=False)
    op.create_index(op.f('ix_change_rules_created_at'), 'change_rules', ['created_at'], unique=False)
    op.create_index(op.f('ix_change_rules_created_by_id'), 'change_rules', ['created_by_id'], unique=False)
    op.create_index(op.f('ix_change_rules_deleted_at'), 'change_rules', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_change_rules_resource_type'), 'change_rules', ['resource_type'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_change_rules_resource_type'), table_name='change_rules')
    op.drop_index(op.f('ix_change_rules_deleted_at'), table_name='change_rules')
    op.drop_index(op.f('ix_change_rules_created_by_id'), table_name='change_rules')
    op.drop_index(op.f('ix_change_rules_created_at'), table_name='change_rules')
    op.drop_index(op.f('ix_change_rules_active'), table_name='change_rules')
    op.drop_table('change_rules')
    op.drop_index(op.f('ix_approval_requests_subject_type'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_subject_id'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_status'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_requester_id'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_reference'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_kind'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_due_at'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_decided_by_id'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_decided_at'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_created_at'), table_name='approval_requests')
    op.drop_index(op.f('ix_approval_requests_assignee_id'), table_name='approval_requests')
    op.drop_index('ix_approval_kind_status', table_name='approval_requests')
    op.drop_table('approval_requests')
