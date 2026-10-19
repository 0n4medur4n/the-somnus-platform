# Instrumentos validados (ISI, Epworth, STOP-Bang)

Pendiente: archivo oficial de Jesús. Hasta que llegue, cada instrumento se
salta en la entrevista y el panel de pruebas del equipo lo indica.

Jesús gestiona las licencias y entrega, con cada una, la versión española
validada oficial. Por cada instrumento van dos archivos en esta carpeta:

- `<CÓDIGO>.official.txt` — el texto oficial tal como se entrega (UTF-8).
- `<CÓDIGO>.json` — el mismo contenido estructurado, transcrito sin cambiar
  una palabra.

Códigos: `ISI`, `ESS` (Epworth), `STOP-BANG`.

## Formato de `<CÓDIGO>.json`

```json
{
  "instrument": "ISI",
  "name": "…nombre oficial…",
  "language": "es-ES",
  "version": "…versión de la traducción validada…",
  "licence": {
    "source": "…de dónde viene la licencia (p. ej. Mapi Research Trust)…",
    "reference": "…número o referencia de la licencia…",
    "valid_until": "AAAA-MM-DD o null"
  },
  "official_text": { "file": "ISI.official.txt", "sha256": "…" },
  "instructions": "…instrucciones, literales…",
  "items": [
    {
      "id": "1a",
      "text": "…ítem, literal…",
      "options": [ { "value": 0, "label": "…opción, literal…" } ]
    }
  ],
  "scoring": {
    "method": "sum",
    "bands": [ { "min": 0, "max": 9, "label": "…etiqueta del manual, literal…" } ],
    "band_overrides": [
      {
        "band": "…etiqueta…",
        "subtotal": { "items": ["s", "t", "o", "p"], "min": 2 },
        "any_of_items": ["b", "n", "g"]
      }
    ]
  }
}
```

(Los valores de ejemplo de `bands` y `band_overrides` solo muestran la forma; los
puntos de corte son los del manual oficial de cada instrumento.)

## Lo que se comprueba al arrancar

- El SHA-256 de `<CÓDIGO>.official.txt` coincide con `official_text.sha256`.
- Las instrucciones, cada ítem, cada opción y cada etiqueta de banda están
  palabra por palabra en el texto oficial (solo se ignoran saltos de línea y
  espacios repetidos).
- El número de ítems y los valores de respuesta son los del instrumento:
  ISI 7 ítems 0-4, Epworth 8 ítems 0-3, STOP-Bang 8 ítems 0/1.
- Los puntos de corte cubren todas las puntuaciones posibles, sin huecos.
- La licencia no ha caducado.

Un archivo que no pase estas comprobaciones impide arrancar el servicio: nunca
se muestra un cuestionario equivocado.

## Dónde se ofrecen (siempre opcionales)

- ISI: rama I, en I6 (v0.2 p. 5: «Proponer TCC-I; diario e ISI como apoyo, sin
  retrasar la atención»), cuando I1-I3 son «Sí».
- Epworth: al abrirse la rama D. STOP-Bang: al abrirse la rama R. v0.2 p. 14
  no los sitúa en un paso: «DEFAULT – Jesús puede cambiarlo».

Ninguna escala confirma apnea ni sustituye la entrevista (v0.2 p. 14).
