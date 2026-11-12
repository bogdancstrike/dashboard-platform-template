"""assistant: conversations, messages, the daily brief, and the AI usage ledger (§41–46)

Revision: 82f9625fa474
Parent:   7a1c0e5b9d24
Created:  2026-11-12 20:00:00+00:00

Four new tables and nothing altered. `ai_usage` holds one row per model call by
any AI feature: rate limits count it and token totals sum it.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '82f9625fa474'
down_revision: str | None = '7a1c0e5b9d24'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('ai_usage',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('feature', sa.String(length=32), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('prompt_tokens', sa.Integer(), nullable=False),
    sa.Column('completion_tokens', sa.Integer(), nullable=False),
    sa.Column('total_tokens', sa.Integer(), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_ai_usage_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_usage'))
    )
    op.create_index(op.f('ix_ai_usage_created_at'), 'ai_usage', ['created_at'], unique=False)
    op.create_index(op.f('ix_ai_usage_feature'), 'ai_usage', ['feature'], unique=False)
    op.create_index('ix_ai_usage_user_time', 'ai_usage', ['user_id', 'created_at'], unique=False)
    op.create_table('assistant_briefs',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('day', sa.Date(), nullable=False),
    sa.Column('headline', sa.String(length=300), nullable=False),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('total_tokens', sa.Integer(), nullable=False),
    sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_assistant_briefs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_assistant_briefs')),
    sa.UniqueConstraint('user_id', 'day', name='uq_assistant_brief_user_day')
    )
    op.create_index(op.f('ix_assistant_briefs_created_at'), 'assistant_briefs', ['created_at'], unique=False)
    op.create_index(op.f('ix_assistant_briefs_user_id'), 'assistant_briefs', ['user_id'], unique=False)
    op.create_table('assistant_conversations',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('message_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_assistant_conversations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_assistant_conversations'))
    )
    op.create_index('ix_assistant_conv_user_recent', 'assistant_conversations', ['user_id', 'last_message_at'], unique=False)
    op.create_index(op.f('ix_assistant_conversations_created_at'), 'assistant_conversations', ['created_at'], unique=False)
    op.create_index(op.f('ix_assistant_conversations_user_id'), 'assistant_conversations', ['user_id'], unique=False)
    op.create_table('assistant_messages',
    sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
    sa.Column('conversation_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('citations', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('steps', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('model', sa.String(length=80), nullable=True),
    sa.Column('prompt_tokens', sa.Integer(), nullable=False),
    sa.Column('completion_tokens', sa.Integer(), nullable=False),
    sa.Column('total_tokens', sa.Integer(), nullable=False),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('error', sa.String(length=300), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['assistant_conversations.id'], name=op.f('fk_assistant_messages_conversation_id_assistant_conversations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_assistant_messages'))
    )
    op.create_index(op.f('ix_assistant_messages_conversation_id'), 'assistant_messages', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_assistant_messages_created_at'), 'assistant_messages', ['created_at'], unique=False)
    op.create_index('ix_assistant_msg_conv_time', 'assistant_messages', ['conversation_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_assistant_msg_conv_time', table_name='assistant_messages')
    op.drop_index(op.f('ix_assistant_messages_created_at'), table_name='assistant_messages')
    op.drop_index(op.f('ix_assistant_messages_conversation_id'), table_name='assistant_messages')
    op.drop_table('assistant_messages')
    op.drop_index(op.f('ix_assistant_conversations_user_id'), table_name='assistant_conversations')
    op.drop_index(op.f('ix_assistant_conversations_created_at'), table_name='assistant_conversations')
    op.drop_index('ix_assistant_conv_user_recent', table_name='assistant_conversations')
    op.drop_table('assistant_conversations')
    op.drop_index(op.f('ix_assistant_briefs_user_id'), table_name='assistant_briefs')
    op.drop_index(op.f('ix_assistant_briefs_created_at'), table_name='assistant_briefs')
    op.drop_table('assistant_briefs')
    op.drop_index('ix_ai_usage_user_time', table_name='ai_usage')
    op.drop_index(op.f('ix_ai_usage_feature'), table_name='ai_usage')
    op.drop_index(op.f('ix_ai_usage_created_at'), table_name='ai_usage')
    op.drop_table('ai_usage')
