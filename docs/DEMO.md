# Demo script (≈ 3 minutes)

Rules for the recording:
- Every number on screen comes from the app.
- Say "rule-based planner", never "the AI reasons", because no language model is used.
- Do not claim that Qloo improves historical predictions: our live backtests did not show that.

## English (for the jury)

**0:00 · The problem (15 s).** "Podcast producers book guests from the same small circle. Green Room is an agent that studies a real show and proposes guests it can defend with evidence."

**0:15 · Moment 1: discovery (35 s).**
- Choose **Argentina**. The cards come from Apple Podcasts' official chart for Argentina. "The rank is Apple's, the selection of interview shows is ours, and we show no audience numbers because none are verifiable."
- Point out that one show is marked *not analyzable: inactive feed*. "The agent will not pretend."
- Choose **Santiago Bilinkis – Futuro en Construcción**.

**0:50 · Moment 2: the agent changes strategy (60 s).**
- Open "What the agent did". Each step has a "Why".
- Read the third step: "Only 3% of episodes name a guest, so guests cannot carry the audience signal; trying the show itself in Qloo."
- "This is a real re-plan, chosen from what it just observed."
- Then: it tries the show as a Qloo podcast entity, then the show's themes as Qloo tags, and only then decides which signal to use, or says it has none.
- In a LIVE session (`?private=1` plus the judge token), show the same trace with real Qloo calls and the "Unexpected guests found by Qloo" panel.
- Point out the verification step: in The Diary Of A CEO, the agent rejects a pick whose name already appears in one of the show's episode titles, and re-selects.

**1:50 · Moment 3: defensible proposals (60 s).**
- Open the first card.
- Status chips:
  - history: "not among the N identified guests; names found in X% of episodes";
  - language: confirmed, probable or unknown;
  - identity: confirmed with context, or pending.
- "View evidence": interview titles and links, the identity check, the photo license.
- "Prepare invitation": every sentence cites a verified appearance or a shared theme.
- Scroll to **Unexpected guests found by Qloo**. "Qloo proposes people outside our sources. Their identity and language come only from Qloo, so they stay apart, pending verification."

**2:50 · Close (10 s).** "Qloo finds the cultural neighbourhood; Green Room's agent checks it against public evidence. The producer decides."

## Español (referencia)

**0:00 · Problema.** "Los productores invitan siempre al mismo círculo. Green Room es un agente que estudia un programa real y propone invitados defendibles con evidencias."

**0:15 · Momento 1: descubrimiento.**
- Elegir **Argentina**. Ranking oficial de Apple Podcasts del país; la selección de programas de entrevistas es nuestra; no mostramos cifras de audiencia.
- Un programa aparece como *no analizable: feed inactivo*.
- Elegir **Santiago Bilinkis**.

**0:50 · Momento 2: el agente cambia de estrategia.**
- Abrir "Qué hizo el agente" y leer el "Por qué" de cada paso.
- "Solo el 3% de los episodios nombra a un invitado… pruebo con el propio programa en Qloo", después etiquetas temáticas, y después decide qué señal usar.
- En LIVE (`?private=1` más el token del jurado), las mismas decisiones con consultas reales y el panel de descubrimientos.
- La verificación descarta a alguien cuyo nombre ya aparece en un título del programa, y vuelve a elegir.

**1:50 · Momento 3: propuestas defendibles.**
- Etiquetas de historial, idioma e identidad.
- Evidencias con enlaces.
- Invitación basada solo en evidencia.
- Descubrimientos de Qloo separados y pendientes de verificación.

**2:50 · Cierre.** "Qloo encuentra el vecindario cultural; el agente de Green Room lo contrasta con evidencia pública. El productor decide."

## Before recording
- MOCK mode is enough to show the re-plan: MOCK Qloo returns no podcast entity and no tags, so the agent visibly falls back and says so.
- Show real Qloo results only in a LIVE session approved for the recording, and switch `QLOO_LIVE_ENABLED` back to `false` afterwards.
- If LIVE returns other decisions than the ones in this script, narrate what the trace says. Do not use the script's wording.
