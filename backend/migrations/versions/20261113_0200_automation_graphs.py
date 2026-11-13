"""automation graphs: workflows as node graphs, their versions, and what waits

Revision: f5a1c0de2701
Parent:   9c4e2a7b1d35
Created:  2026-11-13 02:00:00+00:00

The visual workflow builder stores an automation as a graph — trigger,
conditions, branches, actions, delays, approvals — with a draft and a published
version, keeps every published version, and parks records that wait.

Every existing automation is converted here, so the canvas opens on all of them
and the engine runs one definition: a form-built rule becomes the straight line
it always meant — a schedule trigger, its condition, then its actions in order —
published as version 1.
"""

from __future__ import annotations

import json
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f5a1c0de2701'
down_revision: str | None = '9c4e2a7b1d35'
branch_labels: str | None = None
depends_on: str | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table('automation_graphs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rule_id', sa.UUID(), nullable=False),
    sa.Column('draft', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('published', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('published_by_id', sa.UUID(), nullable=True),
    sa.Column('draft_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('draft_updated_by_id', sa.UUID(), nullable=True),
    sa.Column('webhook_token', sa.String(length=64), nullable=True),
    sa.Column('last_scheduled_at', sa.DateTime(timezone=True), nullable=True),
    *_timestamps(),
    sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], name=op.f('fk_automation_graphs_rule_id_alert_rules'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['published_by_id'], ['users.id'], name=op.f('fk_automation_graphs_published_by_id_users'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['draft_updated_by_id'], ['users.id'], name=op.f('fk_automation_graphs_draft_updated_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_automation_graphs')),
    sa.UniqueConstraint('rule_id', name='uq_automation_graph_rule'),
    )
    op.create_index(op.f('ix_automation_graphs_rule_id'), 'automation_graphs', ['rule_id'], unique=False)
    op.create_index(op.f('ix_automation_graphs_published_by_id'), 'automation_graphs', ['published_by_id'], unique=False)
    op.create_index(op.f('ix_automation_graphs_draft_updated_by_id'), 'automation_graphs', ['draft_updated_by_id'], unique=False)
    op.create_index(op.f('ix_automation_graphs_webhook_token'), 'automation_graphs', ['webhook_token'], unique=True)
    op.create_index(op.f('ix_automation_graphs_created_at'), 'automation_graphs', ['created_at'], unique=False)

    op.create_table('automation_versions',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rule_id', sa.UUID(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('graph', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('published_by_id', sa.UUID(), nullable=True),
    *_timestamps(),
    sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], name=op.f('fk_automation_versions_rule_id_alert_rules'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['published_by_id'], ['users.id'], name=op.f('fk_automation_versions_published_by_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_automation_versions')),
    sa.UniqueConstraint('rule_id', 'version', name='uq_automation_version'),
    )
    op.create_index(op.f('ix_automation_versions_rule_id'), 'automation_versions', ['rule_id'], unique=False)
    op.create_index(op.f('ix_automation_versions_published_by_id'), 'automation_versions', ['published_by_id'], unique=False)
    op.create_index(op.f('ix_automation_versions_created_at'), 'automation_versions', ['created_at'], unique=False)

    op.create_table('automation_waits',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('rule_id', sa.UUID(), nullable=False),
    sa.Column('run_id', sa.UUID(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('node_id', sa.String(length=64), nullable=False),
    sa.Column('resource_type', sa.String(length=48), nullable=False),
    sa.Column('record_id', sa.String(length=64), nullable=False),
    sa.Column('record_label', sa.String(length=240), nullable=True),
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('approval_id', sa.String(length=64), nullable=True),
    sa.Column('outcome', sa.String(length=16), nullable=True),
    sa.Column('resumed_at', sa.DateTime(timezone=True), nullable=True),
    *_timestamps(),
    sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], name=op.f('fk_automation_waits_rule_id_alert_rules'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['run_id'], ['alert_rule_runs.id'], name=op.f('fk_automation_waits_run_id_alert_rule_runs'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_automation_waits')),
    )
    op.create_index(op.f('ix_automation_waits_rule_id'), 'automation_waits', ['rule_id'], unique=False)
    op.create_index(op.f('ix_automation_waits_run_id'), 'automation_waits', ['run_id'], unique=False)
    op.create_index(op.f('ix_automation_waits_status'), 'automation_waits', ['status'], unique=False)
    op.create_index(op.f('ix_automation_waits_approval_id'), 'automation_waits', ['approval_id'], unique=False)
    op.create_index(op.f('ix_automation_waits_created_at'), 'automation_waits', ['created_at'], unique=False)
    op.create_index('ix_automation_wait_due', 'automation_waits', ['status', 'due_at'], unique=False)

    _convert_existing_rules()


def legacy_graph(resource_type: str, schedule: str | None, tree, actions) -> dict:
    """The straight line a form-built rule always meant (mirrors `automation_graph.from_legacy`)."""
    nodes = [
        {"id": "trigger", "type": "trigger", "position": {"x": 0, "y": 0},
         "data": {"event": "SCHEDULE", "resource_type": resource_type,
                  "schedule": schedule or "*/15 * * * *"}},
        {"id": "condition", "type": "condition", "position": {"x": 0, "y": 150}, "data": {"tree": tree}},
    ]
    edges = [{"id": "e-trigger-condition", "source": "trigger", "port": "out", "target": "condition"}]
    previous = "condition"
    for index, action in enumerate(a for a in (actions or []) if isinstance(a, dict)):
        node_id = f"action{index + 1}"
        nodes.append({"id": node_id, "type": "action", "position": {"x": 0, "y": 150 * (index + 2)},
                      "data": dict(action)})
        edges.append({"id": f"e-{previous}-{node_id}", "source": previous, "port": "out", "target": node_id})
        previous = node_id
    return {"nodes": nodes, "edges": edges}


def _convert_existing_rules() -> None:
    bind = op.get_bind()
    rules = bind.execute(sa.text(
        "SELECT id, resource_type, schedule, condition_tree, actions, owner_id, updated_at "
        "FROM alert_rules"
    )).mappings().all()
    for rule in rules:
        graph = json.dumps(legacy_graph(rule["resource_type"], rule["schedule"],
                                        rule["condition_tree"], rule["actions"]))
        bind.execute(sa.text(
            "INSERT INTO automation_graphs (id, rule_id, draft, published, version, published_at, published_by_id) "
            "VALUES (:id, :rule, CAST(:g AS JSONB), CAST(:g AS JSONB), 1, :at, :owner)"
        ), {"id": str(uuid.uuid4()), "rule": rule["id"], "g": graph, "at": rule["updated_at"],
            "owner": rule["owner_id"]})
        bind.execute(sa.text(
            "INSERT INTO automation_versions (id, rule_id, version, graph, note, published_by_id) "
            "VALUES (:id, :rule, 1, CAST(:g AS JSONB), 'Converted from the form editor', :owner)"
        ), {"id": str(uuid.uuid4()), "rule": rule["id"], "g": graph, "owner": rule["owner_id"]})


def downgrade() -> None:
    op.drop_index('ix_automation_wait_due', table_name='automation_waits')
    op.drop_table('automation_waits')
    op.drop_table('automation_versions')
    op.drop_table('automation_graphs')
