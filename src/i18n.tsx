import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Lang } from '../core/pitch';

export type { Lang };

const STORAGE_KEY = 'greenroom.lang';

// UI strings. Proper names, episode titles and quotes from sources are never translated.
const STRINGS = {
  'brand.tagline': { en: 'The guest your audience is waiting for.', es: 'El invitado que tu audiencia está esperando.' },
  'brand.subtitle': {
    en: 'An agent that reads a podcast’s real episode history, finds people with a verifiable track record, checks they have not been on the show, and explains every pick.',
    es: 'Un agente que lee el historial real de episodios de un podcast, encuentra personas con trayectoria verificable, controla que no hayan pasado por el programa y explica cada elección.',
  },
  'live.title': { en: 'Private LIVE test', es: 'Prueba privada LIVE' },
  'live.placeholder': { en: 'Access token', es: 'Token de acceso' },
  'live.enter': { en: 'Use token', es: 'Usar token' },
  'live.exit': { en: 'Leave private mode', es: 'Salir del modo privado' },
  'live.live': { en: 'LIVE: analyses use the real Qloo API (limited).', es: 'LIVE: los análisis usan la API real de Qloo (con límites).' },
  'live.off': { en: 'Token accepted, but LIVE is switched off on the server; analyses stay in MOCK.', es: 'Token aceptado, pero LIVE está apagado en el servidor; los análisis siguen en MOCK.' },
  'live.denied': { en: 'Token rejected.', es: 'Token rechazado.' },
  'live.unconfigured': { en: 'Private testing is not configured on this server.', es: 'La prueba privada no está configurada en este servidor.' },
  'live.error': { en: 'Could not check private mode', es: 'No se pudo verificar el modo privado' },
  'cat.step1': { en: '1 · Choose a country', es: '1 · Elegí un país' },
  'cat.step2': { en: '2 · Choose a podcast', es: '2 · Elegí un podcast' },
  'cat.pickCountry': { en: 'Pick a country to see interview podcasts made there (verified origin), or search by name.', es: 'Elegí un país para ver podcasts de entrevistas hechos allí (origen verificado), o buscá por nombre.' },
  'cat.search': { en: 'Search by podcast or host', es: 'Buscar por podcast o conductor' },
  'cat.noResults': { en: 'No podcast in the catalog matches.', es: 'Ningún podcast del catálogo coincide.' },
  'cat.sourceNote': {
    en: 'Interview podcasts made in {country}: each one has a source for where it is produced or who makes it (checked {date}). Apple chart positions are shown only as popularity, never as proof of nationality. No audience figures are shown because none are verifiable.',
    es: 'Podcasts de entrevistas hechos en {country}: cada uno tiene una fuente sobre dónde se produce o quién lo hace (revisado el {date}). La posición en Apple Podcasts se muestra solo como popularidad, nunca como prueba de nacionalidad. No se muestran cifras de audiencia porque ninguna es verificable.',
  },
  'os.title': { en: 'Not in the list? Search any podcast', es: '¿No está en la lista? Buscá cualquier podcast' },
  'os.mode.name': { en: 'By name', es: 'Por nombre' },
  'os.mode.link': { en: 'By link', es: 'Por enlace' },
  'os.placeholder.name': { en: 'Podcast name', es: 'Nombre del podcast' },
  'os.placeholder.link': { en: 'Apple Podcasts, Spotify, YouTube or RSS link', es: 'Enlace de Apple Podcasts, Spotify, YouTube o RSS' },
  'os.go': { en: 'Search', es: 'Buscar' },
  'os.note.name': {
    en: 'Searches the Apple Podcasts directory. Results from any country are shown; the store where a show is available does not prove where it is made.',
    es: 'Busca en el directorio de Apple Podcasts. Se muestran resultados de cualquier país; la tienda donde está disponible un programa no prueba dónde se hace.',
  },
  'os.note.link': {
    en: 'Apple links and RSS feeds are read directly. Spotify and YouTube do not give us episode lists: we read the title and let you pick the same show in Apple Podcasts. Not every link can be analyzed.',
    es: 'Los enlaces de Apple y los RSS se leen directamente. Spotify y YouTube no nos dan la lista de episodios: leemos el título y te dejamos elegir el mismo programa en Apple Podcasts. No todo enlace se puede analizar.',
  },
  'os.none': { en: 'No podcast found.', es: 'No se encontró ningún podcast.' },
  'os.originVerified': { en: 'Origin verified: {c}', es: 'Origen verificado: {c}' },
  'os.originUnverified': { en: 'Origin not verified', es: 'Origen sin verificar' },
  'os.originUnverifiedLong': {
    en: 'Found through the open search: its country of origin is not verified and is not inferred from the store.',
    es: 'Encontrado con la búsqueda abierta: su país de origen no está verificado y no se infiere de la tienda.',
  },
  'os.inCatalog': { en: 'in our catalog', es: 'en nuestro catálogo' },
  'os.store': { en: 'Listed in Apple’s {s} store (availability, not origin)', es: 'Listado en la tienda {s} de Apple (disponibilidad, no origen)' },
  'os.noFeed': { en: 'No public RSS', es: 'Sin RSS público' },
  'as.complete': { en: 'full analysis available', es: 'análisis completo disponible' },
  'as.limited': { en: 'limited analysis', es: 'análisis limitado' },
  'as.insufficient': { en: 'insufficient source: not analyzable', es: 'fuente insuficiente: no analizable' },
  'as.sources': { en: 'Sources read', es: 'Fuentes consultadas' },
  'trace.collapsed': { en: 'What the agent did ({n} steps)', es: 'Qué hizo el agente ({n} pasos)' },
  'ext.title': { en: 'Verified outside our RSS', es: 'Verificado fuera de nuestro RSS' },
  'ext.noInterviews': { en: 'No interviews in our RSS sources: activity and recency not measured.', es: 'Sin entrevistas en nuestras fuentes RSS: actividad y recencia sin medir.' },
  'funnel.external': { en: 'documented outside RSS', es: 'documentados fuera del RSS' },
  'funnel.typeErrors': { en: 'not individual people', es: 'no son personas individuales' },
  'card.qlooExternal': { en: 'Proposed by Qloo (#{n}) · documented in Wikidata', es: 'Propuesto por Qloo (n.º {n}) · documentado en Wikidata' },
  'tech.a.potential': { en: 'Editorial potential and availability (evidence only)', es: 'Potencial editorial y disponibilidad (solo evidencia)' },
  'tech.a.potentialDetail': { en: '{n} long-form interviews on record in our sources ({s} shows)', es: '{n} entrevistas largas registradas en nuestras fuentes ({s} programas)' },
  'tech.a.availability': { en: 'availability not assessed: no source provides it', es: 'disponibilidad sin evaluar: ninguna fuente la informa' },
  'tech.a.external': { en: 'documented identity, no interviews on record', es: 'identidad documentada, sin entrevistas registradas' },
  'check.external': { en: 'Independent sources', es: 'Fuentes independientes' },
  'cat.unverifiedChip': { en: 'Origin not verified ({n})', es: 'Origen sin verificar ({n})' },
  'cat.unverifiedNote': {
    en: 'We could not find a reliable source for where these shows are made, so they are not listed under any country. They can still be analyzed.',
    es: 'No encontramos una fuente confiable sobre dónde se hacen estos programas, así que no se listan bajo ningún país. Igual se pueden analizar.',
  },
  'cat.originVerified': { en: 'Made in {country} · verified ({basis})', es: 'Hecho en {country} · verificado ({basis})' },
  'cat.originUnverified': { en: 'Origin not verified', es: 'Origen sin verificar' },
  'cat.basis.production': { en: 'production', es: 'producción' },
  'cat.basis.host': { en: 'host', es: 'conductor' },
  'cat.basis.null': { en: '—', es: '—' },
  'cat.popularity': { en: 'Popularity (complementary): {ranks} in Apple Podcasts', es: 'Popularidad (dato complementario): {ranks} en Apple Podcasts' },
  'cat.noChart': { en: 'Not in the Apple charts we read', es: 'No figura en los rankings de Apple que leímos' },
  'cat.lastEpisode': { en: 'Last episode {date}', es: 'Último episodio {date}' },
  'cat.appleCount': { en: '{n} episodes per Apple', es: '{n} episodios según Apple' },
  'cat.snapshot': { en: '{n} episodes in our RSS snapshot · guest named in {c}%', es: '{n} episodios en nuestra copia del RSS · invitado identificado en el {c}%' },
  'cat.status.analyzable': { en: 'Analyzable', es: 'Analizable' },
  'cat.status.limited.feed_stale': { en: 'Limited: RSS feed has no episode in the last year', es: 'Limitado: el RSS no tiene episodios del último año' },
  'cat.status.limited.few_guest_names': { en: 'Limited: few guest names in titles', es: 'Limitado: pocos nombres de invitados en los títulos' },
  'cat.status.not_analyzable.inactive': { en: 'Not analyzable: inactive feed', es: 'No analizable: feed inactivo' },
  'cat.status.not_analyzable.feed_not_snapshotted': { en: 'Not analyzable yet: feed not processed', es: 'No analizable todavía: feed sin procesar' },
  'cat.analyze': { en: 'Analyze this podcast', es: 'Analizar este podcast' },
  'cat.notAnalyzableBtn': { en: 'Not analyzable', es: 'No analizable' },
  'cat.change': { en: '← Choose another podcast', es: '← Elegir otro podcast' },
  'trace.why': { en: 'Why', es: 'Por qué' },
  'trace.planner': {
    en: 'Each step was chosen by Green Room’s rule-based planner from what the previous steps observed. No language model is involved.',
    es: 'Cada paso lo eligió el planificador de reglas de Green Room a partir de lo que observaron los pasos anteriores. No interviene ningún modelo de lenguaje.',
  },
  'nav.recommend': { en: 'Recommend guests', es: 'Recomendar invitados' },
  'nav.backtest': { en: 'Backtest', es: 'Prueba histórica' },
  'nav.method': { en: 'Data & method', es: 'Datos y método' },
  'lang.label': { en: 'Language', es: 'Idioma' },
  'step.pick': { en: '1 · Pick a show', es: '1 · Elegí un programa' },
  'step.results': { en: '3 · Analysis and recommendations for', es: '3 · Análisis y recomendaciones para' },
  'showdesc.lex-fridman': { en: 'Long-form conversations on technology, science, history, philosophy and culture.', es: 'Conversaciones extensas sobre tecnología, ciencia, historia, filosofía y cultura.' },
  'showdesc.diary-of-a-ceo': { en: 'Interviews on business, psychology, health and personal development.', es: 'Entrevistas sobre negocios, psicología, salud y desarrollo personal.' },
  'showdesc.creativo': { en: 'Mexican interview podcast: music, comedy, sports, business and culture (Spanish).', es: 'Podcast mexicano de entrevistas: música, humor, deportes, negocios y cultura (en español).' },
  'show.hostedBy': { en: 'hosted by', es: 'conducido por' },
  'show.episodes': { en: 'episodes', es: 'episodios' },
  'show.withGuests': { en: 'with identified guests', es: 'con invitado identificado' },
  'show.feed': { en: 'official RSS feed, read', es: 'RSS oficial, leído el' },
  'lang.en': { en: 'English', es: 'Inglés' },
  'lang.es': { en: 'Spanish', es: 'Español' },
  'state.loadingShows': { en: 'Loading shows…', es: 'Cargando programas…' },
  'state.analyzing': { en: 'The agent is reading the history…', es: 'El agente está leyendo el historial…' },
  'state.error': { en: 'Something went wrong:', es: 'Algo salió mal:' },
  'trace.title': { en: 'What the agent did', es: 'Qué hizo el agente' },
  'trace.replay': { en: 'replay of this run’s actual steps', es: 'repetición de los pasos reales de esta ejecución' },
  'themes.title': { en: 'Themes in the show’s history', es: 'Temas en el historial del programa' },
  'themes.note': {
    en: 'From {n} episode titles. Describes what the show talks about, not what listeners like.',
    es: 'A partir de {n} títulos de episodios. Describe de qué habla el programa, no qué le gusta a su audiencia.',
  },
  'affinities.title': { en: 'Cultural affinities inferred by Qloo', es: 'Afinidades culturales inferidas por Qloo' },
  'disc.newTitle': { en: 'New people Qloo found (verified, on-theme)', es: 'Personas nuevas que encontró Qloo (verificadas y pertinentes)' },
  'disc.newNote': {
    en: 'Nobody here has an interview in our sources: without Qloo, Green Room could not have suggested them. Each one passed identity, theme and repeat checks. They are listed apart because they did not outscore the five picks on our evidence; the reason is given, and no one is pushed into the top five.',
    es: 'Ninguna tiene entrevistas en nuestras fuentes: sin Qloo, Green Room no podría haberlas sugerido. Cada una pasó los controles de identidad, tema y repetición. Se listan aparte porque no superaron a las cinco elegidas según nuestra evidencia; se indica el motivo y nadie es forzado al top cinco.',
  },
  'disc.newRow': { en: 'Qloo rank {q} · topical fit {f} · position {p} in our ranking', es: 'Posición {q} en Qloo · ajuste temático {f} · posición {p} en nuestro ranking' },
  'disc.newLang': { en: 'language not confirmed', es: 'idioma no confirmado' },
  'disc.newInTop': { en: 'in the top five', es: 'en el top cinco' },
  'pl.audience': {
    en: 'Inferred, not measured: Qloo’s affinities are taste patterns of people who like this show’s signals (its past guests, the show itself or its topics). They are not data about this show’s listeners, and we do not know who they are.',
    es: 'Inferidas, no medidas: las afinidades de Qloo son patrones de gusto de quienes se interesan por las señales de este programa (sus invitados anteriores, el propio programa o sus temas). No son datos de los oyentes de este programa, y no sabemos quiénes son.',
  },
  'pl.offNote': {
    en: 'Public Qloo LIVE is off right now. Analyses use MOCK data and only show how the pipeline works.',
    es: 'El acceso público a Qloo LIVE está apagado en este momento. Los análisis usan datos MOCK y solo muestran cómo funciona el circuito.',
  },
  'pl.banner': { en: 'Built with the real Qloo API · computed {date} UTC', es: 'Construido con la API real de Qloo · calculado el {date} UTC' },
  'pl.cached': { en: 'served from cache: no new Qloo queries', es: 'servido desde caché: sin nuevas consultas a Qloo' },
  'pl.calls': { en: '{n} Qloo queries', es: '{n} consultas a Qloo' },
  'pl.stale': {
    en: 'Earlier LIVE result, shown because a new one cannot be produced right now.',
    es: 'Resultado LIVE anterior, mostrado porque ahora no se puede generar uno nuevo.',
  },
  'pl.partial': {
    en: 'Some Qloo queries failed ({errors}). The result uses only the answers that did arrive.',
    es: 'Algunas consultas a Qloo fallaron ({errors}). El resultado usa solo las respuestas que llegaron.',
  },
  'pl.failTitle': { en: 'Qloo LIVE could not produce this result', es: 'Qloo LIVE no pudo generar este resultado' },
  'pl.retry': { en: 'Try again', es: 'Reintentar' },
  'pl.useStale': { en: 'See the earlier LIVE result ({date})', es: 'Ver el resultado LIVE anterior ({date})' },
  'pl.mock': { en: 'See a demo without Qloo (MOCK)', es: 'Ver una demostración sin Qloo (MOCK)' },
  'pl.noDirectory': {
    en: 'Qloo LIVE analyzes podcasts from our catalog or from Apple’s podcast directory, where the feed address comes from a trusted directory. This link has no Apple directory entry.',
    es: 'Qloo LIVE analiza podcasts de nuestro catálogo o del directorio de podcasts de Apple, donde la dirección del feed viene de un directorio confiable. Este enlace no tiene una entrada en el directorio de Apple.',
  },
  'pl.running': {
    en: 'Analyzing with the real Qloo API. The analysis runs in the background and can take a few minutes; keep this page open.',
    es: 'Analizando con la API real de Qloo. El análisis corre en segundo plano y puede tardar unos minutos; dejá esta página abierta.',
  },
  'affinities.pending': {
    en: 'Waiting for the live Qloo API. With the key, this panel shows the artists, films and books that people who follow this show’s past guests over-index on. No placeholder names are shown: we do not invent taste data.',
    es: 'Esperando la API real de Qloo. Con la clave, este panel muestra los artistas, películas y libros por los que tienen más afinidad quienes siguen a los invitados anteriores del programa. No mostramos nombres de relleno: no inventamos datos de gustos.',
  },
  'recs.title': { en: 'Five guests to invite next', es: 'Cinco invitados para convocar' },
  'recs.meta': { en: '{n} past guests excluded · as of {date}', es: '{n} invitados anteriores excluidos · al {date}' },
  'recs.mock': {
    en: 'MOCK mode: people, episodes and dates are real (public RSS). Qloo affinity values are simulated, shown in pink, and carry weight 0 in the ranking.',
    es: 'Modo MOCK: personas, episodios y fechas son reales (RSS público). Los valores de afinidad de Qloo son simulados, se muestran en rosa y tienen peso 0 en el ranking.',
  },
  'recs.discarded': { en: 'Discarded because they already appeared ({n})', es: 'Descartados porque ya participaron ({n})' },
  'recs.episode': { en: 'episode', es: 'episodio' },
  'card.score': { en: 'fit score', es: 'puntaje de ajuste' },
  'card.scoreHelp': {
    en: 'Fit score from 0 to 100: 60% topical fit with the show’s themes, 25% recent momentum on comparable podcasts, 15% recency. In live mode, Qloo affinity is blended 50/50. It ranks candidates; it is not a prediction of audience size.',
    es: 'Puntaje de ajuste de 0 a 100: 60% coincidencia con los temas del programa, 25% presencia reciente en podcasts comparables y 15% recencia. Con la API real, la afinidad de Qloo pesa 50%. Sirve para ordenar candidatos; no predice el tamaño de la audiencia.',
  },
  'card.why': { en: 'Why we recommend them', es: '¿Por qué lo recomendamos?' },
  'card.whyThemes': { en: 'Their recent interviews cover {themes}, the same ground {show} keeps returning to.', es: 'Sus entrevistas recientes abordan {themes}, el mismo terreno al que {show} vuelve una y otra vez.' },
  'card.whyNoThemes': { en: 'They have a verifiable interview track record on comparable podcasts.', es: 'Tiene trayectoria verificable como entrevistado en podcasts comparables.' },
  'card.whyLatest': { en: 'Most recently interviewed on {showName} ({date}).', es: 'Su entrevista más reciente fue en {showName} ({date}).' },
  'card.notFoundComplete': { en: 'Not a past guest of {show} · checked against {n} guests in all {e} episodes', es: 'No fue invitado de {show} · revisado contra {n} invitados de los {e} episodios' },
  'card.notFoundPartial': { en: 'Not among {n} identified guests of {show} · names found in {c}% of episodes', es: 'No figura entre {n} invitados identificados de {show} · nombres detectados en el {c}% de los episodios' },
  'card.notFoundPartialHelp': { en: '{m} of {e} episodes have no guest name in the RSS feed: an earlier appearance cannot be ruled out.', es: '{m} de {e} episodios no tienen nombre de invitado en el RSS: no se puede descartar una participación anterior.' },
  'card.lang.confirmed': { en: 'Language {lang} confirmed', es: 'Idioma {lang} confirmado' },
  'card.lang.probable': { en: 'Language {lang} probable', es: 'Idioma {lang} probable' },
  'card.lang.unknown': { en: 'Language {lang} unknown · to verify', es: 'Idioma {lang} desconocido · por verificar' },
  'card.identityPending': { en: 'Qloo identity pending verification', es: 'Identidad en Qloo pendiente de verificación' },
  'disc.title': { en: 'Qloo discovery: proposed, verified, discarded', es: 'Descubrimiento con Qloo: propuestos, verificados, descartados' },
  'disc.note': {
    en: 'Qloo proposes people with affinity to this audience; the agent verifies each one with the same rules as every other candidate. Only verified people can enter the ranking above.',
    es: 'Qloo propone personas con afinidad con esta audiencia; el agente verifica a cada una con las mismas reglas que a cualquier otro candidato. Solo las verificadas pueden entrar al ranking de arriba.',
  },
  'disc.notLive': {
    en: 'This public demo runs the baseline mode (no real Qloo calls). Qloo-enriched discovery runs only in the private LIVE mode, where the agent shows every person Qloo proposed, the checks it ran and what it kept.',
    es: 'Esta demo pública usa el modo base (sin consultas reales a Qloo). El descubrimiento enriquecido con Qloo funciona solo en el modo LIVE privado, donde el agente muestra a cada persona que propuso Qloo, los controles que hizo y con qué se quedó.',
  },
  'disc.replanned': { en: 'Replanned: {a}', es: 'Replanificado: {a}' },
  'disc.all': { en: 'Every person Qloo proposed ({n}) and the checks run', es: 'Todas las personas que propuso Qloo ({n}) y los controles realizados' },
  'disc.outcome.ranked': { en: 'In ranking', es: 'En el ranking' },
  'disc.outcome.pending': { en: 'Pending', es: 'Pendiente' },
  'disc.outcome.discarded': { en: 'Discarded', es: 'Descartado' },
  'disc.signal': { en: 'signal: {s}', es: 'señal: {s}' },
  'disc.pendingTitle': { en: 'Pending discoveries (not verifiable with our sources)', es: 'Descubrimientos pendientes (no verificables con nuestras fuentes)' },
  'disc.rank': { en: 'Qloo rank #{n}', es: 'Posición en Qloo: #{n}' },
  'funnel.proposed': { en: 'proposed by Qloo', es: 'propuestos por Qloo' },
  'funnel.identity': { en: 'identity verified', es: 'identidad verificada' },
  'funnel.ranked': { en: 'verified & on-theme', es: 'verificados y en tema' },
  'funnel.language': { en: 'language-compatible', es: 'idioma compatible' },
  'funnel.shortlist': { en: 'in the top list', es: 'en la lista principal' },
  'check.person': { en: 'Person', es: 'Persona' },
  'check.repeat': { en: 'Not a past guest', es: 'No es invitado anterior' },
  'check.identity': { en: 'Identity', es: 'Identidad' },
  'check.theme': { en: 'Themes', es: 'Temas' },
  'check.language': { en: 'Language', es: 'Idioma' },
  'cmp.title': { en: 'Compared with the baseline (same data, no Qloo)', es: 'Comparado con el modo base (mismos datos, sin Qloo)' },
  'cmp.overlap': { en: '{n} of {k} people in both lists', es: '{n} de {k} personas en ambas listas' },
  'cmp.new': { en: 'Added by Qloo and verified: {names}', es: 'Aportados por Qloo y verificados: {names}' },
  'cmp.baselineRank': { en: '#{n} in the baseline ranking', es: 'n.º {n} en el ranking base' },
  'cmp.confirm': { en: 'Proposed by Qloo, already in the baseline list: {names}', es: 'Propuestos por Qloo y ya presentes en la lista base: {names}' },
  'cmp.affinity': { en: 'Entered only through Qloo affinity (people we already had, no discovery): {names}', es: 'Entraron solo por la afinidad de Qloo (personas que ya teníamos, sin descubrimiento): {names}' },
  'cmp.displaced': { en: 'Left the list compared with the baseline: {names}', es: 'Salieron de la lista respecto del modo base: {names}' },
  'funnel.pendingDetail': { en: '{t} with identity verified but kind not confirmed (generic Qloo type) · {c} not checked (verification cap)', es: '{t} con identidad verificada pero tipo sin confirmar (tipo genérico en Qloo) · {c} sin revisar (límite de verificación)' },
  'sigv.none_in_qloo': { en: 'Qloo returned nothing for this show’s guests, title or themes.', es: 'Qloo no devolvió nada para los invitados, el título o los temas de este programa.' },
  'sigv.unrecognized': { en: 'Qloo returned results, but none matched this show’s guests, title or themes exactly.', es: 'Qloo devolvió resultados, pero ninguno coincidió exactamente con los invitados, el título o los temas del programa.' },
  'sigv.ambiguous': { en: 'Qloo returned namesakes for this show’s guests: too ambiguous to use.', es: 'Qloo devolvió homónimos de los invitados del programa: demasiado ambiguo para usarlo.' },
  'cmp.pending': { en: '{n} Qloo-only people pending (not counted as a contribution)', es: '{n} personas solo de Qloo pendientes (no cuentan como aporte)' },
  'sum.title': { en: 'Podcast analyzed', es: 'Podcast analizado' },
  'sum.origin': { en: 'Origin', es: 'Origen' },
  'sum.originVerified': { en: 'verified · {country}', es: 'verificado · {country}' },
  'sum.originUnverified': { en: 'not verified', es: 'sin verificar' },
  'sum.source': { en: 'source', es: 'fuente' },
  'sum.history': { en: 'History', es: 'Historial' },
  'sum.historyDetail': { en: '{e} episodes · {g} identified guests · guest named in {c}%', es: '{e} episodios · {g} invitados identificados · invitado nombrado en el {c}%' },
  'sum.languages': { en: 'Interview languages', es: 'Idiomas de las entrevistas' },
  'sum.conf.high': { en: 'high confidence', es: 'confianza alta' },
  'sum.conf.medium': { en: 'medium confidence', es: 'confianza media' },
  'sum.conf.low': { en: 'low confidence', es: 'confianza baja' },
  'sum.intl': { en: '{n} past guests also interviewed on shows from another country or language', es: '{n} invitados anteriores también entrevistados en programas de otro país o idioma' },
  'sum.signal': { en: 'Qloo signal', es: 'Señal para Qloo' },
  'sum.signalMock': { en: 'none (public demo, baseline mode)', es: 'ninguna (demo pública, modo base)' },
  'sig.guests': { en: 'past guests with confirmed identity', es: 'invitados anteriores con identidad confirmada' },
  'sig.podcast': { en: 'the show itself as a Qloo entity', es: 'el propio programa como entidad de Qloo' },
  'sig.tags': { en: 'theme tags', es: 'etiquetas temáticas' },
  'sig.podcastTags': { en: 'the show entity plus theme tags', es: 'la entidad del programa más etiquetas temáticas' },
  'sig.none': { en: 'no reliable signal', es: 'sin señal confiable' },
  'card.qlooVerified': { en: 'Proposed by Qloo (#{n}) · verified', es: 'Propuesto por Qloo (n.º {n}) · verificado' },
  'tech.assessment': { en: 'Three separate readings', es: 'Tres lecturas separadas' },
  'tech.a.qloo': { en: 'Qloo affinity', es: 'Afinidad Qloo' },
  'tech.a.qlooProposed': { en: 'proposed by Qloo (#{n})', es: 'propuesto por Qloo (n.º {n})' },
  'tech.a.qlooNot': { en: 'not proposed by Qloo', es: 'no propuesto por Qloo' },
  'tech.a.affinity': { en: 'affinity {v}/100', es: 'afinidad {v}/100' },
  'tech.a.editorial': { en: 'Editorial relevance', es: 'Relevancia editorial' },
  'tech.a.evidence': { en: 'Evidence quality', es: 'Calidad de la evidencia' },
  'tech.a.level.high': { en: 'high', es: 'alta' },
  'tech.a.level.medium': { en: 'medium', es: 'media' },
  'tech.a.level.low': { en: 'low', es: 'baja' },
  'tech.a.evidenceDetail': { en: '{n} interviews on {s} shows', es: '{n} entrevistas en {s} programas' },
  'tech.a.automatic': { en: 'names extracted automatically', es: 'nombres extraídos automáticamente' },
  'disc.popularity': { en: 'popularity {p}/100', es: 'popularidad {p}/100' },
  'card.noSpecialty': { en: 'Profile not verified · guest on comparable podcasts', es: 'Perfil no verificado · invitado en podcasts comparables' },
  'card.evidence': { en: 'View evidence', es: 'Ver evidencias' },
  'card.hideEvidence': { en: 'Hide evidence', es: 'Ocultar evidencias' },
  'card.invite': { en: 'Prepare invitation', es: 'Preparar invitación' },
  'card.technical': { en: 'Technical details and provenance', es: 'Detalles técnicos y procedencia' },
  'card.mockNote': { en: 'Includes SIMULATED Qloo values (weight 0).', es: 'Incluye valores de Qloo SIMULADOS (peso 0).' },
  'ev.who': { en: 'Who they are', es: 'Quién es' },
  'ev.wikiSource': { en: 'Wikipedia', es: 'Wikipedia' },
  'ev.identity': { en: 'Identity check: Wikipedia text matches their interview titles on', es: 'Control de identidad: el texto de Wikipedia coincide con sus títulos de entrevista en' },
  'ev.topics': { en: 'Suggested interview topics', es: 'Temas sugeridos para la entrevista' },
  'ev.topicsNote': { en: 'From their previous interview titles (original language) and shared themes.', es: 'A partir de los títulos de sus entrevistas anteriores (idioma original) y los temas compartidos.' },
  'ev.appearances': { en: 'Verified appearances', es: 'Apariciones verificadas' },
  'ev.noAppearances': { en: 'No verified appearance; evidence is Qloo affinity only.', es: 'Sin apariciones verificadas; la evidencia es solo la afinidad de Qloo.' },
  'ev.photo': { en: 'Photo', es: 'Foto' },
  'ev.noPhoto': { en: 'No free-licensed photo verified for this person; showing initials.', es: 'No hay una foto con licencia libre verificada para esta persona; se muestran las iniciales.' },
  'tech.components': { en: 'Score components', es: 'Componentes del puntaje' },
  'tech.weight': { en: 'weight', es: 'peso' },
  'tech.rationale': { en: 'Agent rationale', es: 'Razonamiento del agente' },
  'tech.topicalFit': { en: 'Topical fit', es: 'Ajuste temático' },
  'tech.qloo': { en: 'Qloo affinity', es: 'Afinidad Qloo' },
  'tech.momentum': { en: 'Momentum', es: 'Momento' },
  'tech.recency': { en: 'Recency', es: 'Recencia' },
  'tech.qlooEntity': { en: 'Qloo entity', es: 'Entidad Qloo' },
  'comp.themeFit': { en: 'Cosine similarity between the themes of their appearance titles and this show’s themes.', es: 'Similitud entre los temas de los títulos de sus apariciones y los temas de este programa.' },
  'comp.momentum': { en: 'Number of verified appearances on comparison shows in the last 24 months.', es: 'Cantidad de apariciones verificadas en programas de comparación en los últimos 24 meses.' },
  'comp.recency': { en: 'How recently they were last interviewed on a comparison show.', es: 'Qué tan reciente fue su última entrevista en un programa de comparación.' },
  'comp.qlooMock': { en: 'SIMULATED value shown to test the interface; weight 0, it does not affect the ranking.', es: 'Valor SIMULADO para probar la interfaz; peso 0, no afecta el ranking.' },
  'comp.qlooLive': { en: 'Affinity of this person to the show’s past guests in Qloo’s taste graph (rank within shortlist).', es: 'Afinidad de esta persona con los invitados anteriores en el grafo de gustos de Qloo (posición en la lista corta).' },
  'comp.qlooOff': { en: 'Not used in this run.', es: 'No se usó en esta ejecución.' },
  'proposal.kicker': { en: 'Interview proposal · draft', es: 'Propuesta de entrevista · borrador' },
  'proposal.basedOn': { en: 'Built only from:', es: 'Construida solo a partir de:' },
  'proposal.copy': { en: 'Copy draft', es: 'Copiar borrador' },
  'proposal.copied': { en: 'Copied', es: 'Copiado' },
  'common.close': { en: 'Close', es: 'Cerrar' },
  'bt.title': { en: 'Would Green Room have seen it coming?', es: '¿Green Room lo habría anticipado?' },
  'bt.intro': {
    en: 'We hide everything published after a cutoff date, let the agent recommend using only earlier data, and then check which recommended people really became first-time guests in the next 24 months. A hit means the host later booked that person. It measures agreement with real booking decisions, not audience impact.',
    es: 'Ocultamos todo lo publicado después de una fecha de corte, dejamos que el agente recomiende solo con datos anteriores y luego verificamos qué personas recomendadas fueron realmente invitadas por primera vez en los 24 meses siguientes. Un acierto significa que el conductor después invitó a esa persona. Mide coincidencia con decisiones reales, no impacto en la audiencia.',
  },
  'bt.show': { en: 'Show', es: 'Programa' },
  'bt.cutoff': { en: 'Cutoff', es: 'Corte' },
  'bt.run': { en: 'Run backtest', es: 'Ejecutar prueba' },
  'bt.running': { en: 'Running…', es: 'Ejecutando…' },
  'bt.history': { en: 'history before {date} ({n} episodes)', es: 'historial previo al {date} ({n} episodios)' },
  'bt.until': { en: 'evaluated until {date}', es: 'evaluado hasta el {date}' },
  'bt.leakOk': { en: 'Leakage audit passed', es: 'Auditoría de filtración superada' },
  'bt.leakFail': { en: 'Leakage audit FAILED', es: 'Auditoría de filtración FALLIDA' },
  'bt.method': { en: 'Method', es: 'Método' },
  'bt.hits': { en: 'Hits', es: 'Aciertos' },
  'bt.random': { en: 'Random pick from the same pool (expected)', es: 'Elección al azar del mismo grupo (esperado)' },
  'bt.notEvidence': { en: 'Simulated Qloo input: this row tests the pipeline and is not a result.', es: 'Entrada de Qloo simulada: esta fila prueba el circuito y no es un resultado.' },
  'bt.hitsTitle': { en: 'Hits (recommended before the cutoff, booked after it)', es: 'Aciertos (recomendados antes del corte, invitados después)' },
  'bt.booked': { en: 'booked', es: 'invitado el' },
  'bt.noHits': { en: 'No hits in the top 25. We show this as-is.', es: 'Sin aciertos entre los primeros 25. Lo mostramos tal cual.' },
  'bt.truth': { en: 'Ground truth', es: 'Datos reales' },
  'bt.truthText': {
    en: '{hidden} first-time guests were booked after the cutoff. Only {reachable} of them had a verified appearance on a comparison show before it, so {reachable} is the most any method could find here.',
    es: 'Después del corte se invitó a {hidden} personas por primera vez. Solo {reachable} de ellas tenían una aparición verificada en un programa de comparación antes del corte, así que {reachable} es lo máximo que cualquier método podría encontrar aquí.',
  },
  'bt.reachable': { en: 'Reachable', es: 'Alcanzables' },
  'bt.pool': { en: 'Candidate pool at cutoff: {n} people.', es: 'Grupo de candidatos al corte: {n} personas.' },
  'bt.limitations': { en: 'Limitations', es: 'Limitaciones' },
  'm.read': { en: 'How to read this demo', es: 'Cómo leer esta demo' },
  'm.mode': { en: 'Current mode', es: 'Modo actual' },
  'm.modeMock': {
    en: 'The Qloo hackathon key has not been configured yet, so every Qloo value is simulated, labeled MOCK and excluded from rankings and claims.',
    es: 'La clave de Qloo del hackathon todavía no está configurada: todo valor de Qloo es simulado, está marcado como MOCK y queda fuera del ranking y de toda afirmación.',
  },
  'm.modeLive': { en: 'Qloo values come from the live hackathon API.', es: 'Los valores de Qloo provienen de la API real del hackathon.' },
  'm.adds': { en: 'What Qloo adds (live mode)', es: 'Qué aporta Qloo (modo real)' },
  'm.adds1': { en: 'Resolves past guests to Qloo person entities (/search).', es: 'Ubica a los invitados anteriores como personas en Qloo (/search).' },
  'm.adds2': {
    en: 'Uses them as the audience’s taste signal to find people with affinity (/v2/insights, person type, excluding past guests).',
    es: 'Los usa como señal del gusto de la audiencia para encontrar personas afines (/v2/insights, tipo persona, excluyendo invitados anteriores).',
  },
  'm.adds3': { en: 'Scores candidates against that signal and maps cross-domain taste: artists, films, books.', es: 'Puntúa candidatos contra esa señal y mapea gustos en otros dominios: artistas, películas, libros.' },
  'm.sources': { en: 'Data sources', es: 'Fuentes de datos' },
  'm.feed': { en: 'Feed', es: 'Feed' },
  'm.snapshot': { en: 'Snapshot: {date}. Only titles, dates, links and extracted guest names are stored.', es: 'Captura: {date}. Solo se guardan títulos, fechas, enlaces y nombres de invitados extraídos.' },
  'm.photos': { en: 'Guest photos and bios', es: 'Fotos y biografías de invitados' },
  'm.photosText': {
    en: 'Photos come from Wikimedia Commons with free licenses (CC BY, CC BY-SA, CC0, public domain); author and license are shown on each card. Short descriptions come from Wikidata (CC0) and quotes from Wikipedia (CC BY-SA) with a link. A profile is attached only if the Wikipedia text matches the person’s own interview titles; otherwise we show initials.',
    es: 'Las fotos provienen de Wikimedia Commons con licencias libres (CC BY, CC BY-SA, CC0, dominio público); cada tarjeta muestra autor y licencia. Las descripciones breves vienen de Wikidata (CC0) y las citas de Wikipedia (CC BY-SA) con enlace. Un perfil se asocia solo si el texto de Wikipedia coincide con los títulos de las entrevistas de esa persona; si no, mostramos las iniciales.',
  },
  'm.noAudience': {
    en: 'Green Room does not know who listens to these shows. It never claims audience data; Qloo’s affinities describe taste patterns, not a show’s listeners.',
    es: 'Green Room no sabe quién escucha estos programas. Nunca afirma tener datos de audiencia; las afinidades de Qloo describen patrones de gusto, no a los oyentes de un programa.',
  },
  'prov.VERIFIED': { en: 'Read directly from the show’s public RSS feed (title, date, link).', es: 'Leído directamente del RSS público del programa (título, fecha, enlace).' },
  'prov.INFERRED': { en: 'Derived by Green Room’s own transparent rules from verified data.', es: 'Derivado por reglas propias y transparentes de Green Room a partir de datos verificados.' },
  'prov.MOCK': { en: 'Simulated stand-in for Qloo while we wait for the API key. Not evidence.', es: 'Sustituto simulado de Qloo mientras esperamos la clave de API. No es evidencia.' },
  'prov.LIVE': { en: 'Returned by the real Qloo hackathon API.', es: 'Devuelto por la API real de Qloo del hackathon.' },
} as const;

export type StringKey = keyof typeof STRINGS;

export function translate(lang: Lang, key: StringKey, params: Record<string, string | number> = {}): string {
  let s: string = STRINGS[key][lang];
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // storage unavailable: fall back to the default
  }
  return 'es';
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'es', setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const { lang, setLang } = useContext(Ctx);
  return { lang, setLang, t: (key: StringKey, params?: Record<string, string | number>) => translate(lang, key, params) };
}

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div role="group" aria-label={t('lang.label')} className="inline-flex rounded-full border border-white/15 p-0.5 text-xs font-semibold">
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`rounded-full px-3 py-1 transition ${lang === l ? 'bg-brass-400 text-stage-950' : 'text-stone-300 hover:bg-white/5'}`}
        >
          {l === 'es' ? 'Español' : 'English'}
        </button>
      ))}
    </div>
  );
}
