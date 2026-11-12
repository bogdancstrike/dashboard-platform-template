"""Isolated CPU document conversion for Nucleus' "Ask your documents" (§44).

Adapted from Horizon's converter: the service gets bytes, never a URL, a path or
credentials, and has no route to the database or object storage. It answers
with sections (text and tables) that keep their page numbers and the boxes they
were read from, which is what lets a citation open the page and mark the passage.
"""
