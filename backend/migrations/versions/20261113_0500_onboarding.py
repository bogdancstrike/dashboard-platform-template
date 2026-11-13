"""onboarding: checklist progress per person, and tags on sample data

Revision: f5e8b2c40562
Parent:   f5d3e7a10431
Created:  2026-11-13 05:00:00+00:00

`onboarding_steps` keeps each person's own answer to a checklist step (done,
skipped) and whether they dismissed the card; `sample_records` tags every
record a "load sample data" created, so removing it deletes exactly those.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = 'f5e8b2c40562'
down_revision: str | None = 'f5d3e7a10431'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('onboarding_steps',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('step_key', sa.String(length=64), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_onboarding_steps_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_onboarding_steps')),
    sa.UniqueConstraint('user_id', 'step_key', name='uq_onboarding_step'),
    )
    op.create_index(op.f('ix_onboarding_steps_user_id'), 'onboarding_steps', ['user_id'], unique=False)
    op.create_index(op.f('ix_onboarding_steps_created_at'), 'onboarding_steps', ['created_at'], unique=False)
    op.create_table('sample_records',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('area', sa.String(length=32), nullable=False),
    sa.Column('batch_id', sa.String(length=64), nullable=False),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('record_id', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=240), nullable=True),
    sa.Column('created_by_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_sample_records_created_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sample_records')),
    )
    op.create_index(op.f('ix_sample_records_area'), 'sample_records', ['area'], unique=False)
    op.create_index(op.f('ix_sample_records_batch_id'), 'sample_records', ['batch_id'], unique=False)
    op.create_index(op.f('ix_sample_records_record_id'), 'sample_records', ['record_id'], unique=False)
    op.create_index(op.f('ix_sample_records_created_by_id'), 'sample_records', ['created_by_id'], unique=False)
    op.create_index(op.f('ix_sample_records_created_at'), 'sample_records', ['created_at'], unique=False)
    op.create_index('ix_sample_area_type', 'sample_records', ['area', 'resource_type'], unique=False)


def downgrade() -> None:
    op.drop_table('sample_records')
    op.drop_table('onboarding_steps')
