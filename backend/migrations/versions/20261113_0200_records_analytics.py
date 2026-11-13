"""records & analytics: customer health, contracts, metric watches, public dashboard links

Revision: 9c4e2a7b1d35
Parent:   9c4e1f7a2b63
Created:  2026-11-13 02:00:00+00:00

The tables of `models/records_analytics.py`: the health model and each
customer's current score with its daily snapshots (§12), contracts worked as
renewals (§13), metric watches and the anomalies they flag (§22), and public
dashboard links (§25). Record version history (§17) and the bulk grid (§18)
read and write tables that already exist.

Re-runnable, like the other feature migrations: the live development database
is shared by several workstreams and brought forward by hand while revisions
are re-parented, so each table is created only when it is missing.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision: str = '9c4e2a7b1d35'
down_revision: str | None = '9c4e1f7a2b63'
branch_labels: str | None = None
depends_on: str | None = None

UUID = pg.UUID(as_uuid=True)
JSONB = pg.JSONB(astext_type=sa.Text())


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _id() -> sa.Column:
    return sa.Column('id', UUID, primary_key=True, server_default=sa.text('gen_random_uuid()'))


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def _user(name: str) -> sa.Column:
    return sa.Column(name, UUID, sa.ForeignKey('users.id', ondelete='SET NULL'), index=True)


def upgrade() -> None:
    tables = _tables()

    if 'health_models' not in tables:
        op.create_table(
            'health_models',
            _id(),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('active', sa.Boolean(), nullable=False, index=True),
            sa.Column('weights', JSONB, nullable=False),
            sa.Column('thresholds', JSONB, nullable=False),
            _user('updated_by_id'),
            *_timestamps(),
        )

    if 'customer_health' not in tables:
        op.create_table(
            'customer_health',
            _id(),
            sa.Column('customer_id', UUID, sa.ForeignKey('customers.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('score', sa.Integer(), nullable=False, index=True),
            sa.Column('band', sa.String(16), nullable=False, index=True),
            sa.Column('previous_band', sa.String(16)),
            sa.Column('band_changed_at', sa.DateTime(timezone=True), index=True),
            sa.Column('delta_7d', sa.Integer(), index=True),
            sa.Column('delta_30d', sa.Integer(), index=True),
            sa.Column('components', JSONB),
            sa.Column('computed_at', sa.DateTime(timezone=True), index=True),
            *_timestamps(),
            sa.UniqueConstraint('customer_id', name='uq_customer_health_customer'),
        )

    if 'customer_health_snapshots' not in tables:
        op.create_table(
            'customer_health_snapshots',
            _id(),
            sa.Column('customer_id', UUID, sa.ForeignKey('customers.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('day', sa.Date(), nullable=False),
            sa.Column('score', sa.Integer(), nullable=False),
            sa.Column('band', sa.String(16), nullable=False),
            sa.Column('components', JSONB),
            sa.UniqueConstraint('customer_id', 'day', name='uq_health_snapshot_day'),
        )
        op.create_index('ix_health_snapshot_day', 'customer_health_snapshots', ['day'])

    if 'contracts' not in tables:
        op.create_table(
            'contracts',
            _id(),
            sa.Column('reference', sa.String(24), nullable=False, unique=True, index=True),
            sa.Column('title', sa.String(200), nullable=False, index=True),
            sa.Column('customer_id', UUID, sa.ForeignKey('customers.id', ondelete='CASCADE'), nullable=False, index=True),
            _user('owner_id'),
            sa.Column('value', sa.Numeric(14, 2), nullable=False),
            sa.Column('currency', sa.String(8), nullable=False),
            sa.Column('start_date', sa.Date(), nullable=False),
            sa.Column('end_date', sa.Date(), nullable=False, index=True),
            sa.Column('term_months', sa.Integer(), nullable=False),
            sa.Column('billing', sa.String(16), nullable=False),
            sa.Column('auto_renew', sa.Boolean(), nullable=False),
            sa.Column('notice_days', sa.Integer(), nullable=False),
            sa.Column('stage', sa.String(16), nullable=False, index=True),
            sa.Column('probability', sa.Integer(), nullable=False),
            sa.Column('rank', sa.Double(), nullable=False),
            sa.Column('terms', sa.Text()),
            sa.Column('notes', sa.Text()),
            sa.Column('churn_reason', sa.String(200)),
            sa.Column('stage_changed_at', sa.DateTime(timezone=True)),
            sa.Column('closed_at', sa.DateTime(timezone=True), index=True),
            sa.Column('folder_id', UUID, sa.ForeignKey('folders.id', ondelete='SET NULL'), index=True),
            *_timestamps(),
            sa.Column('deleted_at', sa.DateTime(timezone=True), index=True),
        )
        op.create_index('ix_contract_stage_end', 'contracts', ['stage', 'end_date'])

    if 'metric_watches' not in tables:
        op.create_table(
            'metric_watches',
            _id(),
            sa.Column('name', sa.String(160), nullable=False, index=True),
            sa.Column('description', sa.Text()),
            sa.Column('dataset', sa.String(48), nullable=False, index=True),
            sa.Column('measure', sa.String(16), nullable=False),
            sa.Column('measure_field', sa.String(64)),
            sa.Column('date_field', sa.String(64)),
            sa.Column('filters', JSONB),
            sa.Column('granularity', sa.String(8), nullable=False),
            sa.Column('method', sa.String(16), nullable=False),
            sa.Column('sensitivity', sa.String(8), nullable=False),
            sa.Column('threshold', sa.Double()),
            sa.Column('direction', sa.String(8), nullable=False),
            sa.Column('window', sa.Integer(), nullable=False),
            sa.Column('channels', pg.ARRAY(sa.String(16))),
            sa.Column('recipient_ids', pg.ARRAY(sa.String(64))),
            sa.Column('enabled', sa.Boolean(), nullable=False, index=True),
            sa.Column('muted', sa.Boolean(), nullable=False, index=True),
            sa.Column('snoozed_until', sa.DateTime(timezone=True)),
            _user('owner_id'),
            sa.Column('last_evaluated_at', sa.DateTime(timezone=True), index=True),
            sa.Column('last_status', sa.String(16), index=True),
            sa.Column('last_value', sa.Double()),
            sa.Column('last_error', sa.Text()),
            *_timestamps(),
            sa.Column('deleted_at', sa.DateTime(timezone=True), index=True),
        )

    if 'metric_anomalies' not in tables:
        op.create_table(
            'metric_anomalies',
            _id(),
            sa.Column('watch_id', UUID, sa.ForeignKey('metric_watches.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('bucket_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('value', sa.Double(), nullable=False),
            sa.Column('expected', sa.Double(), nullable=False),
            sa.Column('stddev', sa.Double(), nullable=False),
            sa.Column('zscore', sa.Double(), nullable=False),
            sa.Column('direction', sa.String(8), nullable=False),
            sa.Column('severity', sa.String(16), nullable=False),
            sa.Column('series', JSONB),
            sa.Column('status', sa.String(16), nullable=False, index=True),
            sa.Column('notified', sa.Boolean(), nullable=False),
            sa.Column('suppressed_reason', sa.String(16)),
            sa.Column('acknowledged_at', sa.DateTime(timezone=True)),
            _user('acknowledged_by_id'),
            *_timestamps(),
            sa.UniqueConstraint('watch_id', 'bucket_at', name='uq_metric_anomaly_bucket'),
        )
        op.create_index('ix_metric_anomaly_watch_time', 'metric_anomalies', ['watch_id', 'bucket_at'])

    if 'dashboard_links' not in tables:
        op.create_table(
            'dashboard_links',
            _id(),
            sa.Column('dashboard_id', UUID, sa.ForeignKey('dashboards.id', ondelete='CASCADE'), nullable=False, index=True),
            sa.Column('token', sa.String(64), nullable=False, unique=True, index=True),
            sa.Column('label', sa.String(120)),
            sa.Column('password_hash', sa.String(255)),
            sa.Column('password_version', sa.Integer(), nullable=False),
            sa.Column('expires_at', sa.DateTime(timezone=True), index=True),
            sa.Column('revoked_at', sa.DateTime(timezone=True), index=True),
            sa.Column('allow_embed', sa.Boolean(), nullable=False),
            sa.Column('allowed_origins', pg.ARRAY(sa.String(200))),
            sa.Column('view_count', sa.Integer(), nullable=False),
            sa.Column('last_viewed_at', sa.DateTime(timezone=True)),
            _user('created_by_id'),
            *_timestamps(),
        )


def downgrade() -> None:
    for table in (
        'dashboard_links', 'metric_anomalies', 'metric_watches', 'contracts',
        'customer_health_snapshots', 'customer_health', 'health_models',
    ):
        if table in _tables():
            op.drop_table(table)
