# Natural-language questions → the explorer's condition tree (§23, §42)

Natural-language questions → the explorer's condition tree (§23, §42).

The model is asked for the *exact* tree the Rules builder edits and
`core/rules.py` compiles — react-awesome-query-builder's JSON: groups with
``properties.conjunction``/``properties.not`` and ``children1``, rules with
``properties.field``/``operator``/``value``. Nothing it writes is trusted:
:func:`normalise` walks the tree against the dataset's own field catalogue and

* resolves a field by name, by label, or by a close spelling — and drops a
  rule whose field does not exist, saying so;
* maps the operator onto one the field's kind allows (``contains`` on a
  choice becomes ``is``), or drops the rule;
* coerces each value to the field's kind: a choice matched case-insensitively,
  a date written as the builder writes it, a number, a yes/no, and a person or
  a record *named* in the question resolved to its id;
* re-spells the operator the way the builder spells it for that kind
  (``select_equals`` for a choice, ``like`` for text), with fresh node ids.

The result is compiled with the same compiler the search uses and counted, so
the UI shows "37 tickets match" before anybody presses Apply.

Data-mode chat tools take the same tree, through the same function — one
validator for every tree a model writes.
