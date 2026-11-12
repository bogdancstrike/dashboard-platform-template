"""time tracking: entries, one running timer per person, weekly timesheets

Revision: c3e8f2a9d5b7
Parent:   b7d1a0c4e2f1
Created:  2026-11-12 22:00:00+00:00

Time spent on tasks, tickets and projects, by timer or by hand; the week it
falls in is approved as a timesheet, which locks it. A partial unique index
keeps a person to one running timer.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = 'c3e8f2a9d5b7'
down_revision: str | None = 'b7d1a0c4e2f1'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('timesheets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('week_start', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('total_minutes', sa.Integer(), nullable=False),
    sa.Column('billable_minutes', sa.Integer(), nullable=False),
    sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decided_by_id', sa.UUID(), nullable=True),
    sa.Column('decision_comment', sa.Text(), nullable=True),
    sa.Column('approval_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['approval_id'], ['approval_requests.id'], name=op.f('fk_timesheets_approval_id_approval_requests'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], name=op.f('fk_timesheets_decided_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_timesheets_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_timesheets')),
    sa.UniqueConstraint('user_id', 'week_start', name='uq_timesheets_user_week')
    )
    op.create_index(op.f('ix_timesheets_approval_id'), 'timesheets', ['approval_id'], unique=False)
    op.create_index(op.f('ix_timesheets_created_at'), 'timesheets', ['created_at'], unique=False)
    op.create_index(op.f('ix_timesheets_decided_by_id'), 'timesheets', ['decided_by_id'], unique=False)
    op.create_index(op.f('ix_timesheets_status'), 'timesheets', ['status'], unique=False)
    op.create_index(op.f('ix_timesheets_user_id'), 'timesheets', ['user_id'], unique=False)
    op.create_index(op.f('ix_timesheets_week_start'), 'timesheets', ['week_start'], unique=False)
    op.create_table('time_entries',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('subject_type', sa.String(length=24), nullable=False),
    sa.Column('subject_id', sa.UUID(), nullable=True),
    sa.Column('subject_label', sa.String(length=240), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('customer_id', sa.UUID(), nullable=True),
    sa.Column('work_date', sa.Date(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('minutes', sa.Integer(), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('billable', sa.Boolean(), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_time_entries_customer_id_customers'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_time_entries_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_time_entries_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_time_entries'))
    )
    op.create_index(op.f('ix_time_entries_billable'), 'time_entries', ['billable'], unique=False)
    op.create_index(op.f('ix_time_entries_created_at'), 'time_entries', ['created_at'], unique=False)
    op.create_index(op.f('ix_time_entries_customer_id'), 'time_entries', ['customer_id'], unique=False)
    op.create_index(op.f('ix_time_entries_project_id'), 'time_entries', ['project_id'], unique=False)
    op.create_index(op.f('ix_time_entries_subject_id'), 'time_entries', ['subject_id'], unique=False)
    op.create_index(op.f('ix_time_entries_subject_type'), 'time_entries', ['subject_type'], unique=False)
    op.create_index('ix_time_entries_user_date', 'time_entries', ['user_id', 'work_date'], unique=False)
    op.create_index(op.f('ix_time_entries_user_id'), 'time_entries', ['user_id'], unique=False)
    op.create_index(op.f('ix_time_entries_work_date'), 'time_entries', ['work_date'], unique=False)
    op.create_index('uq_time_entries_one_running', 'time_entries', ['user_id'], unique=True, postgresql_where=sa.text("ended_at IS NULL AND source = 'TIMER'"))


def downgrade() -> None:
    op.drop_index('uq_time_entries_one_running', table_name='time_entries', postgresql_where=sa.text("ended_at IS NULL AND source = 'TIMER'"))
    op.drop_index(op.f('ix_time_entries_work_date'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_user_id'), table_name='time_entries')
    op.drop_index('ix_time_entries_user_date', table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_subject_type'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_subject_id'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_project_id'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_customer_id'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_created_at'), table_name='time_entries')
    op.drop_index(op.f('ix_time_entries_billable'), table_name='time_entries')
    op.drop_table('time_entries')
    op.drop_index(op.f('ix_timesheets_week_start'), table_name='timesheets')
    op.drop_index(op.f('ix_timesheets_user_id'), table_name='timesheets')
    op.drop_index(op.f('ix_timesheets_status'), table_name='timesheets')
    op.drop_index(op.f('ix_timesheets_decided_by_id'), table_name='timesheets')
    op.drop_index(op.f('ix_timesheets_created_at'), table_name='timesheets')
    op.drop_index(op.f('ix_timesheets_approval_id'), table_name='timesheets')
    op.drop_table('timesheets')
