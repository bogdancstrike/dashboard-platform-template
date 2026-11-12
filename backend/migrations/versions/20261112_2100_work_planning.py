"""work planning: sprints, dependencies, templates, recurrence, timeline dates

Revision: 5e2b9c71d0a3
Parent:   5e2b7c9d1a40
Created:  2026-11-12 21:00:00+00:00

Adds the planning columns to `tasks` (start date, story points, sprint, epic,
backlog rank, milestone, cover colour, status-changed time, recurrence) and the
tables of `models/planning.py`.

Written to be **re-runnable**: every table and column is added only when it is
missing. The live development database is shared by several workstreams and
is brought forward by hand while revisions are still being re-parented, so an
upgrade that meets a column somebody already added must step over it rather
than fail.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision: str = '5e2b9c71d0a3'
down_revision: str | None = '5e2b7c9d1a40'
branch_labels: str | None = None
depends_on: str | None = None

UUID = pg.UUID(as_uuid=True)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    tables = _tables()

    if 'sprints' not in tables:
        op.create_table(
            'sprints',
            sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('project_id', UUID, sa.ForeignKey('projects.id', ondelete='CASCADE'), index=True),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('goal', sa.Text()),
            sa.Column('state', sa.String(16), nullable=False, index=True),
            sa.Column('start_date', sa.Date()),
            sa.Column('end_date', sa.Date()),
            sa.Column('capacity_points', sa.Numeric(7, 1)),
            sa.Column('committed_points', sa.Numeric(7, 1)),
            sa.Column('completed_points', sa.Numeric(7, 1)),
            sa.Column('started_at', sa.DateTime(timezone=True)),
            sa.Column('completed_at', sa.DateTime(timezone=True)),
            sa.Column('report', pg.JSONB()),
            sa.Column('created_by_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), index=True),
            *_timestamps(),
            sa.Column('deleted_at', sa.DateTime(timezone=True), index=True),
        )
        op.create_index('ix_sprints_created_at', 'sprints', ['created_at'])

    if 'sprint_snapshots' not in tables:
        op.create_table(
            'sprint_snapshots',
            sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('sprint_id', UUID, sa.ForeignKey('sprints.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('day', sa.Date(), nullable=False),
            sa.Column('total_points', sa.Numeric(7, 1), nullable=False),
            sa.Column('done_points', sa.Numeric(7, 1), nullable=False),
            sa.Column('remaining_points', sa.Numeric(7, 1), nullable=False),
            sa.Column('total_tasks', sa.Integer(), nullable=False),
            sa.Column('done_tasks', sa.Integer(), nullable=False),
            sa.UniqueConstraint('sprint_id', 'day', name='uq_sprint_snapshot_day'),
        )

    if 'task_templates' not in tables:
        op.create_table(
            'task_templates',
            sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('name', sa.String(120), nullable=False, index=True),
            sa.Column('title', sa.String(240), nullable=False),
            sa.Column('description', sa.Text()),
            sa.Column('kind', sa.String(24), nullable=False),
            sa.Column('priority', sa.String(16), nullable=False),
            sa.Column('estimate_hours', sa.Numeric(8, 2)),
            sa.Column('story_points', sa.Numeric(5, 1)),
            sa.Column('checklist', pg.JSONB()),
            sa.Column('labels', pg.ARRAY(sa.String(48))),
            sa.Column('cover_color', sa.String(16)),
            sa.Column('due_in_days', sa.Integer()),
            sa.Column('usage_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('owner_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), index=True),
            *_timestamps(),
            sa.Column('deleted_at', sa.DateTime(timezone=True), index=True),
        )
        op.create_index('ix_task_templates_created_at', 'task_templates', ['created_at'])

    if 'task_recurrences' not in tables:
        op.create_table(
            'task_recurrences',
            sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('task_id', UUID, sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('frequency', sa.String(12), nullable=False),
            sa.Column('interval', sa.Integer(), nullable=False),
            sa.Column('unit', sa.String(8), nullable=False),
            sa.Column('weekdays', pg.ARRAY(sa.Integer())),
            sa.Column('month_day', sa.Integer()),
            sa.Column('until', sa.Date()),
            sa.Column('next_run_at', sa.DateTime(timezone=True), index=True),
            sa.Column('last_run_at', sa.DateTime(timezone=True)),
            sa.Column('occurrences', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_by_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), index=True),
            *_timestamps(),
        )
        op.create_index('ix_task_recurrence_due', 'task_recurrences', ['active', 'next_run_at'])
        op.create_index('ix_task_recurrences_created_at', 'task_recurrences', ['created_at'])

    if 'task_dependencies' not in tables:
        op.create_table(
            'task_dependencies',
            sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()')),
            sa.Column('predecessor_id', UUID, sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('successor_id', UUID, sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('kind', sa.String(4), nullable=False),
            sa.Column('lag_days', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_by_id', UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), index=True),
            *_timestamps(),
            sa.UniqueConstraint('predecessor_id', 'successor_id', name='uq_task_dependency_pair'),
        )
        op.create_index('ix_task_dependencies_created_at', 'task_dependencies', ['created_at'])

    if 'task_watchers' not in tables:
        op.create_table(
            'task_watchers',
            sa.Column('task_id', UUID, sa.ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', UUID, sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True, index=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        )

    if 'task_lane_settings' not in tables:
        op.create_table(
            'task_lane_settings',
            sa.Column('status', sa.String(24), primary_key=True),
            sa.Column('wip_limit', sa.Integer()),
            sa.Column('updated_at', sa.DateTime(timezone=True)),
        )

    have = _columns('tasks')
    added = [
        ('start_date', sa.Column('start_date', sa.DateTime(timezone=True))),
        ('story_points', sa.Column('story_points', sa.Numeric(5, 1))),
        ('sprint_id', sa.Column('sprint_id', UUID, sa.ForeignKey('sprints.id', ondelete='SET NULL'))),
        ('sprint_added_at', sa.Column('sprint_added_at', sa.DateTime(timezone=True))),
        ('epic_id', sa.Column('epic_id', UUID, sa.ForeignKey('tasks.id', ondelete='SET NULL'))),
        ('backlog_rank', sa.Column('backlog_rank', sa.Double(), nullable=False, server_default='0')),
        ('is_milestone', sa.Column('is_milestone', sa.Boolean(), nullable=False, server_default=sa.false())),
        ('cover_color', sa.Column('cover_color', sa.String(16))),
        ('status_changed_at', sa.Column('status_changed_at', sa.DateTime(timezone=True))),
        # No foreign key: `task_recurrences.task_id` already points back here.
        ('recurrence_id', sa.Column('recurrence_id', UUID)),
    ]
    for name, column in added:
        if name not in have:
            op.add_column('tasks', column)
    for name in ('start_date', 'sprint_id', 'epic_id', 'backlog_rank', 'recurrence_id'):
        op.execute(f'CREATE INDEX IF NOT EXISTS ix_tasks_{name} ON tasks ({name})')

    # The backlog's first order is the board's, so nothing jumps on the day
    # this ships.
    if 'backlog_rank' not in have:
        op.execute('UPDATE tasks SET backlog_rank = board_position')


def downgrade() -> None:
    for name in (
        'recurrence_id', 'status_changed_at', 'cover_color', 'is_milestone', 'backlog_rank',
        'epic_id', 'sprint_added_at', 'sprint_id', 'story_points', 'start_date',
    ):
        op.execute(f'ALTER TABLE tasks DROP COLUMN IF EXISTS {name}')
    for table in (
        'task_lane_settings', 'task_watchers', 'task_dependencies', 'task_recurrences',
        'task_templates', 'sprint_snapshots', 'sprints',
    ):
        op.execute(f'DROP TABLE IF EXISTS {table}')
