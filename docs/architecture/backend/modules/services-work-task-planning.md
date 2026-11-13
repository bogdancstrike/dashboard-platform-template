# `src/services/work/task_planning`

What a task page shows beside the record: its place in the plan (§18).

The record itself — title, status, dates, points, epic, checklist — is read and
written through the generic records API like every dataset. This answers the
questions a single row cannot: which epic and sprint it is in, what it waits
on and what waits on it, its subtasks, who watches it, whether it recurs.

Also here, because they are the task board's settings rather than anybody's
record: the work-in-progress limit on each lane, and the epics a board can be
filtered and swimlaned by.
