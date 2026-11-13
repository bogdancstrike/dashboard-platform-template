# Intake forms: designed here, answered anywhere, turned into records

Intake forms: designed here, answered anywhere, turned into records.

**A form writes through the same door a person does.** A submission becomes a
record by `record_writes.create`, so the values a form may set are exactly the
values the dataset accepts from its own edit form, coerced and validated by
the same rules, and the record is audited like any other.

**What arrived is kept, whatever happened next.** The submission row is
written first; the conversion is attempted inside a savepoint; a value the
dataset refuses marks the submission FAILED with the reason, rather than
losing what somebody took the trouble to send.

**A public form is a door to the internet.** It is closed unless published,
rate-limited per address, guarded by a signed arithmetic challenge and a
honeypot field, and an anonymous caller only ever learns that it was received.
