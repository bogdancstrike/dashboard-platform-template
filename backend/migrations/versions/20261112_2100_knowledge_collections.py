"""knowledge collections: ask your documents (§44)

Revision: 5e2b7c9d1a40
Parent:   82f9625fa474
Created:  2026-11-12 21:00:00+00:00

Collections of files, the documents in them with where their reading stands,
the passages read from them (with page, boxes, a full-text vector and an
embedding in pgvector's `vector`), and the questions asked of them.

Needs the `vector` extension, which the compose stack's
`pgvector/pgvector:pg18` image provides.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from src.models.vector import Vector

revision: str = '5e2b7c9d1a40'
down_revision: str | None = '82f9625fa474'
branch_labels: str | None = None
depends_on: str | None = None

_UUID = postgresql.UUID(as_uuid=True)


def _stamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')

    op.create_table(
        'knowledge_collections',
        sa.Column('id', _UUID, server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('scope', sa.String(length=16), nullable=False),
        sa.Column('color', sa.String(length=16), nullable=True),
        sa.Column('owner_id', _UUID, nullable=True),
        sa.Column('organization_id', _UUID, nullable=True),
        sa.Column('folder_id', _UUID, nullable=True),
        sa.Column('last_asked_at', sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], name='fk_knowledge_collections_owner_id_users', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], name='fk_knowledge_collections_organization_id_organizations', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['folder_id'], ['folders.id'], name='fk_knowledge_collections_folder_id_folders', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_knowledge_collections'),
    )
    for column in ('name', 'scope', 'owner_id', 'organization_id', 'folder_id', 'created_at', 'deleted_at'):
        op.create_index(f'ix_knowledge_collections_{column}', 'knowledge_collections', [column])

    op.create_table(
        'knowledge_documents',
        sa.Column('id', _UUID, server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('collection_id', _UUID, nullable=False),
        sa.Column('file_id', _UUID, nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('parser', sa.String(length=16), nullable=True),
        sa.Column('error_code', sa.String(length=48), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('pages', sa.Integer(), nullable=True),
        sa.Column('chunk_count', sa.Integer(), nullable=False),
        sa.Column('embedded_count', sa.Integer(), nullable=False),
        sa.Column('outline', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('warnings', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('job_id', _UUID, nullable=True),
        sa.Column('added_by_id', _UUID, nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ingested_at', sa.DateTime(timezone=True), nullable=True),
        *_stamps(),
        sa.ForeignKeyConstraint(['collection_id'], ['knowledge_collections.id'], name='fk_knowledge_documents_collection_id_knowledge_collections', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['file_id'], ['files.id'], name='fk_knowledge_documents_file_id_files', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['job_id'], ['background_jobs.id'], name='fk_knowledge_documents_job_id_background_jobs', ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['added_by_id'], ['users.id'], name='fk_knowledge_documents_added_by_id_users', ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id', name='pk_knowledge_documents'),
        sa.UniqueConstraint('collection_id', 'file_id', name='uq_knowledge_documents_collection_id'),
    )
    for column in ('collection_id', 'file_id', 'status', 'job_id', 'added_by_id', 'created_at'):
        op.create_index(f'ix_knowledge_documents_{column}', 'knowledge_documents', [column])

    op.create_table(
        'knowledge_chunks',
        sa.Column('id', _UUID, server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('document_id', _UUID, nullable=False),
        sa.Column('collection_id', _UUID, nullable=False),
        sa.Column('ordinal', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('heading_path', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('page_from', sa.Integer(), nullable=True),
        sa.Column('page_to', sa.Integer(), nullable=True),
        sa.Column('boxes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('embedding', Vector(), nullable=True),
        sa.Column('embedding_dims', sa.Integer(), nullable=True),
        sa.Column('tsv', postgresql.TSVECTOR(),
                  sa.Computed("to_tsvector('english'::regconfig, text)", persisted=True), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['knowledge_documents.id'], name='fk_knowledge_chunks_document_id_knowledge_documents', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_knowledge_chunks'),
    )
    op.create_index('ix_knowledge_chunks_document_id', 'knowledge_chunks', ['document_id'])
    op.create_index('ix_knowledge_chunks_collection_id', 'knowledge_chunks', ['collection_id'])
    op.create_index('ix_knowledge_chunks_embedding_dims', 'knowledge_chunks', ['embedding_dims'])
    op.create_index('ix_knowledge_chunks_document_ordinal', 'knowledge_chunks', ['document_id', 'ordinal'])
    op.create_index('ix_knowledge_chunks_tsv', 'knowledge_chunks', ['tsv'], postgresql_using='gin')

    op.create_table(
        'knowledge_questions',
        sa.Column('id', _UUID, server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('collection_id', _UUID, nullable=False),
        sa.Column('user_id', _UUID, nullable=True),
        sa.Column('thread_id', _UUID, nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=True),
        sa.Column('citations', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=True),
        sa.Column('usage', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        *_stamps(),
        sa.ForeignKeyConstraint(['collection_id'], ['knowledge_collections.id'], name='fk_knowledge_questions_collection_id_knowledge_collections', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_knowledge_questions_user_id_users', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_knowledge_questions'),
    )
    for column in ('collection_id', 'user_id', 'status', 'created_at'):
        op.create_index(f'ix_knowledge_questions_{column}', 'knowledge_questions', [column])
    op.create_index('ix_knowledge_questions_thread', 'knowledge_questions', ['thread_id', 'created_at'])


def downgrade() -> None:
    op.drop_table('knowledge_questions')
    op.drop_table('knowledge_chunks')
    op.drop_table('knowledge_documents')
    op.drop_table('knowledge_collections')
    # The extension stays: dropping it would break anything else that adopted it.
