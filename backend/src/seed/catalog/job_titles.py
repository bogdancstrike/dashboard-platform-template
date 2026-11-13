"""Seed data for catalog: FIRST_NAMES, LAST_NAMES, JOB_TITLES."""

from __future__ import annotations

from src.core import geography, vocabulary
from src.core.vocabulary import weighted

FIRST_NAMES: tuple[str, ...] = (
    "Ana", "Mihai", "Elena", "Andrei", "Ioana", "Radu", "Maria", "Cristian",
    "Diana", "Alexandru", "Raluca", "Bogdan", "Simona", "Vlad", "Gabriela",
    "Sorin", "Carmen", "Tudor", "Irina", "Cătălin", "Alina", "Marius",
    "Roxana", "Ștefan", "Laura", "Adrian", "Monica", "Paul", "Andreea",
    "Emil", "Sofia", "Lucian", "Bianca", "Victor", "Corina", "Dan",
    "Lucas", "Emma", "Noah", "Olivia", "Liam", "Mia", "Jonas", "Freya",
    "Mateo", "Chiara", "Nils", "Astrid", "Pablo", "Ingrid", "Youssef",
    "Amara", "Kenji", "Sana", "Dmitri", "Zofia", "Bram", "Eline",
    "Tomás", "Aoife", "Rasmus", "Sigrid", "Milan", "Lena", "Aleksander",
    "Nadia", "Hugo", "Clara", "Felix", "Nora", "Otto", "Ilse",
)


LAST_NAMES: tuple[str, ...] = (
    "Popescu", "Ionescu", "Dumitrescu", "Georgescu", "Stoica", "Marin",
    "Constantin", "Radu", "Munteanu", "Ciobanu", "Nistor", "Barbu",
    "Stanciu", "Șerban", "Diaconu", "Vasilescu", "Petrescu", "Tudose",
    "Novak", "Kovács", "Horvat", "Nowak", "Kowalski", "Schneider",
    "Müller", "Fischer", "Weber", "Hoffmann", "Bakker", "de Vries",
    "Jansen", "Larsen", "Nielsen", "Andersson", "Lindqvist", "Virtanen",
    "Silva", "Costa", "Ferreira", "Rossi", "Bianchi", "Esposito",
    "García", "Martínez", "López", "Moreau", "Lefèvre", "Dubois",
    "O'Sullivan", "Byrne", "Walsh", "Novotný", "Dvořák", "Marek",
    "Aslan", "Yılmaz", "Haddad", "Okafor", "Mensah", "Tanaka",
)


JOB_TITLES: dict[str, tuple[str, ...]] = {
    "Engineering": (
        "Software Engineer", "Senior Software Engineer", "Staff Engineer",
        "Engineering Manager", "Platform Engineer", "QA Engineer",
        "Site Reliability Engineer", "Data Engineer", "Frontend Engineer",
    ),
    "Product": ("Product Manager", "Senior Product Manager", "Product Owner", "Product Analyst"),
    "Design": ("Product Designer", "UX Researcher", "Design Lead", "Content Designer"),
    "Sales": ("Account Executive", "Sales Manager", "Sales Development Rep", "Solutions Engineer"),
    "Marketing": ("Marketing Manager", "Content Strategist", "Growth Analyst", "Brand Manager"),
    "Support": ("Support Specialist", "Support Team Lead", "Technical Support Engineer"),
    "Finance": ("Financial Analyst", "Controller", "Accounts Manager", "Procurement Specialist"),
    "People": ("People Partner", "Recruiter", "People Operations Manager"),
    "Operations": ("Operations Manager", "Business Analyst", "Programme Manager"),
    "Legal": ("Legal Counsel", "Compliance Officer", "Data Protection Officer"),
    "Security": ("Security Engineer", "Security Analyst", "Head of Security"),
    "Executive": ("Chief Executive Officer", "Chief Technology Officer", "Chief Financial Officer"),
}


DEPARTMENTS: tuple[tuple[str, str], ...] = (
    ("Engineering", "ENG"), ("Product", "PRD"), ("Design", "DSG"),
    ("Sales", "SLS"), ("Marketing", "MKT"), ("Support", "SUP"),
    ("Finance", "FIN"), ("People", "HR"), ("Operations", "OPS"),
    ("Legal", "LGL"), ("Security", "SEC"), ("Executive", "EXE"),
)


#: Sub-departments, so the hierarchical selector (§9) has real depth.
SUB_DEPARTMENTS: dict[str, tuple[str, ...]] = {
    "Engineering": ("Platform", "Applications", "Infrastructure", "Quality"),
    "Sales": ("Enterprise", "Mid-Market", "Partnerships"),
    "Support": ("Tier 1", "Tier 2", "Customer Success"),
    "Operations": ("Logistics", "Facilities"),
    "Finance": ("Accounting", "Procurement"),
}


TEAM_NAMES: tuple[str, ...] = (
    "Atlas", "Beacon", "Cobalt", "Delta", "Ember", "Foundry", "Granite",
    "Harbour", "Ionic", "Juniper", "Keystone", "Lantern", "Meridian",
    "Northstar", "Orbit", "Pioneer", "Quarry", "Redwood", "Summit",
    "Tidal", "Umbra", "Vertex", "Wayfinder", "Zenith",
)


ORG_ROOTS: tuple[str, ...] = (
    "Northwind", "Contoso", "Lakeside", "Ironwood", "Brightpath", "Cobalt",
    "Everline", "Fairmont", "Greenfield", "Halcyon", "Ridgeway", "Stonebridge",
    "Trailhead", "Vanguard", "Westbrook", "Kestrel", "Marlow", "Oakhaven",
    "Pinecrest", "Quicksilver", "Riverstone", "Silverline", "Thornbury",
)


ORG_SUFFIXES: tuple[str, ...] = (
    "Group", "Holdings", "Industries", "Systems", "Logistics", "Analytics",
    "Technologies", "Partners", "Solutions", "Networks", "Labs", "Works",
)


INDUSTRIES: tuple[str, ...] = (
    "Manufacturing", "Financial Services", "Healthcare", "Retail",
    "Logistics", "Energy", "Telecommunications", "Public Sector",
    "Education", "Insurance", "Construction", "Agriculture",
    "Media", "Hospitality", "Pharmaceuticals", "Automotive",
)


#: Weighted in the vocabulary's order — smallest tier first — so a tier added
#: there fails loudly here instead of silently never being generated.
ORG_TIERS = weighted(vocabulary.ORG_TIER, (0.05, 0.25, 0.5, 0.2))


#: (name, code, timezone, currency) — derived from the gazetteer, so a region
#: the seed creates is a region the map can name.
REGIONS: tuple[tuple[str, str, str, str], ...] = tuple(
    (region.name, region.code, region.timezone, region.currency)
    for region in geography.REGIONS
)


#: (city, country, region code) — derived from the gazetteer rather than
#: written twice. A city that can be seeded is therefore a city the map can
#: place; two lists would be a map with holes in it the first time anybody
#: added a city to one of them.
LOCATIONS: tuple[tuple[str, str, str], ...] = tuple(
    (place.city, place.country, place.region) for place in geography.PLACES
)


PROJECT_ADJECTIVES: tuple[str, ...] = (
    "Unified", "Next-Generation", "Automated", "Consolidated", "Federated",
    "Realtime", "Self-Service", "Regional", "Modular", "Zero-Touch",
    "Predictive", "Streamlined", "Integrated", "Resilient", "Cross-Border",
)


PROJECT_SUBJECTS: tuple[str, ...] = (
    "Billing Platform", "Customer Portal", "Warehouse Automation",
    "Data Lakehouse", "Identity Migration", "Field Service App",
    "Partner Onboarding", "Fraud Detection", "Supply Chain Visibility",
    "Payment Orchestration", "Document Archive", "Reporting Suite",
    "Contact Centre", "Asset Registry", "Compliance Programme",
    "Network Modernisation", "Employee Intranet", "Sales Enablement",
    "Inventory Forecasting", "Quality Management",
)


PROJECT_STATUSES = weighted(vocabulary.PROJECT_STATUS, (0.45, 0.15, 0.1, 0.22, 0.05, 0.03))


PROJECT_PHASES = vocabulary.PROJECT_PHASE


PROJECT_HEALTH = weighted(vocabulary.PROJECT_HEALTH, (0.62, 0.24, 0.14))


PRIORITIES = weighted(vocabulary.PRIORITY, (0.2, 0.45, 0.25, 0.1))


TASK_VERBS: tuple[str, ...] = (
    "Migrate", "Refactor", "Document", "Investigate", "Automate", "Review",
    "Roll out", "Harden", "Benchmark", "Decommission", "Instrument",
    "Consolidate", "Validate", "Escalate", "Reconcile", "Draft", "Audit",
)


TASK_OBJECTS: tuple[str, ...] = (
    "the invoicing service", "the onboarding flow", "the nightly export",
    "the permission matrix", "the search index", "the audit retention job",
    "the customer import", "the alerting rules", "the staging database",
    "the API rate limits", "the notification templates", "the backup schedule",
    "the SSO configuration", "the reporting pipeline", "the file storage tier",
    "the device firmware rollout", "the quarterly reconciliation",
    "the incident runbook", "the data retention policy", "the pricing table",
)


TASK_STATUSES = weighted(vocabulary.TASK_STATUS, (0.16, 0.14, 0.22, 0.07, 0.11, 0.26, 0.04))
