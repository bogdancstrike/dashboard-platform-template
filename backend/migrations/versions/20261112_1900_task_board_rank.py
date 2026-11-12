"""task board rank: a sparse, fractional order within each lane

Revision: 7a1c0e5b9d24
Parent:   06bc69c46cd4
Created:  2026-11-12 19:00:00+00:00

`tasks.board_position` was an integer nothing wrote, seeded as `counter % 50`.
The board now keeps a hand-made order (§18), so the column becomes a double —
a drop takes the midpoint of its neighbours and writes one row — and every
existing lane is ranked in the order it was shown in until now (priority,
then id), with wide gaps between neighbours.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '7a1c0e5b9d24'
down_revision: str | None = '06bc69c46cd4'
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.alter_column(
        'tasks', 'board_position',
        existing_type=sa.Integer(), type_=sa.Double(), existing_nullable=False,
        postgresql_using='board_position::double precision',
    )
    op.execute(
        """
        UPDATE tasks SET board_position = ranked.rank
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY status ORDER BY priority, id) * 1024.0 AS rank
            FROM tasks
        ) AS ranked
        WHERE tasks.id = ranked.id
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE tasks SET board_position = ranked.rank
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY status ORDER BY board_position, id) AS rank
            FROM tasks
        ) AS ranked
        WHERE tasks.id = ranked.id
        """
    )
    op.alter_column(
        'tasks', 'board_position',
        existing_type=sa.Double(), type_=sa.Integer(), existing_nullable=False,
        postgresql_using='round(board_position)::integer',
    )
