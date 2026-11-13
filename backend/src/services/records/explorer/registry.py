"""Every explorable dataset, declared once."""

from __future__ import annotations

from typing import Any

from src.core.errors import ValidationError
from src.services.records.explorer.datasets import (
    customer,
    device,
    order,
    project,
    task,
    ticket,
)
from src.services.records.explorer.model import (
    Resource,
    bind_registry,
)


def _resources() -> dict[str, Resource]:
    """Built on first use so importing the explorer does not pull every model at boot."""
    import src.models.records_analytics  # noqa: F401  (Customer.health_score / health_band)

    return {key: module.declare() for key, module in (
        ("task", task),
        ("ticket", ticket),
        ("project", project),
        ("customer", customer),
        ("order", order),
        ("device", device),
    )}



def resources() -> dict[str, Resource]:
    """Public registry accessor; returned declarations are immutable."""
    return _resources()


def resource_for(key: Any, *, principal=None) -> Resource:
    resource = resources().get(str(key or ""))
    if resource is None:
        raise ValidationError(
            "Unknown explorer resource.",
            details={"resource_type": str(key or ""), "available": sorted(resources())},
        )
    if principal is not None:
        principal.require(resource.permission)
    return resource


# A declaration names the dataset a foreign key points at through the registry.
bind_registry(resources)
