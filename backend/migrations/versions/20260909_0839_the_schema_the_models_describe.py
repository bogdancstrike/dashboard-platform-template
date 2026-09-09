"""the schema the models describe

Revision: d3dc6cd5369a
Parent:   
Created:  2026-09-09 08:39:35.129255+00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd3dc6cd5369a'
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Tables in dependency order, then the constraints that close the
    # cycles. `users` references `departments` and `departments`
    # references `users`, so neither can carry the other's foreign key at
    # CREATE time — the same eleven constraints SQLAlchemy's own
    # `create_all` defers, deferred here for the same reason.
    op.create_table('regions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=96), nullable=False),
    sa.Column('code', sa.String(length=16), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_regions')),
    sa.UniqueConstraint('code', name=op.f('uq_regions_code')),
    sa.UniqueConstraint('name', name=op.f('uq_regions_name'))
    )
    op.create_index(op.f('ix_regions_created_at'), 'regions', ['created_at'], unique=False)
    op.create_table('departments',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('manager_id', sa.UUID(), nullable=True),
    sa.Column('cost_center', sa.String(length=32), nullable=True),
    sa.Column('headcount', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_departments'))
    )
    op.create_index(op.f('ix_departments_code'), 'departments', ['code'], unique=False)
    op.create_index(op.f('ix_departments_created_at'), 'departments', ['created_at'], unique=False)
    op.create_index(op.f('ix_departments_deleted_at'), 'departments', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_departments_manager_id'), 'departments', ['manager_id'], unique=False)
    op.create_index(op.f('ix_departments_name'), 'departments', ['name'], unique=False)
    op.create_index(op.f('ix_departments_organization_id'), 'departments', ['organization_id'], unique=False)
    op.create_index(op.f('ix_departments_parent_id'), 'departments', ['parent_id'], unique=False)
    op.create_table('teams',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('department_id', sa.UUID(), nullable=True),
    sa.Column('lead_id', sa.UUID(), nullable=True),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_teams'))
    )
    op.create_index(op.f('ix_teams_created_at'), 'teams', ['created_at'], unique=False)
    op.create_index(op.f('ix_teams_deleted_at'), 'teams', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_teams_department_id'), 'teams', ['department_id'], unique=False)
    op.create_index(op.f('ix_teams_lead_id'), 'teams', ['lead_id'], unique=False)
    op.create_index(op.f('ix_teams_name'), 'teams', ['name'], unique=False)
    op.create_index(op.f('ix_teams_organization_id'), 'teams', ['organization_id'], unique=False)
    op.create_index(op.f('ix_teams_slug'), 'teams', ['slug'], unique=False)
    op.create_table('roles',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=48), nullable=False),
    sa.Column('name', sa.String(length=96), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('permissions', postgresql.ARRAY(sa.String(length=64)), nullable=False),
    sa.Column('rank', sa.Integer(), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_roles'))
    )
    op.create_index(op.f('ix_roles_code'), 'roles', ['code'], unique=True)
    op.create_index(op.f('ix_roles_created_at'), 'roles', ['created_at'], unique=False)
    op.create_index(op.f('ix_roles_rank'), 'roles', ['rank'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('username', sa.String(length=80), nullable=False),
    sa.Column('full_name', sa.String(length=160), nullable=False),
    sa.Column('first_name', sa.String(length=80), nullable=True),
    sa.Column('last_name', sa.String(length=80), nullable=True),
    sa.Column('avatar_url', sa.Text(), nullable=True),
    sa.Column('phone', sa.String(length=48), nullable=True),
    sa.Column('job_title', sa.String(length=120), nullable=True),
    sa.Column('external_id', sa.String(length=64), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('department_id', sa.UUID(), nullable=True),
    sa.Column('team_id', sa.UUID(), nullable=True),
    sa.Column('manager_id', sa.UUID(), nullable=True),
    sa.Column('role_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('locale', sa.String(length=12), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('login_count', sa.Integer(), nullable=False),
    sa.Column('mfa_enabled', sa.Boolean(), nullable=False),
    sa.Column('mfa_method', sa.String(length=24), nullable=True),
    sa.Column('profile_completeness', sa.Integer(), nullable=False),
    sa.Column('preferences', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    op.create_index(op.f('ix_users_created_at'), 'users', ['created_at'], unique=False)
    op.create_index(op.f('ix_users_deleted_at'), 'users', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_users_department_id'), 'users', ['department_id'], unique=False)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_external_id'), 'users', ['external_id'], unique=True)
    op.create_index(op.f('ix_users_full_name'), 'users', ['full_name'], unique=False)
    op.create_index(op.f('ix_users_job_title'), 'users', ['job_title'], unique=False)
    op.create_index(op.f('ix_users_last_login_at'), 'users', ['last_login_at'], unique=False)
    op.create_index(op.f('ix_users_manager_id'), 'users', ['manager_id'], unique=False)
    op.create_index(op.f('ix_users_organization_id'), 'users', ['organization_id'], unique=False)
    op.create_index(op.f('ix_users_profile_completeness'), 'users', ['profile_completeness'], unique=False)
    op.create_index(op.f('ix_users_role_id'), 'users', ['role_id'], unique=False)
    op.create_index(op.f('ix_users_status'), 'users', ['status'], unique=False)
    op.create_index(op.f('ix_users_team_id'), 'users', ['team_id'], unique=False)
    op.create_index(op.f('ix_users_username'), 'users', ['username'], unique=True)
    op.create_table('service_health',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('latency_ms', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('error_rate', sa.Numeric(precision=6, scale=3), nullable=False),
    sa.Column('request_volume', sa.Integer(), nullable=False),
    sa.Column('uptime_percent', sa.Numeric(precision=6, scale=3), nullable=False),
    sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('message', sa.String(length=400), nullable=True),
    sa.Column('history', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_service_health'))
    )
    op.create_index(op.f('ix_service_health_category'), 'service_health', ['category'], unique=False)
    op.create_index(op.f('ix_service_health_created_at'), 'service_health', ['created_at'], unique=False)
    op.create_index(op.f('ix_service_health_key'), 'service_health', ['key'], unique=True)
    op.create_index(op.f('ix_service_health_last_checked_at'), 'service_health', ['last_checked_at'], unique=False)
    op.create_index(op.f('ix_service_health_status'), 'service_health', ['status'], unique=False)
    op.create_table('email_templates',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('subject', sa.String(length=300), nullable=False),
    sa.Column('body_html', sa.Text(), nullable=True),
    sa.Column('body_text', sa.Text(), nullable=True),
    sa.Column('locale', sa.String(length=12), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('variables', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('updated_by_id', sa.UUID(), nullable=True),
    sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('send_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_email_templates_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_templates'))
    )
    op.create_index(op.f('ix_email_templates_category'), 'email_templates', ['category'], unique=False)
    op.create_index(op.f('ix_email_templates_code'), 'email_templates', ['code'], unique=True)
    op.create_index(op.f('ix_email_templates_created_at'), 'email_templates', ['created_at'], unique=False)
    op.create_index(op.f('ix_email_templates_deleted_at'), 'email_templates', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_email_templates_is_active'), 'email_templates', ['is_active'], unique=False)
    op.create_index(op.f('ix_email_templates_locale'), 'email_templates', ['locale'], unique=False)
    op.create_index(op.f('ix_email_templates_name'), 'email_templates', ['name'], unique=False)
    op.create_index(op.f('ix_email_templates_updated_by_id'), 'email_templates', ['updated_by_id'], unique=False)
    op.create_table('comments',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('author_id', sa.UUID(), nullable=True),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('mentions', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('reactions', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('is_internal', sa.Boolean(), nullable=False),
    sa.Column('is_pinned', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_comments_author_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['comments.id'], name=op.f('fk_comments_parent_id_comments'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_comments'))
    )
    op.create_index(op.f('ix_comments_author_id'), 'comments', ['author_id'], unique=False)
    op.create_index(op.f('ix_comments_created_at'), 'comments', ['created_at'], unique=False)
    op.create_index(op.f('ix_comments_deleted_at'), 'comments', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_comments_is_internal'), 'comments', ['is_internal'], unique=False)
    op.create_index(op.f('ix_comments_parent_id'), 'comments', ['parent_id'], unique=False)
    op.create_index(op.f('ix_comments_resource_id'), 'comments', ['resource_id'], unique=False)
    op.create_index(op.f('ix_comments_resource_type'), 'comments', ['resource_type'], unique=False)
    op.create_table('organizations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('legal_name', sa.String(length=200), nullable=True),
    sa.Column('industry', sa.String(length=80), nullable=True),
    sa.Column('tier', sa.String(length=24), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('region_id', sa.UUID(), nullable=True),
    sa.Column('logo_url', sa.Text(), nullable=True),
    sa.Column('website', sa.String(length=255), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('phone', sa.String(length=48), nullable=True),
    sa.Column('address_line', sa.String(length=255), nullable=True),
    sa.Column('city', sa.String(length=96), nullable=True),
    sa.Column('country', sa.String(length=96), nullable=True),
    sa.Column('employee_count', sa.Integer(), nullable=False),
    sa.Column('annual_revenue', sa.Float(), nullable=False),
    sa.Column('settings', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['region_id'], ['regions.id'], name=op.f('fk_organizations_region_id_regions'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_organizations')),
    sa.UniqueConstraint('slug', name=op.f('uq_organizations_slug'))
    )
    op.create_index(op.f('ix_organizations_city'), 'organizations', ['city'], unique=False)
    op.create_index(op.f('ix_organizations_country'), 'organizations', ['country'], unique=False)
    op.create_index(op.f('ix_organizations_created_at'), 'organizations', ['created_at'], unique=False)
    op.create_index(op.f('ix_organizations_deleted_at'), 'organizations', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_organizations_industry'), 'organizations', ['industry'], unique=False)
    op.create_index(op.f('ix_organizations_name'), 'organizations', ['name'], unique=False)
    op.create_index(op.f('ix_organizations_region_id'), 'organizations', ['region_id'], unique=False)
    op.create_index(op.f('ix_organizations_status'), 'organizations', ['status'], unique=False)
    op.create_index(op.f('ix_organizations_tier'), 'organizations', ['tier'], unique=False)
    op.create_table('user_sessions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('token_id', sa.String(length=64), nullable=False),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=400), nullable=True),
    sa.Column('device', sa.String(length=64), nullable=True),
    sa.Column('location', sa.String(length=120), nullable=True),
    sa.Column('is_current', sa.Boolean(), nullable=False),
    sa.Column('trusted', sa.Boolean(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_user_sessions'))
    )
    op.create_index(op.f('ix_user_sessions_created_at'), 'user_sessions', ['created_at'], unique=False)
    op.create_index(op.f('ix_user_sessions_device'), 'user_sessions', ['device'], unique=False)
    op.create_index(op.f('ix_user_sessions_last_seen_at'), 'user_sessions', ['last_seen_at'], unique=False)
    op.create_index(op.f('ix_user_sessions_revoked_at'), 'user_sessions', ['revoked_at'], unique=False)
    op.create_index(op.f('ix_user_sessions_token_id'), 'user_sessions', ['token_id'], unique=True)
    op.create_index(op.f('ix_user_sessions_trusted'), 'user_sessions', ['trusted'], unique=False)
    op.create_index(op.f('ix_user_sessions_user_id'), 'user_sessions', ['user_id'], unique=False)
    op.create_table('login_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('result', sa.String(length=24), nullable=False),
    sa.Column('reason', sa.String(length=120), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=400), nullable=True),
    sa.Column('device', sa.String(length=64), nullable=True),
    sa.Column('location', sa.String(length=120), nullable=True),
    sa.Column('method', sa.String(length=24), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_login_events_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_login_events'))
    )
    op.create_index(op.f('ix_login_events_created_at'), 'login_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_login_events_email'), 'login_events', ['email'], unique=False)
    op.create_index(op.f('ix_login_events_ip_address'), 'login_events', ['ip_address'], unique=False)
    op.create_index(op.f('ix_login_events_result'), 'login_events', ['result'], unique=False)
    op.create_index(op.f('ix_login_events_user_id'), 'login_events', ['user_id'], unique=False)
    op.create_table('security_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('kind', sa.String(length=48), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('resolved', sa.Boolean(), nullable=False),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_security_events_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_security_events'))
    )
    op.create_index(op.f('ix_security_events_created_at'), 'security_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_security_events_kind'), 'security_events', ['kind'], unique=False)
    op.create_index(op.f('ix_security_events_resolved'), 'security_events', ['resolved'], unique=False)
    op.create_index(op.f('ix_security_events_severity'), 'security_events', ['severity'], unique=False)
    op.create_index(op.f('ix_security_events_user_id'), 'security_events', ['user_id'], unique=False)
    op.create_table('resource_shares',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('shared_by_id', sa.UUID(), nullable=True),
    sa.Column('permission', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['shared_by_id'], ['users.id'], name=op.f('fk_resource_shares_shared_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_resource_shares_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_resource_shares')),
    sa.UniqueConstraint('resource_type', 'resource_id', 'user_id', name='uq_resource_share')
    )
    op.create_index('ix_resource_share_lookup', 'resource_shares', ['user_id', 'resource_type'], unique=False)
    op.create_index(op.f('ix_resource_shares_created_at'), 'resource_shares', ['created_at'], unique=False)
    op.create_index(op.f('ix_resource_shares_resource_id'), 'resource_shares', ['resource_id'], unique=False)
    op.create_index(op.f('ix_resource_shares_resource_type'), 'resource_shares', ['resource_type'], unique=False)
    op.create_index(op.f('ix_resource_shares_shared_by_id'), 'resource_shares', ['shared_by_id'], unique=False)
    op.create_index(op.f('ix_resource_shares_user_id'), 'resource_shares', ['user_id'], unique=False)
    op.create_table('favorites',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=240), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('icon', sa.String(length=48), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_favorites_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_favorites')),
    sa.UniqueConstraint('user_id', 'resource_type', 'resource_id', name='uq_favorite')
    )
    op.create_index(op.f('ix_favorites_created_at'), 'favorites', ['created_at'], unique=False)
    op.create_index(op.f('ix_favorites_position'), 'favorites', ['position'], unique=False)
    op.create_index(op.f('ix_favorites_resource_type'), 'favorites', ['resource_type'], unique=False)
    op.create_index(op.f('ix_favorites_user_id'), 'favorites', ['user_id'], unique=False)
    op.create_table('recent_items',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=240), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('icon', sa.String(length=48), nullable=True),
    sa.Column('visited_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('visit_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_recent_items_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recent_items')),
    sa.UniqueConstraint('user_id', 'resource_type', 'resource_id', name='uq_recent')
    )
    op.create_index(op.f('ix_recent_items_created_at'), 'recent_items', ['created_at'], unique=False)
    op.create_index(op.f('ix_recent_items_resource_type'), 'recent_items', ['resource_type'], unique=False)
    op.create_index(op.f('ix_recent_items_user_id'), 'recent_items', ['user_id'], unique=False)
    op.create_index(op.f('ix_recent_items_visited_at'), 'recent_items', ['visited_at'], unique=False)
    op.create_index('ix_recent_user_time', 'recent_items', ['user_id', 'visited_at'], unique=False)
    op.create_table('notification_preferences',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('in_app', sa.Boolean(), nullable=False),
    sa.Column('email', sa.Boolean(), nullable=False),
    sa.Column('push', sa.Boolean(), nullable=False),
    sa.Column('digest', sa.String(length=16), nullable=False),
    sa.Column('quiet_hours_start', sa.String(length=8), nullable=True),
    sa.Column('quiet_hours_end', sa.String(length=8), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_notification_preferences_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notification_preferences')),
    sa.UniqueConstraint('user_id', 'category', name='uq_notif_pref')
    )
    op.create_index(op.f('ix_notification_preferences_created_at'), 'notification_preferences', ['created_at'], unique=False)
    op.create_index(op.f('ix_notification_preferences_user_id'), 'notification_preferences', ['user_id'], unique=False)
    op.create_table('system_logs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('logged_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('level', sa.String(length=12), nullable=False),
    sa.Column('service', sa.String(length=64), nullable=False),
    sa.Column('logger', sa.String(length=120), nullable=True),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('correlation_id', sa.String(length=64), nullable=True),
    sa.Column('trace_id', sa.String(length=64), nullable=True),
    sa.Column('span_id', sa.String(length=32), nullable=True),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('host', sa.String(length=96), nullable=True),
    sa.Column('environment', sa.String(length=24), nullable=False),
    sa.Column('duration_ms', sa.Numeric(precision=10, scale=2), nullable=True),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('stack_trace', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_system_logs_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_system_logs'))
    )
    op.create_index('ix_syslog_level_time', 'system_logs', ['level', 'logged_at'], unique=False)
    op.create_index(op.f('ix_system_logs_correlation_id'), 'system_logs', ['correlation_id'], unique=False)
    op.create_index(op.f('ix_system_logs_environment'), 'system_logs', ['environment'], unique=False)
    op.create_index(op.f('ix_system_logs_host'), 'system_logs', ['host'], unique=False)
    op.create_index(op.f('ix_system_logs_level'), 'system_logs', ['level'], unique=False)
    op.create_index(op.f('ix_system_logs_logged_at'), 'system_logs', ['logged_at'], unique=False)
    op.create_index(op.f('ix_system_logs_logger'), 'system_logs', ['logger'], unique=False)
    op.create_index(op.f('ix_system_logs_service'), 'system_logs', ['service'], unique=False)
    op.create_index(op.f('ix_system_logs_status_code'), 'system_logs', ['status_code'], unique=False)
    op.create_index(op.f('ix_system_logs_trace_id'), 'system_logs', ['trace_id'], unique=False)
    op.create_index(op.f('ix_system_logs_user_id'), 'system_logs', ['user_id'], unique=False)
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('category', sa.String(length=24), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('icon', sa.String(length=48), nullable=True),
    sa.Column('is_read', sa.Boolean(), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('link', sa.String(length=500), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=True),
    sa.Column('resource_id', sa.String(length=64), nullable=True),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('actor_label', sa.String(length=160), nullable=True),
    sa.Column('group_key', sa.String(length=96), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_notifications_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_notifications_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications'))
    )
    op.create_index('ix_notification_user_read', 'notifications', ['user_id', 'is_read'], unique=False)
    op.create_index(op.f('ix_notifications_actor_id'), 'notifications', ['actor_id'], unique=False)
    op.create_index(op.f('ix_notifications_category'), 'notifications', ['category'], unique=False)
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_notifications_group_key'), 'notifications', ['group_key'], unique=False)
    op.create_index(op.f('ix_notifications_is_read'), 'notifications', ['is_read'], unique=False)
    op.create_index(op.f('ix_notifications_resource_type'), 'notifications', ['resource_type'], unique=False)
    op.create_index(op.f('ix_notifications_severity'), 'notifications', ['severity'], unique=False)
    op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False)
    op.create_table('scheduled_tasks',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('code', sa.String(length=64), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('cron', sa.String(length=64), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('job_kind', sa.String(length=48), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_status', sa.String(length=24), nullable=True),
    sa.Column('last_duration_ms', sa.Integer(), nullable=True),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('run_count', sa.Integer(), nullable=False),
    sa.Column('failure_count', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_scheduled_tasks_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_scheduled_tasks'))
    )
    op.create_index(op.f('ix_scheduled_tasks_code'), 'scheduled_tasks', ['code'], unique=True)
    op.create_index(op.f('ix_scheduled_tasks_created_at'), 'scheduled_tasks', ['created_at'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_deleted_at'), 'scheduled_tasks', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_enabled'), 'scheduled_tasks', ['enabled'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_job_kind'), 'scheduled_tasks', ['job_kind'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_last_run_at'), 'scheduled_tasks', ['last_run_at'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_last_status'), 'scheduled_tasks', ['last_status'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_name'), 'scheduled_tasks', ['name'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_next_run_at'), 'scheduled_tasks', ['next_run_at'], unique=False)
    op.create_index(op.f('ix_scheduled_tasks_owner_id'), 'scheduled_tasks', ['owner_id'], unique=False)
    op.create_table('feature_flags',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=96), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('environment', sa.String(length=24), nullable=False),
    sa.Column('stage', sa.String(length=24), nullable=False),
    sa.Column('rollout_percentage', sa.Integer(), nullable=False),
    sa.Column('target_user_ids', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('target_group_ids', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('target_roles', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('updated_by_id', sa.UUID(), nullable=True),
    sa.Column('last_toggled_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('experimental', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_feature_flags_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_feature_flags_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_feature_flags'))
    )
    op.create_index(op.f('ix_feature_flags_created_at'), 'feature_flags', ['created_at'], unique=False)
    op.create_index(op.f('ix_feature_flags_enabled'), 'feature_flags', ['enabled'], unique=False)
    op.create_index(op.f('ix_feature_flags_environment'), 'feature_flags', ['environment'], unique=False)
    op.create_index(op.f('ix_feature_flags_experimental'), 'feature_flags', ['experimental'], unique=False)
    op.create_index(op.f('ix_feature_flags_key'), 'feature_flags', ['key'], unique=True)
    op.create_index(op.f('ix_feature_flags_owner_id'), 'feature_flags', ['owner_id'], unique=False)
    op.create_index(op.f('ix_feature_flags_stage'), 'feature_flags', ['stage'], unique=False)
    op.create_index(op.f('ix_feature_flags_updated_by_id'), 'feature_flags', ['updated_by_id'], unique=False)
    op.create_table('integrations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=64), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('provider', sa.String(length=64), nullable=False),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('health', sa.String(length=24), nullable=False),
    sa.Column('last_connected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('last_error_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('configuration', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('required_settings', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('icon', sa.String(length=48), nullable=True),
    sa.Column('docs_url', sa.String(length=300), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_integrations_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_integrations'))
    )
    op.create_index(op.f('ix_integrations_category'), 'integrations', ['category'], unique=False)
    op.create_index(op.f('ix_integrations_created_at'), 'integrations', ['created_at'], unique=False)
    op.create_index(op.f('ix_integrations_deleted_at'), 'integrations', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_integrations_enabled'), 'integrations', ['enabled'], unique=False)
    op.create_index(op.f('ix_integrations_health'), 'integrations', ['health'], unique=False)
    op.create_index(op.f('ix_integrations_key'), 'integrations', ['key'], unique=True)
    op.create_index(op.f('ix_integrations_last_connected_at'), 'integrations', ['last_connected_at'], unique=False)
    op.create_index(op.f('ix_integrations_name'), 'integrations', ['name'], unique=False)
    op.create_index(op.f('ix_integrations_owner_id'), 'integrations', ['owner_id'], unique=False)
    op.create_index(op.f('ix_integrations_provider'), 'integrations', ['provider'], unique=False)
    op.create_index(op.f('ix_integrations_status'), 'integrations', ['status'], unique=False)
    op.create_table('system_settings',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=96), nullable=False),
    sa.Column('category', sa.String(length=48), nullable=False),
    sa.Column('label', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('value', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('default_value', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('value_type', sa.String(length=24), nullable=False),
    sa.Column('options', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('is_secret', sa.Boolean(), nullable=False),
    sa.Column('requires_restart', sa.Boolean(), nullable=False),
    sa.Column('updated_by_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by_id'], ['users.id'], name=op.f('fk_system_settings_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_system_settings'))
    )
    op.create_index(op.f('ix_system_settings_category'), 'system_settings', ['category'], unique=False)
    op.create_index(op.f('ix_system_settings_created_at'), 'system_settings', ['created_at'], unique=False)
    op.create_index(op.f('ix_system_settings_key'), 'system_settings', ['key'], unique=True)
    op.create_index(op.f('ix_system_settings_updated_by_id'), 'system_settings', ['updated_by_id'], unique=False)
    op.create_table('import_runs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=32), nullable=False),
    sa.Column('target_entity', sa.String(length=48), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('step', sa.String(length=24), nullable=False),
    sa.Column('delimiter', sa.String(length=4), nullable=False),
    sa.Column('total_rows', sa.Integer(), nullable=False),
    sa.Column('valid_rows', sa.Integer(), nullable=False),
    sa.Column('invalid_rows', sa.Integer(), nullable=False),
    sa.Column('skipped_rows', sa.Integer(), nullable=False),
    sa.Column('imported_rows', sa.Integer(), nullable=False),
    sa.Column('detected_columns', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('column_mapping', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('staged_rows', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('errors', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_by_id', sa.UUID(), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_import_runs_created_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_import_runs'))
    )
    op.create_index(op.f('ix_import_runs_created_at'), 'import_runs', ['created_at'], unique=False)
    op.create_index(op.f('ix_import_runs_created_by_id'), 'import_runs', ['created_by_id'], unique=False)
    op.create_index(op.f('ix_import_runs_reference'), 'import_runs', ['reference'], unique=True)
    op.create_index(op.f('ix_import_runs_status'), 'import_runs', ['status'], unique=False)
    op.create_index(op.f('ix_import_runs_target_entity'), 'import_runs', ['target_entity'], unique=False)
    op.create_table('customers',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=24), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('legal_name', sa.String(length=220), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('phone', sa.String(length=48), nullable=True),
    sa.Column('website', sa.String(length=255), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('segment', sa.String(length=24), nullable=False),
    sa.Column('industry', sa.String(length=80), nullable=True),
    sa.Column('lifecycle_stage', sa.String(length=24), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('account_manager_id', sa.UUID(), nullable=True),
    sa.Column('region_id', sa.UUID(), nullable=True),
    sa.Column('country', sa.String(length=96), nullable=True),
    sa.Column('city', sa.String(length=96), nullable=True),
    sa.Column('lifetime_value', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('open_orders', sa.Integer(), nullable=False),
    sa.Column('satisfaction', sa.Integer(), nullable=True),
    sa.Column('last_contact_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['account_manager_id'], ['users.id'], name=op.f('fk_customers_account_manager_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_customers_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['region_id'], ['regions.id'], name=op.f('fk_customers_region_id_regions'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_customers'))
    )
    op.create_index(op.f('ix_customers_account_manager_id'), 'customers', ['account_manager_id'], unique=False)
    op.create_index(op.f('ix_customers_code'), 'customers', ['code'], unique=True)
    op.create_index(op.f('ix_customers_country'), 'customers', ['country'], unique=False)
    op.create_index(op.f('ix_customers_created_at'), 'customers', ['created_at'], unique=False)
    op.create_index(op.f('ix_customers_deleted_at'), 'customers', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_customers_email'), 'customers', ['email'], unique=False)
    op.create_index(op.f('ix_customers_industry'), 'customers', ['industry'], unique=False)
    op.create_index(op.f('ix_customers_last_contact_at'), 'customers', ['last_contact_at'], unique=False)
    op.create_index(op.f('ix_customers_lifecycle_stage'), 'customers', ['lifecycle_stage'], unique=False)
    op.create_index(op.f('ix_customers_lifetime_value'), 'customers', ['lifetime_value'], unique=False)
    op.create_index(op.f('ix_customers_name'), 'customers', ['name'], unique=False)
    op.create_index(op.f('ix_customers_organization_id'), 'customers', ['organization_id'], unique=False)
    op.create_index(op.f('ix_customers_region_id'), 'customers', ['region_id'], unique=False)
    op.create_index(op.f('ix_customers_satisfaction'), 'customers', ['satisfaction'], unique=False)
    op.create_index(op.f('ix_customers_segment'), 'customers', ['segment'], unique=False)
    op.create_index(op.f('ix_customers_status'), 'customers', ['status'], unique=False)
    op.create_table('email_threads',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('subject', sa.String(length=300), nullable=False),
    sa.Column('folder', sa.String(length=24), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('message_count', sa.Integer(), nullable=False),
    sa.Column('unread_count', sa.Integer(), nullable=False),
    sa.Column('has_attachments', sa.Boolean(), nullable=False),
    sa.Column('is_starred', sa.Boolean(), nullable=False),
    sa.Column('is_important', sa.Boolean(), nullable=False),
    sa.Column('labels', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('participants', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('snippet', sa.String(length=400), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_email_threads_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_email_threads_owner_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_threads'))
    )
    op.create_index(op.f('ix_email_threads_created_at'), 'email_threads', ['created_at'], unique=False)
    op.create_index(op.f('ix_email_threads_deleted_at'), 'email_threads', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_email_threads_folder'), 'email_threads', ['folder'], unique=False)
    op.create_index(op.f('ix_email_threads_has_attachments'), 'email_threads', ['has_attachments'], unique=False)
    op.create_index(op.f('ix_email_threads_is_important'), 'email_threads', ['is_important'], unique=False)
    op.create_index(op.f('ix_email_threads_is_starred'), 'email_threads', ['is_starred'], unique=False)
    op.create_index(op.f('ix_email_threads_last_message_at'), 'email_threads', ['last_message_at'], unique=False)
    op.create_index(op.f('ix_email_threads_organization_id'), 'email_threads', ['organization_id'], unique=False)
    op.create_index(op.f('ix_email_threads_owner_id'), 'email_threads', ['owner_id'], unique=False)
    op.create_index(op.f('ix_email_threads_subject'), 'email_threads', ['subject'], unique=False)
    op.create_index(op.f('ix_email_threads_unread_count'), 'email_threads', ['unread_count'], unique=False)
    op.create_table('tags',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('slug', sa.String(length=64), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('description', sa.String(length=240), nullable=True),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('created_by_id', sa.UUID(), nullable=True),
    sa.Column('usage_count', sa.Integer(), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_tags_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_tags_organization_id_organizations'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tags'))
    )
    op.create_index(op.f('ix_tags_category'), 'tags', ['category'], unique=False)
    op.create_index(op.f('ix_tags_created_at'), 'tags', ['created_at'], unique=False)
    op.create_index(op.f('ix_tags_created_by_id'), 'tags', ['created_by_id'], unique=False)
    op.create_index(op.f('ix_tags_name'), 'tags', ['name'], unique=False)
    op.create_index(op.f('ix_tags_organization_id'), 'tags', ['organization_id'], unique=False)
    op.create_index(op.f('ix_tags_slug'), 'tags', ['slug'], unique=True)
    op.create_index(op.f('ix_tags_usage_count'), 'tags', ['usage_count'], unique=False)
    op.create_table('kanban_boards',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('key', sa.String(length=12), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('scope', sa.String(length=16), nullable=False),
    sa.Column('is_archived', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_kanban_boards_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_kanban_boards_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_kanban_boards'))
    )
    op.create_index(op.f('ix_kanban_boards_created_at'), 'kanban_boards', ['created_at'], unique=False)
    op.create_index(op.f('ix_kanban_boards_deleted_at'), 'kanban_boards', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_kanban_boards_is_archived'), 'kanban_boards', ['is_archived'], unique=False)
    op.create_index(op.f('ix_kanban_boards_key'), 'kanban_boards', ['key'], unique=False)
    op.create_index(op.f('ix_kanban_boards_organization_id'), 'kanban_boards', ['organization_id'], unique=False)
    op.create_index(op.f('ix_kanban_boards_owner_id'), 'kanban_boards', ['owner_id'], unique=False)
    op.create_index(op.f('ix_kanban_boards_scope'), 'kanban_boards', ['scope'], unique=False)
    op.create_table('groups',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('permissions', postgresql.ARRAY(sa.String(length=64)), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_groups_organization_id_organizations'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_groups')),
    sa.UniqueConstraint('slug', name=op.f('uq_groups_slug'))
    )
    op.create_index(op.f('ix_groups_created_at'), 'groups', ['created_at'], unique=False)
    op.create_index(op.f('ix_groups_deleted_at'), 'groups', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_groups_kind'), 'groups', ['kind'], unique=False)
    op.create_index(op.f('ix_groups_name'), 'groups', ['name'], unique=False)
    op.create_index(op.f('ix_groups_organization_id'), 'groups', ['organization_id'], unique=False)
    op.create_table('saved_searches',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('team_id', sa.UUID(), nullable=True),
    sa.Column('scope', sa.String(length=16), nullable=False),
    sa.Column('condition_tree', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('condition_text', sa.Text(), nullable=True),
    sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('query_text', sa.String(length=500), nullable=True),
    sa.Column('sort', sa.String(length=120), nullable=True),
    sa.Column('order', sa.String(length=8), nullable=False),
    sa.Column('columns', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('page_size', sa.Integer(), nullable=False),
    sa.Column('view_mode', sa.String(length=16), nullable=False),
    sa.Column('is_favorite', sa.Boolean(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('rule_count', sa.Integer(), nullable=False),
    sa.Column('use_count', sa.Integer(), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_saved_searches_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_saved_searches_owner_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_saved_searches_team_id_teams'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_saved_searches'))
    )
    op.create_index('ix_saved_search_owner_scope', 'saved_searches', ['owner_id', 'scope'], unique=False)
    op.create_index(op.f('ix_saved_searches_created_at'), 'saved_searches', ['created_at'], unique=False)
    op.create_index(op.f('ix_saved_searches_deleted_at'), 'saved_searches', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_saved_searches_is_favorite'), 'saved_searches', ['is_favorite'], unique=False)
    op.create_index(op.f('ix_saved_searches_last_used_at'), 'saved_searches', ['last_used_at'], unique=False)
    op.create_index(op.f('ix_saved_searches_name'), 'saved_searches', ['name'], unique=False)
    op.create_index(op.f('ix_saved_searches_organization_id'), 'saved_searches', ['organization_id'], unique=False)
    op.create_index(op.f('ix_saved_searches_owner_id'), 'saved_searches', ['owner_id'], unique=False)
    op.create_index(op.f('ix_saved_searches_resource_type'), 'saved_searches', ['resource_type'], unique=False)
    op.create_index(op.f('ix_saved_searches_scope'), 'saved_searches', ['scope'], unique=False)
    op.create_index(op.f('ix_saved_searches_team_id'), 'saved_searches', ['team_id'], unique=False)
    op.create_index(op.f('ix_saved_searches_use_count'), 'saved_searches', ['use_count'], unique=False)
    op.create_table('dashboards',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('slug', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('scope', sa.String(length=16), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('is_home', sa.Boolean(), nullable=False),
    sa.Column('icon', sa.String(length=48), nullable=True),
    sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('columns', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_dashboards_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_dashboards_owner_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_dashboards'))
    )
    op.create_index(op.f('ix_dashboards_created_at'), 'dashboards', ['created_at'], unique=False)
    op.create_index(op.f('ix_dashboards_deleted_at'), 'dashboards', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_dashboards_is_default'), 'dashboards', ['is_default'], unique=False)
    op.create_index(op.f('ix_dashboards_is_home'), 'dashboards', ['is_home'], unique=False)
    op.create_index(op.f('ix_dashboards_name'), 'dashboards', ['name'], unique=False)
    op.create_index(op.f('ix_dashboards_organization_id'), 'dashboards', ['organization_id'], unique=False)
    op.create_index(op.f('ix_dashboards_owner_id'), 'dashboards', ['owner_id'], unique=False)
    op.create_index(op.f('ix_dashboards_scope'), 'dashboards', ['scope'], unique=False)
    op.create_index(op.f('ix_dashboards_slug'), 'dashboards', ['slug'], unique=False)
    op.create_table('reports',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('scope', sa.String(length=16), nullable=False),
    sa.Column('dimensions', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('metrics', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('condition_tree', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('group_by', sa.String(length=64), nullable=True),
    sa.Column('sort', sa.String(length=64), nullable=True),
    sa.Column('order', sa.String(length=8), nullable=False),
    sa.Column('period', sa.String(length=32), nullable=False),
    sa.Column('visualization', sa.String(length=24), nullable=False),
    sa.Column('is_favorite', sa.Boolean(), nullable=False),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('run_count', sa.Integer(), nullable=False),
    sa.Column('schedule', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_reports_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_reports_owner_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reports'))
    )
    op.create_index(op.f('ix_reports_created_at'), 'reports', ['created_at'], unique=False)
    op.create_index(op.f('ix_reports_deleted_at'), 'reports', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_reports_last_run_at'), 'reports', ['last_run_at'], unique=False)
    op.create_index(op.f('ix_reports_name'), 'reports', ['name'], unique=False)
    op.create_index(op.f('ix_reports_organization_id'), 'reports', ['organization_id'], unique=False)
    op.create_index(op.f('ix_reports_owner_id'), 'reports', ['owner_id'], unique=False)
    op.create_index(op.f('ix_reports_resource_type'), 'reports', ['resource_type'], unique=False)
    op.create_index(op.f('ix_reports_scope'), 'reports', ['scope'], unique=False)
    op.create_index(op.f('ix_reports_visualization'), 'reports', ['visualization'], unique=False)
    op.create_table('audit_logs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('action', sa.String(length=48), nullable=False),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=True),
    sa.Column('resource_label', sa.String(length=255), nullable=True),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('actor_label', sa.String(length=160), nullable=True),
    sa.Column('actor_role', sa.String(length=48), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('result', sa.String(length=16), nullable=False),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.String(length=400), nullable=True),
    sa.Column('correlation_id', sa.String(length=64), nullable=True),
    sa.Column('message', sa.String(length=500), nullable=True),
    sa.Column('state_before', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('state_after', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('changed_fields', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('impersonated', sa.Boolean(), nullable=False),
    sa.Column('impersonator_id', sa.UUID(), nullable=True),
    sa.Column('impersonator_label', sa.String(length=160), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_audit_logs_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['impersonator_id'], ['users.id'], name=op.f('fk_audit_logs_impersonator_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_audit_logs_organization_id_organizations'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_logs'))
    )
    op.create_index('ix_audit_actor_time', 'audit_logs', ['actor_id', 'occurred_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_label'), 'audit_logs', ['actor_label'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_role'), 'audit_logs', ['actor_role'], unique=False)
    op.create_index(op.f('ix_audit_logs_correlation_id'), 'audit_logs', ['correlation_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_impersonated'), 'audit_logs', ['impersonated'], unique=False)
    op.create_index(op.f('ix_audit_logs_impersonator_id'), 'audit_logs', ['impersonator_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_impersonator_label'), 'audit_logs', ['impersonator_label'], unique=False)
    op.create_index(op.f('ix_audit_logs_ip_address'), 'audit_logs', ['ip_address'], unique=False)
    op.create_index(op.f('ix_audit_logs_occurred_at'), 'audit_logs', ['occurred_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_organization_id'), 'audit_logs', ['organization_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_resource_id'), 'audit_logs', ['resource_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_resource_type'), 'audit_logs', ['resource_type'], unique=False)
    op.create_index(op.f('ix_audit_logs_result'), 'audit_logs', ['result'], unique=False)
    op.create_index('ix_audit_resource', 'audit_logs', ['resource_type', 'resource_id'], unique=False)
    op.create_table('background_jobs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=32), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('kind', sa.String(length=48), nullable=False),
    sa.Column('queue', sa.String(length=48), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('total_units', sa.Integer(), nullable=False),
    sa.Column('processed_units', sa.Integer(), nullable=False),
    sa.Column('failed_units', sa.Integer(), nullable=False),
    sa.Column('attempt', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('scheduled_for', sa.DateTime(timezone=True), nullable=True),
    sa.Column('initiated_by_id', sa.UUID(), nullable=True),
    sa.Column('initiated_by_label', sa.String(length=160), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('scheduled_task_id', sa.UUID(), nullable=True),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('log_lines', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['initiated_by_id'], ['users.id'], name=op.f('fk_background_jobs_initiated_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_background_jobs_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scheduled_task_id'], ['scheduled_tasks.id'], name=op.f('fk_background_jobs_scheduled_task_id_scheduled_tasks'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_background_jobs'))
    )
    op.create_index(op.f('ix_background_jobs_created_at'), 'background_jobs', ['created_at'], unique=False)
    op.create_index(op.f('ix_background_jobs_duration_ms'), 'background_jobs', ['duration_ms'], unique=False)
    op.create_index(op.f('ix_background_jobs_finished_at'), 'background_jobs', ['finished_at'], unique=False)
    op.create_index(op.f('ix_background_jobs_initiated_by_id'), 'background_jobs', ['initiated_by_id'], unique=False)
    op.create_index(op.f('ix_background_jobs_kind'), 'background_jobs', ['kind'], unique=False)
    op.create_index(op.f('ix_background_jobs_name'), 'background_jobs', ['name'], unique=False)
    op.create_index(op.f('ix_background_jobs_organization_id'), 'background_jobs', ['organization_id'], unique=False)
    op.create_index(op.f('ix_background_jobs_priority'), 'background_jobs', ['priority'], unique=False)
    op.create_index(op.f('ix_background_jobs_queue'), 'background_jobs', ['queue'], unique=False)
    op.create_index(op.f('ix_background_jobs_reference'), 'background_jobs', ['reference'], unique=True)
    op.create_index(op.f('ix_background_jobs_scheduled_for'), 'background_jobs', ['scheduled_for'], unique=False)
    op.create_index(op.f('ix_background_jobs_scheduled_task_id'), 'background_jobs', ['scheduled_task_id'], unique=False)
    op.create_index(op.f('ix_background_jobs_started_at'), 'background_jobs', ['started_at'], unique=False)
    op.create_index(op.f('ix_background_jobs_status'), 'background_jobs', ['status'], unique=False)
    op.create_table('api_clients',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('client_id', sa.String(length=64), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('scopes', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('rate_limit_per_minute', sa.Integer(), nullable=False),
    sa.Column('quota_per_day', sa.Integer(), nullable=False),
    sa.Column('requests_today', sa.Integer(), nullable=False),
    sa.Column('requests_total', sa.Integer(), nullable=False),
    sa.Column('error_rate', sa.Numeric(precision=6, scale=3), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('allowed_ips', postgresql.ARRAY(sa.String(length=64)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_api_clients_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_api_clients_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_clients'))
    )
    op.create_index(op.f('ix_api_clients_client_id'), 'api_clients', ['client_id'], unique=True)
    op.create_index(op.f('ix_api_clients_created_at'), 'api_clients', ['created_at'], unique=False)
    op.create_index(op.f('ix_api_clients_deleted_at'), 'api_clients', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_api_clients_last_used_at'), 'api_clients', ['last_used_at'], unique=False)
    op.create_index(op.f('ix_api_clients_name'), 'api_clients', ['name'], unique=False)
    op.create_index(op.f('ix_api_clients_organization_id'), 'api_clients', ['organization_id'], unique=False)
    op.create_index(op.f('ix_api_clients_owner_id'), 'api_clients', ['owner_id'], unique=False)
    op.create_index(op.f('ix_api_clients_status'), 'api_clients', ['status'], unique=False)
    op.create_table('alert_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('condition_tree', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('condition_text', sa.Text(), nullable=True),
    sa.Column('actions', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('schedule', sa.String(length=32), nullable=False),
    sa.Column('cooldown_minutes', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('last_triggered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('trigger_count', sa.Integer(), nullable=False),
    sa.Column('last_match_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_alert_rules_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_alert_rules_owner_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_alert_rules'))
    )
    op.create_index(op.f('ix_alert_rules_created_at'), 'alert_rules', ['created_at'], unique=False)
    op.create_index(op.f('ix_alert_rules_deleted_at'), 'alert_rules', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_alert_rules_enabled'), 'alert_rules', ['enabled'], unique=False)
    op.create_index(op.f('ix_alert_rules_last_triggered_at'), 'alert_rules', ['last_triggered_at'], unique=False)
    op.create_index(op.f('ix_alert_rules_name'), 'alert_rules', ['name'], unique=False)
    op.create_index(op.f('ix_alert_rules_organization_id'), 'alert_rules', ['organization_id'], unique=False)
    op.create_index(op.f('ix_alert_rules_owner_id'), 'alert_rules', ['owner_id'], unique=False)
    op.create_index(op.f('ix_alert_rules_resource_type'), 'alert_rules', ['resource_type'], unique=False)
    op.create_index(op.f('ix_alert_rules_severity'), 'alert_rules', ['severity'], unique=False)
    op.create_table('announcements',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('category', sa.String(length=24), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('publish_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('audience_roles', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('requires_acknowledgement', sa.Boolean(), nullable=False),
    sa.Column('is_pinned', sa.Boolean(), nullable=False),
    sa.Column('link', sa.String(length=500), nullable=True),
    sa.Column('author_id', sa.UUID(), nullable=True),
    sa.Column('author_label', sa.String(length=160), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], name=op.f('fk_announcements_author_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_announcements_organization_id_organizations'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_announcements'))
    )
    op.create_index('ix_announcement_live', 'announcements', ['status', 'publish_at', 'expires_at'], unique=False)
    op.create_index(op.f('ix_announcements_author_id'), 'announcements', ['author_id'], unique=False)
    op.create_index(op.f('ix_announcements_category'), 'announcements', ['category'], unique=False)
    op.create_index(op.f('ix_announcements_created_at'), 'announcements', ['created_at'], unique=False)
    op.create_index(op.f('ix_announcements_deleted_at'), 'announcements', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_announcements_expires_at'), 'announcements', ['expires_at'], unique=False)
    op.create_index(op.f('ix_announcements_is_pinned'), 'announcements', ['is_pinned'], unique=False)
    op.create_index(op.f('ix_announcements_organization_id'), 'announcements', ['organization_id'], unique=False)
    op.create_index(op.f('ix_announcements_publish_at'), 'announcements', ['publish_at'], unique=False)
    op.create_index(op.f('ix_announcements_severity'), 'announcements', ['severity'], unique=False)
    op.create_index(op.f('ix_announcements_status'), 'announcements', ['status'], unique=False)
    op.create_table('projects',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('code', sa.String(length=24), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('phase', sa.String(length=24), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('health', sa.String(length=16), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('department_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('customer_id', sa.UUID(), nullable=True),
    sa.Column('region_id', sa.UUID(), nullable=True),
    sa.Column('start_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('budget', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('spent', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('task_count', sa.Integer(), nullable=False),
    sa.Column('open_task_count', sa.Integer(), nullable=False),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_projects_customer_id_customers'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['department_id'], ['departments.id'], name=op.f('fk_projects_department_id_departments'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_projects_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_projects_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['region_id'], ['regions.id'], name=op.f('fk_projects_region_id_regions'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects'))
    )
    op.create_index(op.f('ix_projects_code'), 'projects', ['code'], unique=True)
    op.create_index(op.f('ix_projects_created_at'), 'projects', ['created_at'], unique=False)
    op.create_index(op.f('ix_projects_customer_id'), 'projects', ['customer_id'], unique=False)
    op.create_index(op.f('ix_projects_deleted_at'), 'projects', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_projects_department_id'), 'projects', ['department_id'], unique=False)
    op.create_index(op.f('ix_projects_due_date'), 'projects', ['due_date'], unique=False)
    op.create_index(op.f('ix_projects_health'), 'projects', ['health'], unique=False)
    op.create_index(op.f('ix_projects_name'), 'projects', ['name'], unique=False)
    op.create_index(op.f('ix_projects_organization_id'), 'projects', ['organization_id'], unique=False)
    op.create_index(op.f('ix_projects_owner_id'), 'projects', ['owner_id'], unique=False)
    op.create_index(op.f('ix_projects_phase'), 'projects', ['phase'], unique=False)
    op.create_index(op.f('ix_projects_priority'), 'projects', ['priority'], unique=False)
    op.create_index(op.f('ix_projects_progress'), 'projects', ['progress'], unique=False)
    op.create_index(op.f('ix_projects_region_id'), 'projects', ['region_id'], unique=False)
    op.create_index(op.f('ix_projects_start_date'), 'projects', ['start_date'], unique=False)
    op.create_index(op.f('ix_projects_status'), 'projects', ['status'], unique=False)
    op.create_table('orders',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=24), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('payment_status', sa.String(length=24), nullable=False),
    sa.Column('fulfilment_status', sa.String(length=24), nullable=False),
    sa.Column('channel', sa.String(length=24), nullable=False),
    sa.Column('customer_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('region_id', sa.UUID(), nullable=True),
    sa.Column('department_id', sa.UUID(), nullable=True),
    sa.Column('placed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('shipped_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('subtotal', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('tax', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('shipping', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('discount', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('total', sa.Numeric(precision=14, scale=2), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('item_count', sa.Integer(), nullable=False),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_orders_customer_id_customers'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['department_id'], ['departments.id'], name=op.f('fk_orders_department_id_departments'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_orders_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_orders_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['region_id'], ['regions.id'], name=op.f('fk_orders_region_id_regions'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_orders'))
    )
    op.create_index(op.f('ix_orders_channel'), 'orders', ['channel'], unique=False)
    op.create_index(op.f('ix_orders_created_at'), 'orders', ['created_at'], unique=False)
    op.create_index(op.f('ix_orders_customer_id'), 'orders', ['customer_id'], unique=False)
    op.create_index(op.f('ix_orders_deleted_at'), 'orders', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_orders_department_id'), 'orders', ['department_id'], unique=False)
    op.create_index(op.f('ix_orders_fulfilment_status'), 'orders', ['fulfilment_status'], unique=False)
    op.create_index(op.f('ix_orders_organization_id'), 'orders', ['organization_id'], unique=False)
    op.create_index(op.f('ix_orders_owner_id'), 'orders', ['owner_id'], unique=False)
    op.create_index(op.f('ix_orders_payment_status'), 'orders', ['payment_status'], unique=False)
    op.create_index(op.f('ix_orders_placed_at'), 'orders', ['placed_at'], unique=False)
    op.create_index(op.f('ix_orders_reference'), 'orders', ['reference'], unique=True)
    op.create_index(op.f('ix_orders_region_id'), 'orders', ['region_id'], unique=False)
    op.create_index(op.f('ix_orders_status'), 'orders', ['status'], unique=False)
    op.create_index(op.f('ix_orders_total'), 'orders', ['total'], unique=False)
    op.create_table('email_messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('thread_id', sa.UUID(), nullable=True),
    sa.Column('message_ref', sa.String(length=64), nullable=False),
    sa.Column('subject', sa.String(length=300), nullable=False),
    sa.Column('from_name', sa.String(length=160), nullable=False),
    sa.Column('from_email', sa.String(length=255), nullable=False),
    sa.Column('to_recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('cc_recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('bcc_recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('body_html', sa.Text(), nullable=True),
    sa.Column('body_text', sa.Text(), nullable=True),
    sa.Column('preview', sa.String(length=400), nullable=True),
    sa.Column('folder', sa.String(length=24), nullable=False),
    sa.Column('is_read', sa.Boolean(), nullable=False),
    sa.Column('is_starred', sa.Boolean(), nullable=False),
    sa.Column('is_draft', sa.Boolean(), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('labels', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('sender_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('scheduled_for', sa.DateTime(timezone=True), nullable=True),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('attachment_count', sa.Integer(), nullable=False),
    sa.Column('in_reply_to', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['in_reply_to'], ['email_messages.id'], name=op.f('fk_email_messages_in_reply_to_email_messages'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_email_messages_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], name=op.f('fk_email_messages_sender_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['thread_id'], ['email_threads.id'], name=op.f('fk_email_messages_thread_id_email_threads'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_messages'))
    )
    op.create_index(op.f('ix_email_messages_created_at'), 'email_messages', ['created_at'], unique=False)
    op.create_index(op.f('ix_email_messages_deleted_at'), 'email_messages', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_email_messages_folder'), 'email_messages', ['folder'], unique=False)
    op.create_index(op.f('ix_email_messages_from_email'), 'email_messages', ['from_email'], unique=False)
    op.create_index(op.f('ix_email_messages_from_name'), 'email_messages', ['from_name'], unique=False)
    op.create_index(op.f('ix_email_messages_in_reply_to'), 'email_messages', ['in_reply_to'], unique=False)
    op.create_index(op.f('ix_email_messages_is_draft'), 'email_messages', ['is_draft'], unique=False)
    op.create_index(op.f('ix_email_messages_is_read'), 'email_messages', ['is_read'], unique=False)
    op.create_index(op.f('ix_email_messages_is_starred'), 'email_messages', ['is_starred'], unique=False)
    op.create_index(op.f('ix_email_messages_message_ref'), 'email_messages', ['message_ref'], unique=True)
    op.create_index(op.f('ix_email_messages_owner_id'), 'email_messages', ['owner_id'], unique=False)
    op.create_index(op.f('ix_email_messages_priority'), 'email_messages', ['priority'], unique=False)
    op.create_index(op.f('ix_email_messages_scheduled_for'), 'email_messages', ['scheduled_for'], unique=False)
    op.create_index(op.f('ix_email_messages_sender_id'), 'email_messages', ['sender_id'], unique=False)
    op.create_index(op.f('ix_email_messages_sent_at'), 'email_messages', ['sent_at'], unique=False)
    op.create_index(op.f('ix_email_messages_subject'), 'email_messages', ['subject'], unique=False)
    op.create_index(op.f('ix_email_messages_thread_id'), 'email_messages', ['thread_id'], unique=False)
    op.create_table('tag_links',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('tag_id', sa.UUID(), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('resource_id', sa.String(length=64), nullable=False),
    sa.Column('assigned_by_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assigned_by_id'], ['users.id'], name=op.f('fk_tag_links_assigned_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_tag_links_tag_id_tags'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tag_links')),
    sa.UniqueConstraint('tag_id', 'resource_type', 'resource_id', name='uq_tag_link')
    )
    op.create_index(op.f('ix_tag_links_assigned_by_id'), 'tag_links', ['assigned_by_id'], unique=False)
    op.create_index(op.f('ix_tag_links_created_at'), 'tag_links', ['created_at'], unique=False)
    op.create_index(op.f('ix_tag_links_resource_id'), 'tag_links', ['resource_id'], unique=False)
    op.create_index(op.f('ix_tag_links_resource_type'), 'tag_links', ['resource_type'], unique=False)
    op.create_index(op.f('ix_tag_links_tag_id'), 'tag_links', ['tag_id'], unique=False)
    op.create_table('kanban_lanes',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('board_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('wip_limit', sa.Integer(), nullable=True),
    sa.Column('is_done', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['board_id'], ['kanban_boards.id'], name=op.f('fk_kanban_lanes_board_id_kanban_boards'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_kanban_lanes'))
    )
    op.create_index('ix_kanban_lane_board_position', 'kanban_lanes', ['board_id', 'position'], unique=False)
    op.create_index(op.f('ix_kanban_lanes_board_id'), 'kanban_lanes', ['board_id'], unique=False)
    op.create_index(op.f('ix_kanban_lanes_created_at'), 'kanban_lanes', ['created_at'], unique=False)
    op.create_index(op.f('ix_kanban_lanes_deleted_at'), 'kanban_lanes', ['deleted_at'], unique=False)
    op.create_table('user_groups',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('group_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['groups.id'], name=op.f('fk_user_groups_group_id_groups'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_groups_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'group_id', name=op.f('pk_user_groups'))
    )
    op.create_table('dashboard_widgets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('dashboard_id', sa.UUID(), nullable=True),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('subtitle', sa.String(length=240), nullable=True),
    sa.Column('x', sa.Integer(), nullable=False),
    sa.Column('y', sa.Integer(), nullable=False),
    sa.Column('width', sa.Integer(), nullable=False),
    sa.Column('height', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('config', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], name=op.f('fk_dashboard_widgets_dashboard_id_dashboards'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_dashboard_widgets'))
    )
    op.create_index(op.f('ix_dashboard_widgets_created_at'), 'dashboard_widgets', ['created_at'], unique=False)
    op.create_index(op.f('ix_dashboard_widgets_dashboard_id'), 'dashboard_widgets', ['dashboard_id'], unique=False)
    op.create_index(op.f('ix_dashboard_widgets_kind'), 'dashboard_widgets', ['kind'], unique=False)
    op.create_index(op.f('ix_dashboard_widgets_position'), 'dashboard_widgets', ['position'], unique=False)
    op.create_table('api_credentials',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('api_client_id', sa.UUID(), nullable=True),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('prefix', sa.String(length=12), nullable=False),
    sa.Column('secret_hash', sa.String(length=255), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('created_by_id', sa.UUID(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_by_id', sa.UUID(), nullable=True),
    sa.Column('rotated_from_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['api_client_id'], ['api_clients.id'], name=op.f('fk_api_credentials_api_client_id_api_clients'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_id'], ['users.id'], name=op.f('fk_api_credentials_created_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['revoked_by_id'], ['users.id'], name=op.f('fk_api_credentials_revoked_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['rotated_from_id'], ['api_credentials.id'], name=op.f('fk_api_credentials_rotated_from_id_api_credentials'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_credentials'))
    )
    op.create_index(op.f('ix_api_credentials_api_client_id'), 'api_credentials', ['api_client_id'], unique=False)
    op.create_index(op.f('ix_api_credentials_created_at'), 'api_credentials', ['created_at'], unique=False)
    op.create_index(op.f('ix_api_credentials_created_by_id'), 'api_credentials', ['created_by_id'], unique=False)
    op.create_index(op.f('ix_api_credentials_expires_at'), 'api_credentials', ['expires_at'], unique=False)
    op.create_index(op.f('ix_api_credentials_prefix'), 'api_credentials', ['prefix'], unique=False)
    op.create_index(op.f('ix_api_credentials_revoked_at'), 'api_credentials', ['revoked_at'], unique=False)
    op.create_index(op.f('ix_api_credentials_revoked_by_id'), 'api_credentials', ['revoked_by_id'], unique=False)
    op.create_index(op.f('ix_api_credentials_rotated_from_id'), 'api_credentials', ['rotated_from_id'], unique=False)
    op.create_index(op.f('ix_api_credentials_status'), 'api_credentials', ['status'], unique=False)
    op.create_table('api_request_logs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('api_client_id', sa.UUID(), nullable=True),
    sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('method', sa.String(length=8), nullable=False),
    sa.Column('path', sa.String(length=300), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('duration_ms', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('bytes_out', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['api_client_id'], ['api_clients.id'], name=op.f('fk_api_request_logs_api_client_id_api_clients'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_request_logs'))
    )
    op.create_index(op.f('ix_api_request_logs_api_client_id'), 'api_request_logs', ['api_client_id'], unique=False)
    op.create_index(op.f('ix_api_request_logs_path'), 'api_request_logs', ['path'], unique=False)
    op.create_index(op.f('ix_api_request_logs_requested_at'), 'api_request_logs', ['requested_at'], unique=False)
    op.create_index(op.f('ix_api_request_logs_status_code'), 'api_request_logs', ['status_code'], unique=False)
    op.create_index('ix_apilog_client_time', 'api_request_logs', ['api_client_id', 'requested_at'], unique=False)
    op.create_table('announcement_receipts',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('announcement_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['announcement_id'], ['announcements.id'], name=op.f('fk_announcement_receipts_announcement_id_announcements'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_announcement_receipts_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_announcement_receipts'))
    )
    op.create_index(op.f('ix_announcement_receipts_announcement_id'), 'announcement_receipts', ['announcement_id'], unique=False)
    op.create_index(op.f('ix_announcement_receipts_created_at'), 'announcement_receipts', ['created_at'], unique=False)
    op.create_index(op.f('ix_announcement_receipts_user_id'), 'announcement_receipts', ['user_id'], unique=False)
    op.create_index('ux_announcement_receipt', 'announcement_receipts', ['announcement_id', 'user_id'], unique=True)
    op.create_table('alert_rule_runs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rule_id', sa.UUID(), nullable=False),
    sa.Column('dry_run', sa.Boolean(), nullable=False),
    sa.Column('triggered_by_id', sa.UUID(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('matched', sa.Integer(), nullable=False),
    sa.Column('fired', sa.Integer(), nullable=False),
    sa.Column('suppressed', sa.Integer(), nullable=False),
    sa.Column('deferred', sa.Integer(), nullable=False),
    sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], name=op.f('fk_alert_rule_runs_rule_id_alert_rules'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['triggered_by_id'], ['users.id'], name=op.f('fk_alert_rule_runs_triggered_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_alert_rule_runs'))
    )
    op.create_index(op.f('ix_alert_rule_runs_created_at'), 'alert_rule_runs', ['created_at'], unique=False)
    op.create_index(op.f('ix_alert_rule_runs_dry_run'), 'alert_rule_runs', ['dry_run'], unique=False)
    op.create_index(op.f('ix_alert_rule_runs_rule_id'), 'alert_rule_runs', ['rule_id'], unique=False)
    op.create_index(op.f('ix_alert_rule_runs_started_at'), 'alert_rule_runs', ['started_at'], unique=False)
    op.create_index(op.f('ix_alert_rule_runs_triggered_by_id'), 'alert_rule_runs', ['triggered_by_id'], unique=False)
    op.create_index('ix_alert_run_rule_time', 'alert_rule_runs', ['rule_id', 'started_at'], unique=False)
    op.create_table('alert_rule_fires',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rule_id', sa.UUID(), nullable=False),
    sa.Column('record_id', sa.String(length=64), nullable=False),
    sa.Column('record_label', sa.String(length=240), nullable=True),
    sa.Column('last_fired_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('fire_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], name=op.f('fk_alert_rule_fires_rule_id_alert_rules'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_alert_rule_fires')),
    sa.UniqueConstraint('rule_id', 'record_id', name='uq_alert_fire_record')
    )
    op.create_index('ix_alert_fire_recent', 'alert_rule_fires', ['rule_id', 'last_fired_at'], unique=False)
    op.create_index(op.f('ix_alert_rule_fires_created_at'), 'alert_rule_fires', ['created_at'], unique=False)
    op.create_index(op.f('ix_alert_rule_fires_rule_id'), 'alert_rule_fires', ['rule_id'], unique=False)
    op.create_table('tickets',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=24), nullable=False),
    sa.Column('subject', sa.String(length=240), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('category', sa.String(length=48), nullable=False),
    sa.Column('channel', sa.String(length=24), nullable=False),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('customer_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('reporter_id', sa.UUID(), nullable=True),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('first_response_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('resolution_minutes', sa.Integer(), nullable=True),
    sa.Column('sla_breached', sa.Boolean(), nullable=False),
    sa.Column('reopen_count', sa.Integer(), nullable=False),
    sa.Column('satisfaction', sa.Integer(), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_tickets_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], name=op.f('fk_tickets_customer_id_customers'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_tickets_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_tickets_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], name=op.f('fk_tickets_reporter_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tickets'))
    )
    op.create_index(op.f('ix_tickets_assignee_id'), 'tickets', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_tickets_category'), 'tickets', ['category'], unique=False)
    op.create_index(op.f('ix_tickets_channel'), 'tickets', ['channel'], unique=False)
    op.create_index(op.f('ix_tickets_created_at'), 'tickets', ['created_at'], unique=False)
    op.create_index(op.f('ix_tickets_customer_id'), 'tickets', ['customer_id'], unique=False)
    op.create_index(op.f('ix_tickets_deleted_at'), 'tickets', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_tickets_due_at'), 'tickets', ['due_at'], unique=False)
    op.create_index(op.f('ix_tickets_organization_id'), 'tickets', ['organization_id'], unique=False)
    op.create_index(op.f('ix_tickets_priority'), 'tickets', ['priority'], unique=False)
    op.create_index(op.f('ix_tickets_project_id'), 'tickets', ['project_id'], unique=False)
    op.create_index(op.f('ix_tickets_reference'), 'tickets', ['reference'], unique=True)
    op.create_index(op.f('ix_tickets_reporter_id'), 'tickets', ['reporter_id'], unique=False)
    op.create_index(op.f('ix_tickets_resolution_minutes'), 'tickets', ['resolution_minutes'], unique=False)
    op.create_index(op.f('ix_tickets_resolved_at'), 'tickets', ['resolved_at'], unique=False)
    op.create_index(op.f('ix_tickets_severity'), 'tickets', ['severity'], unique=False)
    op.create_index(op.f('ix_tickets_sla_breached'), 'tickets', ['sla_breached'], unique=False)
    op.create_index(op.f('ix_tickets_status'), 'tickets', ['status'], unique=False)
    op.create_index(op.f('ix_tickets_subject'), 'tickets', ['subject'], unique=False)
    op.create_table('tasks',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('reference', sa.String(length=24), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('requester_id', sa.UUID(), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('estimate_hours', sa.Numeric(precision=8, scale=2), nullable=True),
    sa.Column('logged_hours', sa.Numeric(precision=8, scale=2), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('board_position', sa.Integer(), nullable=False),
    sa.Column('blocked_reason', sa.String(length=240), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('checklist', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_tasks_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_tasks_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['tasks.id'], name=op.f('fk_tasks_parent_id_tasks'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_tasks_project_id_projects'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['requester_id'], ['users.id'], name=op.f('fk_tasks_requester_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tasks'))
    )
    op.create_index(op.f('ix_tasks_assignee_id'), 'tasks', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_tasks_board_position'), 'tasks', ['board_position'], unique=False)
    op.create_index(op.f('ix_tasks_completed_at'), 'tasks', ['completed_at'], unique=False)
    op.create_index(op.f('ix_tasks_created_at'), 'tasks', ['created_at'], unique=False)
    op.create_index(op.f('ix_tasks_deleted_at'), 'tasks', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_tasks_due_date'), 'tasks', ['due_date'], unique=False)
    op.create_index(op.f('ix_tasks_kind'), 'tasks', ['kind'], unique=False)
    op.create_index(op.f('ix_tasks_organization_id'), 'tasks', ['organization_id'], unique=False)
    op.create_index(op.f('ix_tasks_parent_id'), 'tasks', ['parent_id'], unique=False)
    op.create_index(op.f('ix_tasks_priority'), 'tasks', ['priority'], unique=False)
    op.create_index(op.f('ix_tasks_project_id'), 'tasks', ['project_id'], unique=False)
    op.create_index(op.f('ix_tasks_reference'), 'tasks', ['reference'], unique=True)
    op.create_index(op.f('ix_tasks_requester_id'), 'tasks', ['requester_id'], unique=False)
    op.create_index(op.f('ix_tasks_status'), 'tasks', ['status'], unique=False)
    op.create_index(op.f('ix_tasks_title'), 'tasks', ['title'], unique=False)
    op.create_table('devices',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('serial', sa.String(length=48), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('model', sa.String(length=96), nullable=True),
    sa.Column('manufacturer', sa.String(length=96), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('firmware', sa.String(length=32), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('location', sa.String(length=160), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('region_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('battery_percent', sa.Integer(), nullable=True),
    sa.Column('signal_strength', sa.Integer(), nullable=True),
    sa.Column('uptime_hours', sa.Integer(), nullable=False),
    sa.Column('error_count', sa.Integer(), nullable=False),
    sa.Column('warranty_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_devices_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_devices_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_devices_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['region_id'], ['regions.id'], name=op.f('fk_devices_region_id_regions'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_devices'))
    )
    op.create_index(op.f('ix_devices_created_at'), 'devices', ['created_at'], unique=False)
    op.create_index(op.f('ix_devices_deleted_at'), 'devices', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_devices_error_count'), 'devices', ['error_count'], unique=False)
    op.create_index(op.f('ix_devices_kind'), 'devices', ['kind'], unique=False)
    op.create_index(op.f('ix_devices_last_seen_at'), 'devices', ['last_seen_at'], unique=False)
    op.create_index(op.f('ix_devices_location'), 'devices', ['location'], unique=False)
    op.create_index(op.f('ix_devices_manufacturer'), 'devices', ['manufacturer'], unique=False)
    op.create_index(op.f('ix_devices_model'), 'devices', ['model'], unique=False)
    op.create_index(op.f('ix_devices_name'), 'devices', ['name'], unique=False)
    op.create_index(op.f('ix_devices_organization_id'), 'devices', ['organization_id'], unique=False)
    op.create_index(op.f('ix_devices_owner_id'), 'devices', ['owner_id'], unique=False)
    op.create_index(op.f('ix_devices_project_id'), 'devices', ['project_id'], unique=False)
    op.create_index(op.f('ix_devices_region_id'), 'devices', ['region_id'], unique=False)
    op.create_index(op.f('ix_devices_serial'), 'devices', ['serial'], unique=True)
    op.create_index(op.f('ix_devices_status'), 'devices', ['status'], unique=False)
    op.create_table('folders',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('path', sa.String(length=1000), nullable=False),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('is_shared', sa.Boolean(), nullable=False),
    sa.Column('color', sa.String(length=16), nullable=True),
    sa.Column('file_count', sa.Integer(), nullable=False),
    sa.Column('total_size', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_folders_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_folders_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['folders.id'], name=op.f('fk_folders_parent_id_folders'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_folders_project_id_projects'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_folders'))
    )
    op.create_index(op.f('ix_folders_created_at'), 'folders', ['created_at'], unique=False)
    op.create_index(op.f('ix_folders_deleted_at'), 'folders', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_folders_is_shared'), 'folders', ['is_shared'], unique=False)
    op.create_index(op.f('ix_folders_name'), 'folders', ['name'], unique=False)
    op.create_index(op.f('ix_folders_organization_id'), 'folders', ['organization_id'], unique=False)
    op.create_index(op.f('ix_folders_owner_id'), 'folders', ['owner_id'], unique=False)
    op.create_index(op.f('ix_folders_parent_id'), 'folders', ['parent_id'], unique=False)
    op.create_index(op.f('ix_folders_path'), 'folders', ['path'], unique=False)
    op.create_index(op.f('ix_folders_project_id'), 'folders', ['project_id'], unique=False)
    op.create_table('kanban_cards',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('board_id', sa.UUID(), nullable=False),
    sa.Column('lane_id', sa.UUID(), nullable=True),
    sa.Column('reference', sa.String(length=32), nullable=False),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('parent_id', sa.UUID(), nullable=True),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('priority', sa.String(length=16), nullable=False),
    sa.Column('story_points', sa.Numeric(precision=5, scale=1), nullable=True),
    sa.Column('assignee_id', sa.UUID(), nullable=True),
    sa.Column('reporter_id', sa.UUID(), nullable=True),
    sa.Column('labels', postgresql.ARRAY(sa.String(length=40)), nullable=True),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('checklist', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], name=op.f('fk_kanban_cards_assignee_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['board_id'], ['kanban_boards.id'], name=op.f('fk_kanban_cards_board_id_kanban_boards'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['lane_id'], ['kanban_lanes.id'], name=op.f('fk_kanban_cards_lane_id_kanban_lanes'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['parent_id'], ['kanban_cards.id'], name=op.f('fk_kanban_cards_parent_id_kanban_cards'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['reporter_id'], ['users.id'], name=op.f('fk_kanban_cards_reporter_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_kanban_cards'))
    )
    op.create_index('ix_kanban_card_board_kind', 'kanban_cards', ['board_id', 'kind'], unique=False)
    op.create_index('ix_kanban_card_lane_position', 'kanban_cards', ['lane_id', 'position'], unique=False)
    op.create_index(op.f('ix_kanban_cards_assignee_id'), 'kanban_cards', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_kanban_cards_board_id'), 'kanban_cards', ['board_id'], unique=False)
    op.create_index(op.f('ix_kanban_cards_created_at'), 'kanban_cards', ['created_at'], unique=False)
    op.create_index(op.f('ix_kanban_cards_deleted_at'), 'kanban_cards', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_kanban_cards_kind'), 'kanban_cards', ['kind'], unique=False)
    op.create_index(op.f('ix_kanban_cards_lane_id'), 'kanban_cards', ['lane_id'], unique=False)
    op.create_index(op.f('ix_kanban_cards_parent_id'), 'kanban_cards', ['parent_id'], unique=False)
    op.create_index(op.f('ix_kanban_cards_priority'), 'kanban_cards', ['priority'], unique=False)
    op.create_index(op.f('ix_kanban_cards_reference'), 'kanban_cards', ['reference'], unique=True)
    op.create_index(op.f('ix_kanban_cards_reporter_id'), 'kanban_cards', ['reporter_id'], unique=False)
    op.create_table('activity_entries',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('action', sa.String(length=48), nullable=False),
    sa.Column('actor_id', sa.UUID(), nullable=True),
    sa.Column('actor_label', sa.String(length=160), nullable=True),
    sa.Column('resource_type', sa.String(length=48), nullable=True),
    sa.Column('resource_id', sa.String(length=64), nullable=True),
    sa.Column('resource_label', sa.String(length=255), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('summary', sa.String(length=500), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], name=op.f('fk_activity_entries_actor_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_activity_entries_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_activity_entries_project_id_projects'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_activity_entries'))
    )
    op.create_index(op.f('ix_activity_entries_action'), 'activity_entries', ['action'], unique=False)
    op.create_index(op.f('ix_activity_entries_actor_id'), 'activity_entries', ['actor_id'], unique=False)
    op.create_index(op.f('ix_activity_entries_created_at'), 'activity_entries', ['created_at'], unique=False)
    op.create_index(op.f('ix_activity_entries_kind'), 'activity_entries', ['kind'], unique=False)
    op.create_index(op.f('ix_activity_entries_occurred_at'), 'activity_entries', ['occurred_at'], unique=False)
    op.create_index(op.f('ix_activity_entries_organization_id'), 'activity_entries', ['organization_id'], unique=False)
    op.create_index(op.f('ix_activity_entries_project_id'), 'activity_entries', ['project_id'], unique=False)
    op.create_index(op.f('ix_activity_entries_resource_id'), 'activity_entries', ['resource_id'], unique=False)
    op.create_index(op.f('ix_activity_entries_resource_type'), 'activity_entries', ['resource_type'], unique=False)
    op.create_index('ix_activity_resource', 'activity_entries', ['resource_type', 'resource_id'], unique=False)
    op.create_table('calendar_events',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('title', sa.String(length=240), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('location', sa.String(length=200), nullable=True),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('all_day', sa.Boolean(), nullable=False),
    sa.Column('organizer_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('participants', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('recurrence', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('recurrence_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('reminder_minutes', sa.Integer(), nullable=True),
    sa.Column('color', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_calendar_events_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['organizer_id'], ['users.id'], name=op.f('fk_calendar_events_organizer_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_calendar_events_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_calendar_events_task_id_tasks'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_calendar_events'))
    )
    op.create_index(op.f('ix_calendar_events_category'), 'calendar_events', ['category'], unique=False)
    op.create_index(op.f('ix_calendar_events_created_at'), 'calendar_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_calendar_events_deleted_at'), 'calendar_events', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_calendar_events_ends_at'), 'calendar_events', ['ends_at'], unique=False)
    op.create_index(op.f('ix_calendar_events_organization_id'), 'calendar_events', ['organization_id'], unique=False)
    op.create_index(op.f('ix_calendar_events_organizer_id'), 'calendar_events', ['organizer_id'], unique=False)
    op.create_index(op.f('ix_calendar_events_project_id'), 'calendar_events', ['project_id'], unique=False)
    op.create_index(op.f('ix_calendar_events_recurrence_until'), 'calendar_events', ['recurrence_until'], unique=False)
    op.create_index(op.f('ix_calendar_events_starts_at'), 'calendar_events', ['starts_at'], unique=False)
    op.create_index(op.f('ix_calendar_events_status'), 'calendar_events', ['status'], unique=False)
    op.create_index(op.f('ix_calendar_events_task_id'), 'calendar_events', ['task_id'], unique=False)
    op.create_index(op.f('ix_calendar_events_title'), 'calendar_events', ['title'], unique=False)
    op.create_table('files',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('extension', sa.String(length=16), nullable=True),
    sa.Column('mime_type', sa.String(length=128), nullable=True),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('checksum', sa.String(length=64), nullable=True),
    sa.Column('storage_key', sa.String(length=500), nullable=True),
    sa.Column('folder_id', sa.UUID(), nullable=True),
    sa.Column('organization_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('owner_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('visibility', sa.String(length=24), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('download_count', sa.Integer(), nullable=False),
    sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('preview_text', sa.Text(), nullable=True),
    sa.Column('tags', postgresql.ARRAY(sa.String(length=48)), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.ForeignKeyConstraint(['folder_id'], ['folders.id'], name=op.f('fk_files_folder_id_folders'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name=op.f('fk_files_organization_id_organizations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name=op.f('fk_files_owner_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_files_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_files_task_id_tasks'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_files'))
    )
    op.create_index(op.f('ix_files_checksum'), 'files', ['checksum'], unique=False)
    op.create_index(op.f('ix_files_created_at'), 'files', ['created_at'], unique=False)
    op.create_index(op.f('ix_files_deleted_at'), 'files', ['deleted_at'], unique=False)
    op.create_index(op.f('ix_files_extension'), 'files', ['extension'], unique=False)
    op.create_index(op.f('ix_files_folder_id'), 'files', ['folder_id'], unique=False)
    op.create_index(op.f('ix_files_kind'), 'files', ['kind'], unique=False)
    op.create_index(op.f('ix_files_last_accessed_at'), 'files', ['last_accessed_at'], unique=False)
    op.create_index(op.f('ix_files_mime_type'), 'files', ['mime_type'], unique=False)
    op.create_index(op.f('ix_files_name'), 'files', ['name'], unique=False)
    op.create_index(op.f('ix_files_organization_id'), 'files', ['organization_id'], unique=False)
    op.create_index(op.f('ix_files_owner_id'), 'files', ['owner_id'], unique=False)
    op.create_index(op.f('ix_files_project_id'), 'files', ['project_id'], unique=False)
    op.create_index(op.f('ix_files_size_bytes'), 'files', ['size_bytes'], unique=False)
    op.create_index(op.f('ix_files_status'), 'files', ['status'], unique=False)
    op.create_index(op.f('ix_files_task_id'), 'files', ['task_id'], unique=False)
    op.create_index(op.f('ix_files_visibility'), 'files', ['visibility'], unique=False)
    op.create_table('email_attachments',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('message_id', sa.UUID(), nullable=True),
    sa.Column('file_id', sa.UUID(), nullable=True),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('mime_type', sa.String(length=128), nullable=True),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('inline', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['file_id'], ['files.id'], name=op.f('fk_email_attachments_file_id_files'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['message_id'], ['email_messages.id'], name=op.f('fk_email_attachments_message_id_email_messages'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_email_attachments'))
    )
    op.create_index(op.f('ix_email_attachments_created_at'), 'email_attachments', ['created_at'], unique=False)
    op.create_index(op.f('ix_email_attachments_file_id'), 'email_attachments', ['file_id'], unique=False)
    op.create_index(op.f('ix_email_attachments_message_id'), 'email_attachments', ['message_id'], unique=False)
    # ### end Alembic commands ###

    # The cycle, closed once every table it runs through exists.
    op.create_foreign_key(
        'fk_teams_department_id_departments',
        'teams',
        'departments',
        ['department_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_teams_organization_id_organizations',
        'teams',
        'organizations',
        ['organization_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_users_role_id_roles',
        'users',
        'roles',
        ['role_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_departments_parent_id_departments',
        'departments',
        'departments',
        ['parent_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_departments_organization_id_organizations',
        'departments',
        'organizations',
        ['organization_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_users_manager_id_users',
        'users',
        'users',
        ['manager_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_users_organization_id_organizations',
        'users',
        'organizations',
        ['organization_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_departments_manager_id_users',
        'departments',
        'users',
        ['manager_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_users_department_id_departments',
        'users',
        'departments',
        ['department_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_users_team_id_teams',
        'users',
        'teams',
        ['team_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_foreign_key(
        'fk_teams_lead_id_users',
        'teams',
        'users',
        ['lead_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    # The cycle first, so the tables can go in reverse order.
    op.drop_constraint('fk_teams_department_id_departments', 'teams', type_='foreignkey')
    op.drop_constraint('fk_teams_organization_id_organizations', 'teams', type_='foreignkey')
    op.drop_constraint('fk_users_role_id_roles', 'users', type_='foreignkey')
    op.drop_constraint('fk_departments_parent_id_departments', 'departments', type_='foreignkey')
    op.drop_constraint('fk_departments_organization_id_organizations', 'departments', type_='foreignkey')
    op.drop_constraint('fk_users_manager_id_users', 'users', type_='foreignkey')
    op.drop_constraint('fk_users_organization_id_organizations', 'users', type_='foreignkey')
    op.drop_constraint('fk_departments_manager_id_users', 'departments', type_='foreignkey')
    op.drop_constraint('fk_users_department_id_departments', 'users', type_='foreignkey')
    op.drop_constraint('fk_users_team_id_teams', 'users', type_='foreignkey')
    op.drop_constraint('fk_teams_lead_id_users', 'teams', type_='foreignkey')
    op.drop_index(op.f('ix_email_attachments_message_id'), table_name='email_attachments')
    op.drop_index(op.f('ix_email_attachments_file_id'), table_name='email_attachments')
    op.drop_index(op.f('ix_email_attachments_created_at'), table_name='email_attachments')
    op.drop_table('email_attachments')
    op.drop_index(op.f('ix_files_visibility'), table_name='files')
    op.drop_index(op.f('ix_files_task_id'), table_name='files')
    op.drop_index(op.f('ix_files_status'), table_name='files')
    op.drop_index(op.f('ix_files_size_bytes'), table_name='files')
    op.drop_index(op.f('ix_files_project_id'), table_name='files')
    op.drop_index(op.f('ix_files_owner_id'), table_name='files')
    op.drop_index(op.f('ix_files_organization_id'), table_name='files')
    op.drop_index(op.f('ix_files_name'), table_name='files')
    op.drop_index(op.f('ix_files_mime_type'), table_name='files')
    op.drop_index(op.f('ix_files_last_accessed_at'), table_name='files')
    op.drop_index(op.f('ix_files_kind'), table_name='files')
    op.drop_index(op.f('ix_files_folder_id'), table_name='files')
    op.drop_index(op.f('ix_files_extension'), table_name='files')
    op.drop_index(op.f('ix_files_deleted_at'), table_name='files')
    op.drop_index(op.f('ix_files_created_at'), table_name='files')
    op.drop_index(op.f('ix_files_checksum'), table_name='files')
    op.drop_table('files')
    op.drop_index(op.f('ix_calendar_events_title'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_task_id'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_status'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_starts_at'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_recurrence_until'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_project_id'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_organizer_id'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_organization_id'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_ends_at'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_deleted_at'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_created_at'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_category'), table_name='calendar_events')
    op.drop_table('calendar_events')
    op.drop_index('ix_activity_resource', table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_resource_type'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_resource_id'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_project_id'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_organization_id'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_occurred_at'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_kind'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_created_at'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_actor_id'), table_name='activity_entries')
    op.drop_index(op.f('ix_activity_entries_action'), table_name='activity_entries')
    op.drop_table('activity_entries')
    op.drop_index(op.f('ix_kanban_cards_reporter_id'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_reference'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_priority'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_parent_id'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_lane_id'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_kind'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_deleted_at'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_created_at'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_board_id'), table_name='kanban_cards')
    op.drop_index(op.f('ix_kanban_cards_assignee_id'), table_name='kanban_cards')
    op.drop_index('ix_kanban_card_lane_position', table_name='kanban_cards')
    op.drop_index('ix_kanban_card_board_kind', table_name='kanban_cards')
    op.drop_table('kanban_cards')
    op.drop_index(op.f('ix_folders_project_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_path'), table_name='folders')
    op.drop_index(op.f('ix_folders_parent_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_owner_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_organization_id'), table_name='folders')
    op.drop_index(op.f('ix_folders_name'), table_name='folders')
    op.drop_index(op.f('ix_folders_is_shared'), table_name='folders')
    op.drop_index(op.f('ix_folders_deleted_at'), table_name='folders')
    op.drop_index(op.f('ix_folders_created_at'), table_name='folders')
    op.drop_table('folders')
    op.drop_index(op.f('ix_devices_status'), table_name='devices')
    op.drop_index(op.f('ix_devices_serial'), table_name='devices')
    op.drop_index(op.f('ix_devices_region_id'), table_name='devices')
    op.drop_index(op.f('ix_devices_project_id'), table_name='devices')
    op.drop_index(op.f('ix_devices_owner_id'), table_name='devices')
    op.drop_index(op.f('ix_devices_organization_id'), table_name='devices')
    op.drop_index(op.f('ix_devices_name'), table_name='devices')
    op.drop_index(op.f('ix_devices_model'), table_name='devices')
    op.drop_index(op.f('ix_devices_manufacturer'), table_name='devices')
    op.drop_index(op.f('ix_devices_location'), table_name='devices')
    op.drop_index(op.f('ix_devices_last_seen_at'), table_name='devices')
    op.drop_index(op.f('ix_devices_kind'), table_name='devices')
    op.drop_index(op.f('ix_devices_error_count'), table_name='devices')
    op.drop_index(op.f('ix_devices_deleted_at'), table_name='devices')
    op.drop_index(op.f('ix_devices_created_at'), table_name='devices')
    op.drop_table('devices')
    op.drop_index(op.f('ix_tasks_title'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_status'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_requester_id'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_reference'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_project_id'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_priority'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_parent_id'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_organization_id'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_kind'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_due_date'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_deleted_at'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_created_at'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_completed_at'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_board_position'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_assignee_id'), table_name='tasks')
    op.drop_table('tasks')
    op.drop_index(op.f('ix_tickets_subject'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_status'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_sla_breached'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_severity'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_resolved_at'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_resolution_minutes'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_reporter_id'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_reference'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_project_id'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_priority'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_organization_id'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_due_at'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_deleted_at'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_customer_id'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_created_at'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_channel'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_category'), table_name='tickets')
    op.drop_index(op.f('ix_tickets_assignee_id'), table_name='tickets')
    op.drop_table('tickets')
    op.drop_index(op.f('ix_alert_rule_fires_rule_id'), table_name='alert_rule_fires')
    op.drop_index(op.f('ix_alert_rule_fires_created_at'), table_name='alert_rule_fires')
    op.drop_index('ix_alert_fire_recent', table_name='alert_rule_fires')
    op.drop_table('alert_rule_fires')
    op.drop_index('ix_alert_run_rule_time', table_name='alert_rule_runs')
    op.drop_index(op.f('ix_alert_rule_runs_triggered_by_id'), table_name='alert_rule_runs')
    op.drop_index(op.f('ix_alert_rule_runs_started_at'), table_name='alert_rule_runs')
    op.drop_index(op.f('ix_alert_rule_runs_rule_id'), table_name='alert_rule_runs')
    op.drop_index(op.f('ix_alert_rule_runs_dry_run'), table_name='alert_rule_runs')
    op.drop_index(op.f('ix_alert_rule_runs_created_at'), table_name='alert_rule_runs')
    op.drop_table('alert_rule_runs')
    op.drop_index('ux_announcement_receipt', table_name='announcement_receipts')
    op.drop_index(op.f('ix_announcement_receipts_user_id'), table_name='announcement_receipts')
    op.drop_index(op.f('ix_announcement_receipts_created_at'), table_name='announcement_receipts')
    op.drop_index(op.f('ix_announcement_receipts_announcement_id'), table_name='announcement_receipts')
    op.drop_table('announcement_receipts')
    op.drop_index('ix_apilog_client_time', table_name='api_request_logs')
    op.drop_index(op.f('ix_api_request_logs_status_code'), table_name='api_request_logs')
    op.drop_index(op.f('ix_api_request_logs_requested_at'), table_name='api_request_logs')
    op.drop_index(op.f('ix_api_request_logs_path'), table_name='api_request_logs')
    op.drop_index(op.f('ix_api_request_logs_api_client_id'), table_name='api_request_logs')
    op.drop_table('api_request_logs')
    op.drop_index(op.f('ix_api_credentials_status'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_rotated_from_id'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_revoked_by_id'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_revoked_at'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_prefix'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_expires_at'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_created_by_id'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_created_at'), table_name='api_credentials')
    op.drop_index(op.f('ix_api_credentials_api_client_id'), table_name='api_credentials')
    op.drop_table('api_credentials')
    op.drop_index(op.f('ix_dashboard_widgets_position'), table_name='dashboard_widgets')
    op.drop_index(op.f('ix_dashboard_widgets_kind'), table_name='dashboard_widgets')
    op.drop_index(op.f('ix_dashboard_widgets_dashboard_id'), table_name='dashboard_widgets')
    op.drop_index(op.f('ix_dashboard_widgets_created_at'), table_name='dashboard_widgets')
    op.drop_table('dashboard_widgets')
    op.drop_table('user_groups')
    op.drop_index(op.f('ix_kanban_lanes_deleted_at'), table_name='kanban_lanes')
    op.drop_index(op.f('ix_kanban_lanes_created_at'), table_name='kanban_lanes')
    op.drop_index(op.f('ix_kanban_lanes_board_id'), table_name='kanban_lanes')
    op.drop_index('ix_kanban_lane_board_position', table_name='kanban_lanes')
    op.drop_table('kanban_lanes')
    op.drop_index(op.f('ix_tag_links_tag_id'), table_name='tag_links')
    op.drop_index(op.f('ix_tag_links_resource_type'), table_name='tag_links')
    op.drop_index(op.f('ix_tag_links_resource_id'), table_name='tag_links')
    op.drop_index(op.f('ix_tag_links_created_at'), table_name='tag_links')
    op.drop_index(op.f('ix_tag_links_assigned_by_id'), table_name='tag_links')
    op.drop_table('tag_links')
    op.drop_index(op.f('ix_email_messages_thread_id'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_subject'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_sent_at'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_sender_id'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_scheduled_for'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_priority'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_owner_id'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_message_ref'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_is_starred'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_is_read'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_is_draft'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_in_reply_to'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_from_name'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_from_email'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_folder'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_deleted_at'), table_name='email_messages')
    op.drop_index(op.f('ix_email_messages_created_at'), table_name='email_messages')
    op.drop_table('email_messages')
    op.drop_index(op.f('ix_orders_total'), table_name='orders')
    op.drop_index(op.f('ix_orders_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_region_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_reference'), table_name='orders')
    op.drop_index(op.f('ix_orders_placed_at'), table_name='orders')
    op.drop_index(op.f('ix_orders_payment_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_owner_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_organization_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_fulfilment_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_department_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_deleted_at'), table_name='orders')
    op.drop_index(op.f('ix_orders_customer_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_created_at'), table_name='orders')
    op.drop_index(op.f('ix_orders_channel'), table_name='orders')
    op.drop_table('orders')
    op.drop_index(op.f('ix_projects_status'), table_name='projects')
    op.drop_index(op.f('ix_projects_start_date'), table_name='projects')
    op.drop_index(op.f('ix_projects_region_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_progress'), table_name='projects')
    op.drop_index(op.f('ix_projects_priority'), table_name='projects')
    op.drop_index(op.f('ix_projects_phase'), table_name='projects')
    op.drop_index(op.f('ix_projects_owner_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_organization_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_name'), table_name='projects')
    op.drop_index(op.f('ix_projects_health'), table_name='projects')
    op.drop_index(op.f('ix_projects_due_date'), table_name='projects')
    op.drop_index(op.f('ix_projects_department_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_deleted_at'), table_name='projects')
    op.drop_index(op.f('ix_projects_customer_id'), table_name='projects')
    op.drop_index(op.f('ix_projects_created_at'), table_name='projects')
    op.drop_index(op.f('ix_projects_code'), table_name='projects')
    op.drop_table('projects')
    op.drop_index(op.f('ix_announcements_status'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_severity'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_publish_at'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_organization_id'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_is_pinned'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_expires_at'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_deleted_at'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_created_at'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_category'), table_name='announcements')
    op.drop_index(op.f('ix_announcements_author_id'), table_name='announcements')
    op.drop_index('ix_announcement_live', table_name='announcements')
    op.drop_table('announcements')
    op.drop_index(op.f('ix_alert_rules_severity'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_resource_type'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_owner_id'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_organization_id'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_name'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_last_triggered_at'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_enabled'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_deleted_at'), table_name='alert_rules')
    op.drop_index(op.f('ix_alert_rules_created_at'), table_name='alert_rules')
    op.drop_table('alert_rules')
    op.drop_index(op.f('ix_api_clients_status'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_owner_id'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_organization_id'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_name'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_last_used_at'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_deleted_at'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_created_at'), table_name='api_clients')
    op.drop_index(op.f('ix_api_clients_client_id'), table_name='api_clients')
    op.drop_table('api_clients')
    op.drop_index(op.f('ix_background_jobs_status'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_started_at'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_scheduled_task_id'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_scheduled_for'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_reference'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_queue'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_priority'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_organization_id'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_name'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_kind'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_initiated_by_id'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_finished_at'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_duration_ms'), table_name='background_jobs')
    op.drop_index(op.f('ix_background_jobs_created_at'), table_name='background_jobs')
    op.drop_table('background_jobs')
    op.drop_index('ix_audit_resource', table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_result'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_resource_type'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_resource_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_organization_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_occurred_at'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_ip_address'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_impersonator_label'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_impersonator_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_impersonated'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_correlation_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_role'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_label'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_index('ix_audit_actor_time', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index(op.f('ix_reports_visualization'), table_name='reports')
    op.drop_index(op.f('ix_reports_scope'), table_name='reports')
    op.drop_index(op.f('ix_reports_resource_type'), table_name='reports')
    op.drop_index(op.f('ix_reports_owner_id'), table_name='reports')
    op.drop_index(op.f('ix_reports_organization_id'), table_name='reports')
    op.drop_index(op.f('ix_reports_name'), table_name='reports')
    op.drop_index(op.f('ix_reports_last_run_at'), table_name='reports')
    op.drop_index(op.f('ix_reports_deleted_at'), table_name='reports')
    op.drop_index(op.f('ix_reports_created_at'), table_name='reports')
    op.drop_table('reports')
    op.drop_index(op.f('ix_dashboards_slug'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_scope'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_owner_id'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_organization_id'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_name'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_is_home'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_is_default'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_deleted_at'), table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_created_at'), table_name='dashboards')
    op.drop_table('dashboards')
    op.drop_index(op.f('ix_saved_searches_use_count'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_team_id'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_scope'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_resource_type'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_owner_id'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_organization_id'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_name'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_last_used_at'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_is_favorite'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_deleted_at'), table_name='saved_searches')
    op.drop_index(op.f('ix_saved_searches_created_at'), table_name='saved_searches')
    op.drop_index('ix_saved_search_owner_scope', table_name='saved_searches')
    op.drop_table('saved_searches')
    op.drop_index(op.f('ix_groups_organization_id'), table_name='groups')
    op.drop_index(op.f('ix_groups_name'), table_name='groups')
    op.drop_index(op.f('ix_groups_kind'), table_name='groups')
    op.drop_index(op.f('ix_groups_deleted_at'), table_name='groups')
    op.drop_index(op.f('ix_groups_created_at'), table_name='groups')
    op.drop_table('groups')
    op.drop_index(op.f('ix_kanban_boards_scope'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_owner_id'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_organization_id'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_key'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_is_archived'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_deleted_at'), table_name='kanban_boards')
    op.drop_index(op.f('ix_kanban_boards_created_at'), table_name='kanban_boards')
    op.drop_table('kanban_boards')
    op.drop_index(op.f('ix_tags_usage_count'), table_name='tags')
    op.drop_index(op.f('ix_tags_slug'), table_name='tags')
    op.drop_index(op.f('ix_tags_organization_id'), table_name='tags')
    op.drop_index(op.f('ix_tags_name'), table_name='tags')
    op.drop_index(op.f('ix_tags_created_by_id'), table_name='tags')
    op.drop_index(op.f('ix_tags_created_at'), table_name='tags')
    op.drop_index(op.f('ix_tags_category'), table_name='tags')
    op.drop_table('tags')
    op.drop_index(op.f('ix_email_threads_unread_count'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_subject'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_owner_id'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_organization_id'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_last_message_at'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_is_starred'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_is_important'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_has_attachments'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_folder'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_deleted_at'), table_name='email_threads')
    op.drop_index(op.f('ix_email_threads_created_at'), table_name='email_threads')
    op.drop_table('email_threads')
    op.drop_index(op.f('ix_customers_status'), table_name='customers')
    op.drop_index(op.f('ix_customers_segment'), table_name='customers')
    op.drop_index(op.f('ix_customers_satisfaction'), table_name='customers')
    op.drop_index(op.f('ix_customers_region_id'), table_name='customers')
    op.drop_index(op.f('ix_customers_organization_id'), table_name='customers')
    op.drop_index(op.f('ix_customers_name'), table_name='customers')
    op.drop_index(op.f('ix_customers_lifetime_value'), table_name='customers')
    op.drop_index(op.f('ix_customers_lifecycle_stage'), table_name='customers')
    op.drop_index(op.f('ix_customers_last_contact_at'), table_name='customers')
    op.drop_index(op.f('ix_customers_industry'), table_name='customers')
    op.drop_index(op.f('ix_customers_email'), table_name='customers')
    op.drop_index(op.f('ix_customers_deleted_at'), table_name='customers')
    op.drop_index(op.f('ix_customers_created_at'), table_name='customers')
    op.drop_index(op.f('ix_customers_country'), table_name='customers')
    op.drop_index(op.f('ix_customers_code'), table_name='customers')
    op.drop_index(op.f('ix_customers_account_manager_id'), table_name='customers')
    op.drop_table('customers')
    op.drop_index(op.f('ix_import_runs_target_entity'), table_name='import_runs')
    op.drop_index(op.f('ix_import_runs_status'), table_name='import_runs')
    op.drop_index(op.f('ix_import_runs_reference'), table_name='import_runs')
    op.drop_index(op.f('ix_import_runs_created_by_id'), table_name='import_runs')
    op.drop_index(op.f('ix_import_runs_created_at'), table_name='import_runs')
    op.drop_table('import_runs')
    op.drop_index(op.f('ix_system_settings_updated_by_id'), table_name='system_settings')
    op.drop_index(op.f('ix_system_settings_key'), table_name='system_settings')
    op.drop_index(op.f('ix_system_settings_created_at'), table_name='system_settings')
    op.drop_index(op.f('ix_system_settings_category'), table_name='system_settings')
    op.drop_table('system_settings')
    op.drop_index(op.f('ix_integrations_status'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_provider'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_owner_id'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_name'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_last_connected_at'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_key'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_health'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_enabled'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_deleted_at'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_created_at'), table_name='integrations')
    op.drop_index(op.f('ix_integrations_category'), table_name='integrations')
    op.drop_table('integrations')
    op.drop_index(op.f('ix_feature_flags_updated_by_id'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_stage'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_owner_id'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_key'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_experimental'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_environment'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_enabled'), table_name='feature_flags')
    op.drop_index(op.f('ix_feature_flags_created_at'), table_name='feature_flags')
    op.drop_table('feature_flags')
    op.drop_index(op.f('ix_scheduled_tasks_owner_id'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_next_run_at'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_name'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_last_status'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_last_run_at'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_job_kind'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_enabled'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_deleted_at'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_created_at'), table_name='scheduled_tasks')
    op.drop_index(op.f('ix_scheduled_tasks_code'), table_name='scheduled_tasks')
    op.drop_table('scheduled_tasks')
    op.drop_index(op.f('ix_notifications_user_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_severity'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_resource_type'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_is_read'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_group_key'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_category'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_actor_id'), table_name='notifications')
    op.drop_index('ix_notification_user_read', table_name='notifications')
    op.drop_table('notifications')
    op.drop_index(op.f('ix_system_logs_user_id'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_trace_id'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_status_code'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_service'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_logger'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_logged_at'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_level'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_host'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_environment'), table_name='system_logs')
    op.drop_index(op.f('ix_system_logs_correlation_id'), table_name='system_logs')
    op.drop_index('ix_syslog_level_time', table_name='system_logs')
    op.drop_table('system_logs')
    op.drop_index(op.f('ix_notification_preferences_user_id'), table_name='notification_preferences')
    op.drop_index(op.f('ix_notification_preferences_created_at'), table_name='notification_preferences')
    op.drop_table('notification_preferences')
    op.drop_index('ix_recent_user_time', table_name='recent_items')
    op.drop_index(op.f('ix_recent_items_visited_at'), table_name='recent_items')
    op.drop_index(op.f('ix_recent_items_user_id'), table_name='recent_items')
    op.drop_index(op.f('ix_recent_items_resource_type'), table_name='recent_items')
    op.drop_index(op.f('ix_recent_items_created_at'), table_name='recent_items')
    op.drop_table('recent_items')
    op.drop_index(op.f('ix_favorites_user_id'), table_name='favorites')
    op.drop_index(op.f('ix_favorites_resource_type'), table_name='favorites')
    op.drop_index(op.f('ix_favorites_position'), table_name='favorites')
    op.drop_index(op.f('ix_favorites_created_at'), table_name='favorites')
    op.drop_table('favorites')
    op.drop_index(op.f('ix_resource_shares_user_id'), table_name='resource_shares')
    op.drop_index(op.f('ix_resource_shares_shared_by_id'), table_name='resource_shares')
    op.drop_index(op.f('ix_resource_shares_resource_type'), table_name='resource_shares')
    op.drop_index(op.f('ix_resource_shares_resource_id'), table_name='resource_shares')
    op.drop_index(op.f('ix_resource_shares_created_at'), table_name='resource_shares')
    op.drop_index('ix_resource_share_lookup', table_name='resource_shares')
    op.drop_table('resource_shares')
    op.drop_index(op.f('ix_security_events_user_id'), table_name='security_events')
    op.drop_index(op.f('ix_security_events_severity'), table_name='security_events')
    op.drop_index(op.f('ix_security_events_resolved'), table_name='security_events')
    op.drop_index(op.f('ix_security_events_kind'), table_name='security_events')
    op.drop_index(op.f('ix_security_events_created_at'), table_name='security_events')
    op.drop_table('security_events')
    op.drop_index(op.f('ix_login_events_user_id'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_result'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_ip_address'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_email'), table_name='login_events')
    op.drop_index(op.f('ix_login_events_created_at'), table_name='login_events')
    op.drop_table('login_events')
    op.drop_index(op.f('ix_user_sessions_user_id'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_trusted'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_token_id'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_revoked_at'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_last_seen_at'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_device'), table_name='user_sessions')
    op.drop_index(op.f('ix_user_sessions_created_at'), table_name='user_sessions')
    op.drop_table('user_sessions')
    op.drop_index(op.f('ix_organizations_tier'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_status'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_region_id'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_name'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_industry'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_deleted_at'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_created_at'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_country'), table_name='organizations')
    op.drop_index(op.f('ix_organizations_city'), table_name='organizations')
    op.drop_table('organizations')
    op.drop_index(op.f('ix_comments_resource_type'), table_name='comments')
    op.drop_index(op.f('ix_comments_resource_id'), table_name='comments')
    op.drop_index(op.f('ix_comments_parent_id'), table_name='comments')
    op.drop_index(op.f('ix_comments_is_internal'), table_name='comments')
    op.drop_index(op.f('ix_comments_deleted_at'), table_name='comments')
    op.drop_index(op.f('ix_comments_created_at'), table_name='comments')
    op.drop_index(op.f('ix_comments_author_id'), table_name='comments')
    op.drop_table('comments')
    op.drop_index(op.f('ix_email_templates_updated_by_id'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_name'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_locale'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_is_active'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_deleted_at'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_created_at'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_code'), table_name='email_templates')
    op.drop_index(op.f('ix_email_templates_category'), table_name='email_templates')
    op.drop_table('email_templates')
    op.drop_index(op.f('ix_service_health_status'), table_name='service_health')
    op.drop_index(op.f('ix_service_health_last_checked_at'), table_name='service_health')
    op.drop_index(op.f('ix_service_health_key'), table_name='service_health')
    op.drop_index(op.f('ix_service_health_created_at'), table_name='service_health')
    op.drop_index(op.f('ix_service_health_category'), table_name='service_health')
    op.drop_table('service_health')
    op.drop_index(op.f('ix_users_username'), table_name='users')
    op.drop_index(op.f('ix_users_team_id'), table_name='users')
    op.drop_index(op.f('ix_users_status'), table_name='users')
    op.drop_index(op.f('ix_users_role_id'), table_name='users')
    op.drop_index(op.f('ix_users_profile_completeness'), table_name='users')
    op.drop_index(op.f('ix_users_organization_id'), table_name='users')
    op.drop_index(op.f('ix_users_manager_id'), table_name='users')
    op.drop_index(op.f('ix_users_last_login_at'), table_name='users')
    op.drop_index(op.f('ix_users_job_title'), table_name='users')
    op.drop_index(op.f('ix_users_full_name'), table_name='users')
    op.drop_index(op.f('ix_users_external_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_index(op.f('ix_users_department_id'), table_name='users')
    op.drop_index(op.f('ix_users_deleted_at'), table_name='users')
    op.drop_index(op.f('ix_users_created_at'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_roles_rank'), table_name='roles')
    op.drop_index(op.f('ix_roles_created_at'), table_name='roles')
    op.drop_index(op.f('ix_roles_code'), table_name='roles')
    op.drop_table('roles')
    op.drop_index(op.f('ix_teams_slug'), table_name='teams')
    op.drop_index(op.f('ix_teams_organization_id'), table_name='teams')
    op.drop_index(op.f('ix_teams_name'), table_name='teams')
    op.drop_index(op.f('ix_teams_lead_id'), table_name='teams')
    op.drop_index(op.f('ix_teams_department_id'), table_name='teams')
    op.drop_index(op.f('ix_teams_deleted_at'), table_name='teams')
    op.drop_index(op.f('ix_teams_created_at'), table_name='teams')
    op.drop_table('teams')
    op.drop_index(op.f('ix_departments_parent_id'), table_name='departments')
    op.drop_index(op.f('ix_departments_organization_id'), table_name='departments')
    op.drop_index(op.f('ix_departments_name'), table_name='departments')
    op.drop_index(op.f('ix_departments_manager_id'), table_name='departments')
    op.drop_index(op.f('ix_departments_deleted_at'), table_name='departments')
    op.drop_index(op.f('ix_departments_created_at'), table_name='departments')
    op.drop_index(op.f('ix_departments_code'), table_name='departments')
    op.drop_table('departments')
    # ### end Alembic commands ###
    op.drop_index(op.f('ix_regions_created_at'), table_name='regions')
    op.drop_table('regions')
