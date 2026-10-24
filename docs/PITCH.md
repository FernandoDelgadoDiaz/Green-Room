# Live final pitch (Nov 5): 2 minutes + Q&A

## When and how (from the official rules and the Devpost page)
- **Submission deadline:** Oct 30, 2026, 11:45 pm ET (Oct 31, 00:45 in Argentina). Nothing is presented before that; Devpost entries are judged on what is submitted.
- **Judging:** Nov 2, 12:00 pm ET → Nov 5, 11:45 pm ET. Judges open the app and the Devpost page on their own.
- **Finalists:** the **top 3** are notified "very soon after the hackathon closes". They must be able to appear and be **available for preparation before the appearance**. The format details come with that notice.
- **The final, Nov 5:** the 3 finalists "appear **on air** with **Jason Calacanis, Cedric the Entertainer and Alex Elias**, who will pick the winner". Each one presents the idea, answers questions and learns the result in real time. Winners are announced on or around **Nov 5, 3:00 pm ET (17:00 in Argentina)**.
- **Not stated anywhere:** the exact time slot, how long each finalist speaks, or whether it is remote. Prepare a 2-minute and a 30-second version, and confirm everything when notified.

The audience is three people: Jason Calacanis (podcaster and investor, host of This Week in Startups), Cedric the Entertainer (comedian and host, Qloo backer) and Alex Elias (Qloo's CEO). Keep the app open on This Week in Startups before you start.

## The 2-minute pitch (English)

**0:00 · Hook (15 s)**
> "Every podcast lives or dies by its guests, and most shows book them the same way: from memory, from their own circle, from whoever's famous this week. Green Room is an agent that books guests on evidence and on taste."

**0:15 · Live demo (55 s)**: open https://greenroom1.netlify.app/?lang=en&show=this-week-in-startups
> "Jason, this is your show. Green Room read its real episode history and learned who you actually interview: founders, investors, operators, mostly American.
> These five people have never been on This Week in Startups. Every one has real interviews on comparable shows, with links, and each card explains why, in a sentence written from that evidence.
> This is where Qloo comes in. Qloo tells us who your audience is — here, by age and gender — and how strongly that audience has affinity for each guest. Qloo's affinity also changed the order of this list, and Qloo proposed people from outside your world; each one had to pass the same checks before it could get in."

Point at: the five portraits → a card's green "Qloo on this guest's audience" strip → "Who this show's audience is" chart.

**1:10 · Why only Qloo (20 s)**
> "Your RSS feed tells you who you booked. Only Qloo tells you what your audience likes. Without Qloo, Green Room can list credible people. With Qloo, it can tell a producer whose audience is theirs and who their audience is."

**1:30 · What we learned, and the close (30 s)**
> "One more thing. Green Room measures how well Qloo knows each market as it works. In the US and the UK, Qloo read every show's audience we tested. For Argentine shows it recognized one guest in fifty, and the app says so instead of guessing. Spanish-language podcasting is where we'd like to build next, with you.
> Producers, agencies and networks get a defensible shortlist in seconds instead of a week of research. Qloo finds the taste, Green Room checks the evidence, the producer decides."

Update the numbers in the closing before the final: they come from "Data & method → How well Qloo knows each market", which grows with every live analysis.

## The 30-second version (English)
> "Green Room is an agent that books podcast guests on evidence and on taste. It reads a show's real episode history, finds people with a verifiable interview record who've never been on, and uses Qloo to show who the show's audience is and how much it likes each guest. Jason, here are five people for This Week in Startups, each with the evidence and a draft invitation. And it's honest about where Qloo is strong and where it isn't yet: that's our next market, with you."

## El pitch de 2 minutos (español, para ensayar)

**0:00 · Gancho (15 s)**
> "Un podcast vive o muere por sus invitados, y la mayoría de los programas los elige igual: de memoria, de su propio círculo, o por quién es famoso esta semana. Green Room es un agente que elige invitados con evidencia y con gusto."

**0:15 · Demo en vivo (55 s)**: abrir This Week in Startups.
> "Jason, este es tu programa. Green Room leyó el historial real de episodios y aprendió a quién entrevistás de verdad: fundadores, inversores, operadores, mayormente estadounidenses.
> Estas cinco personas nunca estuvieron en This Week in Startups. Todas tienen entrevistas reales en programas comparables, con enlaces, y cada tarjeta explica por qué en una frase escrita a partir de esa evidencia.
> Acá entra Qloo. Qloo nos dice quién es tu audiencia, por edad y género, y cuánta afinidad tiene esa audiencia con cada invitado. La afinidad de Qloo también cambió el orden de esta lista, y Qloo propuso gente de fuera de tu mundo; cada una tuvo que pasar los mismos controles para poder entrar."

**1:10 · Por qué solo con Qloo (20 s)**
> "Tu feed te dice a quién invitaste. Solo Qloo te dice qué le gusta a tu audiencia. Sin Qloo, Green Room puede listar gente creíble. Con Qloo, le puede decir a un productor qué invitado tiene un público como el suyo y quién es su audiencia."

**1:30 · Lo que aprendimos y cierre (30 s)**
> "Una cosa más. Green Room mide, mientras trabaja, qué tan bien conoce Qloo cada mercado. En Estados Unidos y el Reino Unido, Qloo leyó la audiencia de todos los programas que probamos. En programas argentinos reconoció a uno de cada cincuenta invitados, y la app lo dice en vez de adivinar. El podcast en español es donde queremos crecer, junto con ustedes.
> Productores, agencias y cadenas obtienen una lista defendible en segundos en vez de una semana de investigación. Qloo encuentra el gusto, Green Room verifica la evidencia y el productor decide."

## Likely questions, short answers

**"How do you make money?"**
A subscription for producers and networks: per show, with weekly shortlists and invitation drafts. Agencies and networks pay per seat. Later: a booking marketplace where guests' teams see shows whose audiences match them.

**"Isn't this just ChatGPT?"**
No language model ranks anyone. A rule-based agent works from public evidence (RSS interview history, Wikidata identity and country) and from Qloo's taste graph, and every step says why it ran. An LLM can't tell you whose audience overlaps yours; Qloo can.

**"Does Qloo actually change the picks?"**
Qloo affinity reorders comparable candidates, and Qloo proposes people the show's history never had, which must pass the same checks; on the US shows we ran live, Qloo's affinity changed the top five. We were careful: in historical backtests, Qloo didn't raise hit rates, so we don't claim better predictions. What Qloo adds is the audience read: who the show's audience is by age and gender, and how much affinity it has for each guest.

**"How do you know who the audience is?"**
We don't, and we say so. Qloo gives aggregate taste and demographic affinity for the show's signals. It's inferred, never listener data, and it's labeled that way.

**"Why does it work less well in Latin America?"** (likely from Alex Elias)
Because Qloo's graph knows fewer Spanish-language shows and guests today; we measured it, and it's on the "Data & method" page. Green Room still recommends from the show's real history there, and tells the producer Qloo had little to say. Thoughtful framing: it's a map of where Qloo can grow, not a complaint.

**"What about people who aren't famous?"**
Identity is confirmed with context, never by name alone. Every guest must have a verifiable record, and nobody deceased, nobody already on the show, and never the host.

**"What's next?"**
Spotify and YouTube shows, which are most of Latin American podcasting. Outreach drafts in the producer's voice. Alerts when a matching guest starts trending on Qloo.

**"Who built it?"**
Fernando Delgado, from Argentina. Say one line about yourself and why podcasts.

## Practical
- Test camera, mic and the app's URL the day before; have https://greenroom1.netlify.app/?lang=en&show=this-week-in-startups open (the five portraits load first), https://greenroom1.netlify.app/?lang=en&show=all-in in a second tab, and "Data & method" in a third.
- If anything fails live, switch to the screenshots uploaded to Devpost (kept out of the repo: they show Qloo results).
- Under 2 minutes: rehearse with a timer. Calacanis interrupts. Answer in one sentence, then go back to the demo.
