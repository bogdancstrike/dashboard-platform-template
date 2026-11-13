"""`core.repository`: one way to say "that row does not exist"."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.core.errors import NotFoundError
from src.core.repository import found_or_404, get_or_404, is_missing


class _Session:
    def __init__(self, row):
        self.row, self.asked = row, None

    def get(self, model, key):
        self.asked = (model, key)
        return self.row


def test_a_present_row_is_returned_and_the_key_is_used_as_given():
    row = SimpleNamespace(deleted_at=None)
    session = _Session(row)
    assert get_or_404(session, "Model", 7, "gone") is row
    assert session.asked == ("Model", 7)


def test_an_absent_row_is_a_404_with_the_message_and_details():
    with pytest.raises(NotFoundError) as caught:
        get_or_404(_Session(None), "Model", 1, "That thing does not exist.", details={"id": "1"})
    assert caught.value.message == "That thing does not exist."
    assert caught.value.details == {"id": "1"}


def test_a_soft_deleted_row_is_missing_only_when_live_is_asked_for():
    row = SimpleNamespace(deleted_at="yesterday")
    assert found_or_404(row, "gone") is row
    with pytest.raises(NotFoundError):
        found_or_404(row, "gone", live=True)
    assert is_missing(None) and not is_missing(object(), live=True)
