"""sla policies: business calendars, per-priority targets, escalations

Revision: d9a4b6c1f3e8
Parent:   c3e8f2a9d5b7
Created:  2026-11-12 22:00:00+00:00

Which tickets a policy covers, its first-response and resolution targets per
priority in business hours, the statuses that pause the clock and the escalation
steps; `ticket_sla` is the computed answer per ticket.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd9a4b6c1f3e8'
down_revision: str | None = 'c3e8f2a9d5b7'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('business_calendars',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('hours', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('holidays', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_business_calendars'))
    )
    op.create_index(op.f('ix_business_calendars_created_at'), 'business_calendars', ['created_at'], unique=False)
    op.create_index(op.f('ix_business_calendars_deleted_at'), 'business_calendars', ['deleted_at'], unique=False)
    op.create_table('sla_policies',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('conditions', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('targets', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('calendar_id', sa.UUID(), nullable=True),
    sa.Column('pause_statuses', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('escalations', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['calendar_id'], ['business_calendars.id'], name=op.f('fk_sla_policies_calendar_id_business_calendars'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_sla_policies'))
    )
    op.create_index(op.f('ix_sla_policies_active'), 'sla_policies', ['active'], unique=False)
    op.create_index(op.f('ix_sla_policies_calendar_id'), 'sla_policies', ['calendar_id'], unique=False)
    op.create_index(op.f('ix_sla_policies_created_at'), 'sla_policies', ['created_at'], unique=False)
    op.create_index(op.f('ix_sla_policies_deleted_at'), 'sla_policies', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_sla_policies_position'), 'sla_policies', ['position'], unique=False)
    op.create_table('ticket_sla',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('ticket_id', sa.UUID(), nullable=False),
    sa.Column('policy_id', sa.UUID(), nullable=True),
    sa.Column('first_response_due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolution_due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('paused_minutes', sa.Integer(), nullable=False),
    sa.Column('paused_since', sa.DateTime(timezone=True), nullable=True),
    sa.Column('escalations_fired', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('computed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['policy_id'], ['sla_policies.id'], name=op.f('fk_ticket_sla_policy_id_sla_policies'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], name=op.f('fk_ticket_sla_ticket_id_tickets'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ticket_sla')),
    sa.UniqueConstraint('ticket_id', name='uq_ticket_sla_ticket_id')
    )
    op.create_index(op.f('ix_ticket_sla_created_at'), 'ticket_sla', ['created_at'], unique=False)
    op.create_index(op.f('ix_ticket_sla_policy_id'), 'ticket_sla', ['policy_id'], unique=False)
    op.create_index(op.f('ix_ticket_sla_resolution_due_at'), 'ticket_sla', ['resolution_due_at'], unique=False)




def downgrade() -> None:
    op.drop_index(op.f('ix_ticket_sla_resolution_due_at'), table_name='ticket_sla')
    op.drop_index(op.f('ix_ticket_sla_policy_id'), table_name='ticket_sla')
    op.drop_index(op.f('ix_ticket_sla_created_at'), table_name='ticket_sla')
    op.drop_table('ticket_sla')
    op.drop_index(op.f('ix_sla_policies_position'), table_name='sla_policies')
    op.drop_index(op.f('ix_sla_policies_deleted_at'), table_name='sla_policies')
    op.drop_index(op.f('ix_sla_policies_created_at'), table_name='sla_policies')
    op.drop_index(op.f('ix_sla_policies_calendar_id'), table_name='sla_policies')
    op.drop_index(op.f('ix_sla_policies_active'), table_name='sla_policies')
    op.drop_table('sla_policies')
    op.drop_index(op.f('ix_business_calendars_deleted_at'), table_name='business_calendars')
    op.drop_index(op.f('ix_business_calendars_created_at'), table_name='business_calendars')
    op.drop_table('business_calendars')
