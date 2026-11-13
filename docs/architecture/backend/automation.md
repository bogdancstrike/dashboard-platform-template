# Automation: workflow rules and the graph engine

Condition → action automation (§49): the engine, and only the engine.

An automation here is one sentence — *when records look like this, do these
things* — and every part of it already exists somewhere else in the platform.
The condition is the react-awesome-query-builder tree the advanced search
produces, compiled by `core/rules.py`. The records it matches are selected
through the same `explorer` declaration every list, chart and export reads. The
actions write through the same services a person writes through. This module
adds no second way to ask a question and no second way to make a change; it
adds the *loop* between them.

Five decisions carry the design.

**The cooldown is held per record, not per rule.** This is the difference
between the requirement and a thing that looks like it. A rule cooling down as
a whole would send forty messages about forty breached tickets in one run and
then go quiet about the forty-first; §49 asks for the opposite. So "we have
already said this" is a fact about *this rule and this record*, kept in
`alert_rule_fires` and upserted rather than appended — state, not history.

**A dry run is the same code path with the actions switched off.** Not a second
evaluator: a preview that walks different code is a preview that can disagree
with the thing it previews, which is the one thing a preview must not do. So
`evaluate()` takes `dry_run` and every action consults it in exactly one place.

**An action that fails is recorded, never raised.** A webhook whose host is
down must not lose the notification beside it, and it must not lose the
cooldown either — a run that half-happened and then rolled back would fire the
same actions again on the next pass. Outcomes are collected per action.

**The run is bounded twice over.** `MAX_MATCHES` caps what one evaluation will
look at, because a rule matching a whole table is a rule that needs narrowing
rather than a request that needs patience. `MAX_FIRES` caps what one run will
*act on*, and the remainder is reported as deferred rather than dropped: their
cooldown never started, so the next run picks them up.

**Actions are declared beside what runs them.** `ACTIONS` states each kind's
label, what it needs and what performs it, and the API publishes that list —
so the editor renders from the same declaration the engine executes, and a new
action kind reaches the screen the day it is written (§76).
