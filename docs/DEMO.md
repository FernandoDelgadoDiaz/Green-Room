# Demo script (≈ 2 minutes)

Rules for the recording:
- Every number and name on screen comes from the app. Read what the screen shows, not this script.
- Say "rule-based planner", never "the AI reasons" or "the AI thinks", because no language model is used.
- Do not claim that Qloo improves the top five or historical predictions: our live backtests did not show that.
- Do not claim we know a show's listeners. Qloo describes aggregate taste.
- Qloo's answers are not stored in this public repository (developer guide), so this script names no person, artist, film or tag returned by Qloo. Use the ones on screen.

## Before recording
- Open https://greenroom1.netlify.app and check that the header says **Qloo LIVE**. If it says MOCK, do not record.
- Warm the shows you will use: analyze **CREATIVO** (Mexico) and **The Diary Of A CEO** once, 30–90 s each. The recording then opens them instantly from the cache, and the banner says "served from cache".
  - Each fresh analysis uses the daily Qloo budget (it resets at 00:00 UTC, 21:00 in Argentina).
- To show a live analysis, record it and cut the wait in editing.
- Desktop screen, browser zoom 110 %, language switched to **English** (top right). Keep it under 2:30.

## English (for the jury)

**0:00 · The problem (15 s).**
🎬 Home page, with the **Qloo LIVE** indicator in the header.
> "Podcast producers book guests from the same small circle, from memory and gut feeling. Green Room is an agent that studies a real show and proposes guests it can defend with evidence. And it uses Qloo's taste graph to find people the show's own history could never surface."

**0:15 · Pick a real show (20 s).**
🎬 **Mexico** → **CREATIVO** → **Analyze**. Point at the green banner: "Built with the real Qloo API · computed … · N Qloo queries".
> "I pick CREATIVO, one of Mexico's top interview podcasts on Apple's chart. Green Room reads its real public RSS feed: hundreds of episodes and past guests. The analysis runs against the real Qloo API, in the background."

**0:35 · What Qloo added (30 s), the central moment.**
🎬 Point at the **What Qloo added** card, at the top of the results.
> "This is what Qloo added. The agent asked Qloo who else this audience has affinity for, then verified every person: identity on Wikidata, the theme, not a past guest, the interview language.
> Here's [first person on the card], who has never been interviewed on any of the shows in our sources. Qloo found them. The card says where they rank and why.
> Qloo also gives conversation hooks: music, films and books. These are tastes associated with the show's signals, not data about its listeners."

- Point at the folded line "N more without a confirmed language": "They are verified, but we don't know they can do the interview in Spanish, so they stay folded."

**1:05 · The agent decides and explains (25 s).**
🎬 Open **What the agent did** and scroll the steps.
> "Every step is a decision by a rule-based planner, with the reason it ran. Here, few past guests could be confirmed in Qloo, so the agent re-planned: it translated the show's Spanish themes into Qloo tags and used them as the audience signal."

- Read the step's "Why" as the screen shows it. If the trace chose another signal, narrate that one.
- Optional: open the discovery panel and read the funnel (proposed → verified).

**1:30 · Defensible guests (20 s).**
🎬 Scroll to the five cards. Open one → **View evidence** → **Prepare invitation**.
> "The five picks are ranked on evidence: real interviews on comparable shows, with links, an identity check and the interview language. Qloo's affinity can only reorder comparable candidates; it never pushes a weaker one in. And the invitation cites only verified facts."

**1:50 · Close (10 s).**
🎬 Back up to **What Qloo added**.
> "Qloo finds the cultural neighborhood. Green Room's agent checks it against public evidence. The producer decides."

## Español (referencia)

**0:00 · Problema.** Pantalla de inicio con "Qloo LIVE". "Los productores invitan siempre al mismo círculo. Green Room es un agente que estudia un programa real, propone invitados defendibles y usa el grafo de gustos de Qloo para encontrar personas que el historial del programa nunca mostraría."

**0:15 · Elegir un programa real.** México → CREATIVO → Analizar. Señalar el banner verde. "Lee el feed RSS público real; el análisis corre contra la API real de Qloo, en segundo plano."

**0:35 · Lo que aportó Qloo (momento central).**
- "El agente le preguntó a Qloo con quién más tiene afinidad esta audiencia y verificó a cada persona: identidad, tema, que no haya sido invitado, idioma."
- Nombrar a la primera persona de la tarjeta: nunca fue entrevistada en los programas de nuestras fuentes, la encontró Qloo, y la tarjeta dice en qué puesto queda y por qué.
- Ideas para la conversación (música, películas, libros): gustos asociados, no datos de los oyentes.
- La línea plegada "N más sin idioma confirmado": verificadas, pero sin evidencia de que entrevisten en español.

**1:05 · El agente decide y lo explica.** Abrir "Qué hizo el agente". "Cada paso es una decisión de un planificador por reglas, con su motivo." Leer el "Por qué" que muestra la pantalla: con pocos invitados confirmados, tradujo los temas a etiquetas de Qloo.

**1:30 · Invitados defendibles.** Cinco tarjetas → Ver evidencia → Preparar invitación. "Se ordenan por evidencia. La afinidad de Qloo solo reordena candidatos comparables. La invitación cita solo hechos verificados."

**1:50 · Cierre.** "Qloo encuentra el vecindario cultural; el agente de Green Room lo contrasta con evidencia pública. El productor decide."
