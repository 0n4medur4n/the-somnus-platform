"""The AI in Morpheo v2: extraction from the person's narrative, and a risk screen.

v0.2 p. 14: «Extraer del relato…»; «Las reglas deben vivir fuera del generador
de lenguaje». The model only proposes answers (with the person's exact words)
and points at safety questions to ask now; the person confirms every proposal
before any rule reads it (`morpheo.funnel.extraction`) and only their own
answer to a safety question raises an alert. The final text never comes from
a model.
"""
