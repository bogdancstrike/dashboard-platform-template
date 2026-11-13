"""feature flags: organization targeting

Revision: a7c4e2f91b30
Parent:   f5e8b2c40562
Created:  2026-11-13 06:00:00+00:00

Flags already target people, roles and groups; this adds organizations, so a
feature can be switched on for one customer organization at a time. The
catalogue's new flags themselves are rows, written by the seed and by
`python -m src.seed --sync-flags`, not by the migration.
"""

from __future__ import annotations

from alembic import op

revision: str = "a7c4e2f91b30"
down_revision: str | None = "f5e8b2c40562"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # IF NOT EXISTS: `--sync-schema` may already have added it to a live
    # database ahead of the deploy.
    op.execute("ALTER TABLE feature_flags ADD COLUMN IF NOT EXISTS target_organization_ids VARCHAR(64)[]")


def downgrade() -> None:
    op.execute("ALTER TABLE feature_flags DROP COLUMN IF EXISTS target_organization_ids")
