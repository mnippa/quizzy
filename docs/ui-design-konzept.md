# Quizzy UI Design-Konzept (One-Source-of-Truth)

Dieses Dokument definiert ein einheitliches, modernes Designkonzept fuer Quizzy.
Ziel ist ein konsistentes Erscheinungsbild ueber alle Seiten, mit klar getrennten Optimierungen fuer:

- Spieler (Mobile-first + separater Desktop-Modus)
- Spielleiter (Desktop-first, Mobile nur Legacy)
- Beamer/Praesentation (Large Screen, hohe Lesbarkeit)

## 1. Designziele

- Ein visueller Stil fuer das gesamte Produkt (kein Seitenmix).
- Klare Informationshierarchie pro Rolle.
- Schnelle Orientierung in Live-Situationen.
- Hoher Kontrast, grosse Interaktionsflaechen, gut lesbare Typografie.
- Komponentenbasierter Aufbau fuer einfache Weiterentwicklung.

## 2. Produktlinien pro Rolle

- Spieler-Mobile:
  - Primar fuer Handy optimiert.
  - Thumb-friendly Bedienung, grosse Antwortflaechen, reduzierter Fokus.
- Spieler-Desktop:
  - Kein bloesses Skalieren der Mobile-Ansicht.
  - Eigenes zweispaltiges Layout mit mehr Kontext (Frage, Timer, Verlauf).
- Spielleiter-Desktop:
  - Kontrollzentrum mit hoher Informationsdichte.
  - Multi-Panel Layout fuer Steuerung, Teilnehmer, Ergebnisse, Freitext-Review.
- Spielleiter-Mobile (Legacy):
  - Funktionsfaehig, aber nicht primar optimiert.
- Beamer:
  - Maximal klare Typografie, wenige Informationen gleichzeitig, starke visuelle Fuehrung.

## 3. Visuelle Richtung

- Look and Feel:
  - Klar, modern, lebendig, didaktisch-professionell.
  - Helle Grundflaechen mit markanten Akzentfarben fuer Status und Aktionen.
- Stilmittel:
  - Weiche Karten, klare Kantenradii, dezente Schatten, ruhige Hintergruende.
  - Statusfarben konsequent pro Phase (Offen, Frage, Antwort, Ergebnis, Ende).
- Motion:
  - Subtile Transitionen fuer Phasenwechsel und Reveal von Ergebnis-Views.
  - Keine unruhigen Daueranimationen waehrend aktiver Frage.

## 4. Design Tokens (zentral)

Alle visuellen Entscheidungen laufen ueber zentrale Tokens in CSS-Variablen.

- Farbe:
  - --color-bg
  - --color-surface
  - --color-surface-strong
  - --color-text
  - --color-muted
  - --color-primary
  - --color-success
  - --color-warning
  - --color-danger
  - --state-open
  - --state-question
  - --state-answer
  - --state-result
  - --state-finished
- Typografie:
  - --font-ui
  - --font-display
  - --font-mono
  - --text-xs, --text-sm, --text-md, --text-lg, --text-xl, --text-2xl
- Spacing:
  - --space-1 bis --space-10
- Radius:
  - --radius-sm, --radius-md, --radius-lg, --radius-xl
- Shadow:
  - --shadow-sm, --shadow-md, --shadow-lg
- Z-Index:
  - --z-base, --z-sticky, --z-modal, --z-toast

## 5. Breakpoint-Strategie (nicht nur responsive strecken)

- Spieler:
  - mobile: 360-767 (primar)
  - desktop: 1024+ (eigene Komposition)
- Spielleiter:
  - desktop: 1200+ (primar)
  - tablet: 900-1199 (komprimiert)
  - mobile: bis 899 (Legacy-Fallback)
- Beamer:
  - 1280+ optimiert, typografische Skalierung bis 4K

## 6. Komponentenbibliothek (einmal bauen, ueberall nutzen)

- AppShell (Header, Main, Sidepanel, Footer optional)
- Card, Panel, Stack, Grid
- Button (primary, secondary, ghost, danger)
- Input, Select, Textarea, Toggle, Tabs
- StatusPill (state-basiert)
- TimerBar + CountdownBadge
- QuestionCard
- AnswerOption (single, multi, true/false, text)
- RankingList (Top10, Full)
- EmptyState, LoadingState, ErrorState
- Toast, ConfirmDialog

## 7. Seiten-Blueprints

## 7.1 Einstieg

- Gemeinsame Startseite bleibt.
- Spieler-Kachel: PIN + Nickname.
- Spielleiter-Kachel: Dashboard/Login Entry.
- Stilgleich mit restlichem Produkt.

## 7.2 Spieler Lobby/Fragetext/Antwortmoeglichkeiten/Antwort/Ergebnis

- Mobile:
  - Fokus: eine Hauptaktion pro Sicht.
  - Fragetext und optionales Bild werden zuerst ohne Antwortoptionen gezeigt.
  - Danach werden die noch gesperrten Antwortoptionen eingeblendet.
  - Erst in der Antwortphase sind Eingaben moeglich und ein optionaler Timer sichtbar.
  - Antwortbuttons vollbreit, klar getrennt.
- Desktop:
  - Zweispaltig: links Frage+Antwort, rechts Status+Zwischenstand.
- Ergebnis/Idle:
  - Eigene Tabs: Richtige Antwort, Top10+Ich, Gesamtranking.

## 7.3 Spielleiter Kontrollzentrum

- Desktop Multi-Panel:
  - links: Phasensteuerung und aktueller Ablauf
  - mitte: aktuelle Frage, Vorschau naechste Frage
  - rechts: Teilnehmer, Antwortfortschritt, Review Queue
  - unten: Ranking/Statistik
- Immer sichtbare kritische Aktionen:
  - Start, Antwortmoeglichkeiten zeigen, Antwortphase starten/beenden, Naechste Frage, Session schliessen
  - Im ersten Testmodus schaltet der Spielleiter jede Phase manuell und ohne automatische Dauer weiter.
  - Spaetere Timer koennen jederzeit manuell uebersprungen werden.

## 7.4 Admin-Backend (Stammdatenpflege)

- Quizliste:
  - klare Karten mit Status und Aktionen
  - Filter/Sortierung
- Quiz-Editor stark verbessern:
  - Linke Spalte: Inhaltsverzeichnis aller Fragen
  - Rechte Hauptflaeche: Frage fuer Frage bearbeiten
  - Tabs pro Frage, z. B.:
    - Basis
    - Antwortoptionen
    - Punkte & Timing
    - Erweiterte Regeln
    - Medien
  - Autosave-Hinweis + dirty-state Anzeige

## 7.5 Beamer

- Sehr grosse Typografie
- Pro Phase nur Kerninfos
- Ergebnis-Ansichten vom Spielleiter steuerbar

## 8. Konsistenzregeln (gegen Design-Drift)

- Neue Seite nur auf Basis bestehender Komponenten.
- Keine ad-hoc Farben/Abstaende/Schriften ausserhalb Tokens.
- Ein zentrales Pattern fuer Buttons, Inputs, Karten, Status.
- Jede neue Maske braucht vor Umsetzung eine kurze UI-Skizze gegen dieses Dokument.

## 9. Umsetzungsreihenfolge

1. Designsystem-Fundament in CSS anlegen (Tokens, Basis, Komponenten).
2. Einstieg + Dashboard auf neues System migrieren.
3. Spieler-Mobile End-to-End fertigstellen.
4. Spieler-Desktop als eigene Komposition ausbauen.
5. Spielleiter-Kontrollzentrum Desktop-first ueberarbeiten.
6. Admin-Quiz-Editor mit Frageverzeichnis + Tabs neu strukturieren.
7. Beamer-Ansichten angleichen.
8. Abschluss: UI-Polish, Accessibility, visuelle Regressionstests.

## 10. Definition of Done (UI)

- Alle Hauptseiten nutzen dieselben Tokens und Komponenten.
- Spieler-Mobile ist eigenstaendig optimiert, nicht nur skaliert.
- Spieler-Desktop hat eigene Layoutlogik.
- Spielleiter-Desktop ist klar priorisiert.
- Admin-Editor bietet Frage-fuer-Frage Workflow mit linker Uebersicht und Tabs.
- Keine sichtbaren Stilbrueche zwischen Seiten.

## 11. Technische Leitplanken fuer die Umsetzung

- Bestehende Seiten schrittweise migrieren, keine Big-Bang-Neuschreibung.
- Bestehende IDs/Hooks fuer JS moeglichst stabil halten.
- Nur dort neue Wrapper einfuehren, wo semantisch sinnvoll.
- Nach jedem Schritt:
  - PHP-Syntaxcheck
  - Basis-Flow checken (Login, Join, Start, Frage, Ergebnis)

## 12. Nächster konkreter Sprint (empfohlen)

- Sprintziel: Visuelles Fundament + erste konsistente Seiten.
- Enthalten:
  - Token-Datei und Basiskomponenten in CSS
  - Startseite und Dashboard migrieren
  - Erste Version Quiz-Editor-Layout mit linker Fragenliste + Tabs (Basis/Advanced)
- Ergebnis:
  - Sofort sichtbarer "ein Guss"-Effekt
  - Solide Basis fuer alle weiteren Masken
