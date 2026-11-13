# Contracts and the renewals pipeline (§13)

Contracts and the renewals pipeline (§13).

Built on the customer renewals the design already mentions: a contract is a
customer agreement with a value (ARR), a term and an end date, and as the end
date approaches it is *worked* — through a pipeline of stages:

    UPCOMING → NEGOTIATION → COMMITTED → RENEWED | CHURNED

Four decisions:

* **History is the audit trail.** Every create, edit and stage move is an
  audit row on `resource_type = "contract"` with the fields before and after,
  exactly the shape record writes leave — which is what makes a contract's
  version history (§17) the same feature as a ticket's, restore included.
* **Stage carries a default probability.** Moving a card sets the stage's
  probability unless the reader has set one by hand on the way; the forecast
  weights each open contract by it.
* **At risk is the health score's word, not a second opinion.** A contract is
  flagged when its customer's health band is at risk or critical (§12), and a
  change to a contract recomputes that customer's score — a churned renewal
  is the strongest health signal there is.
* **Files live in the platform's file store**, in a folder per contract
  created on first upload, so a contract's documents are also files anybody
  with access can find in /files.
