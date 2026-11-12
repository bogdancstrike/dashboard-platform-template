"""intake forms: public and internal forms that create records

Revision: e5f7c2d8a1b9
Parent:   d9a4b6c1f3e8
Created:  2026-11-12 22:00:00+00:00

A form's fields and their mapping onto a dataset, its settings, and every
submission with the record it became (or why it did not).
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e5f7c2d8a1b9'
down_revision: str | None = 'd9a4b6c1f3e8'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('intake_forms',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('target', sa.String(length=32), nullable=False),
    sa.Column('fields', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('settings', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('submission_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_intake_forms_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_intake_forms'))
    )
    op.create_index(op.f('ix_intake_forms_created_at'), 'intake_forms', ['created_at'], unique=False)
    op.create_index(op.f('ix_intake_forms_deleted_at'), 'intake_forms', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_intake_forms_owner_id'), 'intake_forms', ['owner_id'], unique=False)
    op.create_index(op.f('ix_intake_forms_slug'), 'intake_forms', ['slug'], unique=True)
    op.create_index(op.f('ix_intake_forms_status'), 'intake_forms', ['status'], unique=False)
    op.create_index(op.f('ix_intake_forms_target'), 'intake_forms', ['target'], unique=False)
    op.create_table('form_submissions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('form_id', sa.UUID(), nullable=False),
    sa.Column('reference', sa.String(length=24), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('record_type', sa.String(length=32), nullable=True),
    sa.Column('record_id', sa.String(length=64), nullable=True),
    sa.Column('record_label', sa.String(length=240), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('submitter_id', sa.UUID(), nullable=True),
    sa.Column('submitter_email', sa.String(length=255), nullable=True),
    sa.Column('client_hash', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['form_id'], ['intake_forms.id'], name=op.f('fk_form_submissions_form_id_intake_forms'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['submitter_id'], ['users.id'], name=op.f('fk_form_submissions_submitter_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_form_submissions'))
    )
    op.create_index(op.f('ix_form_submissions_client_hash'), 'form_submissions', ['client_hash'], unique=False)
    op.create_index(op.f('ix_form_submissions_created_at'), 'form_submissions', ['created_at'], unique=False)
    op.create_index(op.f('ix_form_submissions_form_id'), 'form_submissions', ['form_id'], unique=False)
    op.create_index(op.f('ix_form_submissions_reference'), 'form_submissions', ['reference'], unique=True)
    op.create_index(op.f('ix_form_submissions_status'), 'form_submissions', ['status'], unique=False)
    op.create_index(op.f('ix_form_submissions_submitter_id'), 'form_submissions', ['submitter_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_form_submissions_submitter_id'), table_name='form_submissions')
    op.drop_index(op.f('ix_form_submissions_status'), table_name='form_submissions')
    op.drop_index(op.f('ix_form_submissions_reference'), table_name='form_submissions')
    op.drop_index(op.f('ix_form_submissions_form_id'), table_name='form_submissions')
    op.drop_index(op.f('ix_form_submissions_created_at'), table_name='form_submissions')
    op.drop_index(op.f('ix_form_submissions_client_hash'), table_name='form_submissions')
    op.drop_table('form_submissions')
    op.drop_index(op.f('ix_intake_forms_target'), table_name='intake_forms')
    op.drop_index(op.f('ix_intake_forms_status'), table_name='intake_forms')
    op.drop_index(op.f('ix_intake_forms_slug'), table_name='intake_forms')
    op.drop_index(op.f('ix_intake_forms_owner_id'), table_name='intake_forms')
    op.drop_index(op.f('ix_intake_forms_deleted_at'), table_name='intake_forms')
    op.drop_index(op.f('ix_intake_forms_created_at'), table_name='intake_forms')
    op.drop_table('intake_forms')
