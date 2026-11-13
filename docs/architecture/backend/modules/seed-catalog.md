# `src/seed/catalog`

The vocabularies the seed draws from.

Plain data, kept apart from the builders so the shape of the dataset and the
words in it can change independently. Two rules held throughout:

* **Nothing is lorem ipsum.** A ticket called "Lorem ipsum dolor" tells you
  nothing about whether the ticket list is readable at 240 characters, and a
  demo full of placeholder text is a demo nobody can evaluate.
* **Every list is long enough not to repeat obviously.** 150 users drawn from
  20 first names look like a bug, not a company.
