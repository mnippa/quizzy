# Quizzy - Autonome Arbeitspakete

Stand: 2026-09-30

Grundlagen:

- `docs/analyse-soll-ist-2026-09-30.md`
- `docs/konkreter-umsetzungsplan-2026-09-30.md`
- `docs/projektfortschritt.md`

## 1. Arbeitsvereinbarung

Diese Pakete sind so geschnitten, dass sie ohne fachliche Rueckfrage nacheinander umgesetzt, getestet und dokumentiert werden koennen.

Fuer jedes Paket gilt:

1. Vor Beginn wird der aktuelle Git-Status gelesen. Fremde Aenderungen werden nicht verworfen.
2. Es wird nur der angegebene Scope bearbeitet.
3. Zuerst wird ein fehlschlagender oder diskriminierender Test hergestellt.
4. Danach erfolgt die kleinste fachlich vollstaendige Umsetzung.
5. Nach der ersten Aenderung wird sofort der engste Test ausgefuehrt.
6. Abschliessend folgen Gesamttests, Diagnostik und der angegebene Browserlauf.
7. Ergebnis, Testnachweis und offene Risiken werden in `docs/projektfortschritt.md` eingetragen.
8. Ein Paket gilt nur bei erfuellter Definition of Done als abgeschlossen.

Die Bearbeitung stoppt nur bei:

- notwendiger Entscheidung mit erheblicher Auswirkung auf Datenverlust, Datenschutz oder Produktverhalten
- fehlenden Zugangsdaten beziehungsweise nicht verfuegbarer externer Infrastruktur
- nicht aufloesbarem Konflikt mit parallel veraenderten Dateien
- reproduzierbarem Defekt ausserhalb des Pakets, der die Abnahme objektiv verhindert

Normale Testfehler, Schemaanpassungen, lokale Portkonflikte und Implementierungsdetails sind keine Unterbrechungsgruende.

## 2. Standard-Abnahme je Paket

- betroffene Unit- und Integrationstests gruen
- gesamter Node-Testlauf gruen oder bekannte, eindeutig paketfremde Abweichung dokumentiert
- PHP-Syntaxcheck gruen, sofern PHP betroffen ist
- VS-Code-Diagnostik ohne neue Fehler
- Browser-Gegentest mit den betroffenen Rollen
- Negativtest fuer ungueltige oder unerlaubte Aktion
- Reconnect-Test, falls Sessionzustand oder WebSocket-Payload betroffen ist
- keine Loesungsdaten vor der Ergebnisphase
- Fortschrittsjournal aktualisiert

## 3. Ausfuehrungsreihenfolge

| ID | Arbeitspaket | Prioritaet | Abhaengigkeit | Zielstatus |
|---|---|---:|---|---|
| AP-00 | Test-Harness und isolierte Testdaten | P0 | keine | bereit |
| AP-01 | Strikte Session- und PIN-Integritaet | P0 | AP-00 | geplant |
| AP-02 | Host-Token und WebSocket-Autorisierung | P0 | AP-01 | geplant |
| AP-03 | Kanonisches Antwort- und Ergebnisfundament | P0 | AP-02 | geplant |
| AP-04 | Idempotente Freitextbewertung mit Teilpunkten | P0/P1 | AP-03 | geplant |
| AP-05 | Fragetyp-Registry und Validierungsvertrag | P1 | AP-03 | geplant |
| AP-06 | Admin-Editor fuer vier Basistypen | P1 | AP-05 | geplant |
| AP-07 | Fragebilder und Bildantworten | P1 | AP-06 | geplant |
| AP-08 | Persistenter Startzustand | P1 | AP-03 | geplant |
| AP-09 | Ergebnisregie und Beamersteuerung | P1 | AP-04, AP-08 | geplant |
| AP-10 | Reconnect- und Neustart-Snapshots | P1 | AP-09 | geplant |
| AP-11 | Konfigurierbare Automatik | P1 | AP-10 | geplant |
| AP-12 | Debian, Reverse Proxy und WSS | P1 | AP-02, AP-10 | geplant |
| AP-13 | UI-, Accessibility- und Regression-Abschluss | P2 | AP-07 bis AP-12 | geplant |

## AP-00 - Test-Harness und isolierte Testdaten

### Ergebnis

Ein wiederholbarer Testlauf, der keinen laufenden Produktivserver, keine bestehende Session und keine IPv4-/IPv6-Namensaufloesung voraussetzt.

### Umsetzung

- `server.js` importierbar machen, ohne beim Import automatisch einen Server zu starten
- explizite Startoptionen fuer Host und Port erlauben
- Testbetrieb fest an `127.0.0.1` und einen freien beziehungsweise reservierten Testport binden
- Test-Fixtures fuer Quiz, Fragen und Session anlegen
- Cleanup fuer alle erzeugten Sessiondaten implementieren
- Workflowtest auf vorhandene Session statt Sessionerzeugung per Join umstellen
- `npm test` auf alle Tests erweitern

### Dateien

- `realtime-node/server.js`
- `realtime-node/config.js`
- `realtime-node/package.json`
- `realtime-node/tests/workflow.test.js`
- neue Hilfen unter `realtime-node/tests/helpers/`

### Gegentests

- Testlauf bei bereits belegtem Live-Port
- zwei direkt aufeinanderfolgende Testlaeufe
- Testlauf ohne bestehende Sessiondaten
- Nachweis, dass keine Test-PIN nach Abschluss verbleibt

### Definition of Done

- `npm test` startet und beendet alle Server selbst
- keine `EADDRINUSE`-, `ECONNREFUSED`- oder offenen Handle-Fehler
- Testdaten sind vom Live-Bestand isoliert

## AP-01 - Strikte Session- und PIN-Integritaet

### Ergebnis

Nur ueber den authentifizierten PHP-Flow erzeugte Sessions koennen betreten werden. Ein Join erzeugt niemals implizit eine Session.

### Umsetzung

- PIN-Format zentral validieren
- unbekannte und geschlossene Session fuer Player, Host und Display ablehnen
- Rollenattribute erst nach erfolgreichem Join an `ws` setzen
- Demo-Fallback aus dem Produktivpfad entfernen
- Reconnect nur mit gueltiger Session und passendem Player-Token
- PHP-PIN-Erzeugung mit Kollisionswiederholung und Transaktion absichern
- Frontend beendet automatische Reconnect-Schleife bei fachlich ungueltiger PIN

### Dateien

- `realtime-node/lobby.js`
- `realtime-node/server.js`
- `realtime-node/utils.js`
- `public/admin/quizzes.php`
- `public/js/app.js`

### Gegentests

- unbekannte sechsstellige PIN
- syntaktisch ungueltige PIN
- geschlossene Session
- Player-, Host- und Display-Join gegen ungueltige PIN
- erzwungene PIN-Kollision beim Oeffnen
- gueltiger Player-Reconnect

### Definition of Done

- keine In-Memory-Session ohne Datenbankdatensatz
- strukturierter Fehler und stabiler Fehlerzustand im Browser
- Workflow und Negativtests gruen

## AP-02 - Host-Token und WebSocket-Autorisierung

### Ergebnis

Nur der ueber PHP authentifizierte Spielleiter kann mutierende Host-Ereignisse senden.

### Umsetzung

- zufaelliges, sessionspezifisches Host-Token beim Oeffnen erzeugen
- nur Token-Hash in der Datenbank speichern
- Klartext-Token in PHP-Session halten
- Host-Join und jede Hostaktion zentral validieren
- Token bei neuer Runde rotieren und beim Schliessen ungueltig machen
- Token niemals in Logs, URL oder Fehlermeldungen ausgeben

### Dateien

- `realtime-node/db.js`
- `realtime-node/server.js`
- `realtime-node/lobby.js`
- `realtime-node/quiz.js`
- `public/admin/quizzes.php`
- `public/host_control.php`
- `public/js/app.js`

### Gegentests

- gueltiges, fehlendes, falsches und fremdes Token
- Spieler sendet `role: host`
- Display sendet Kick-, Phasen- und Review-Event
- Host-Reload mit gueltiger PHP-Session
- Suche in Logs nach Tokenwert

### Definition of Done

- alle mutierenden Hostevents laufen durch dieselbe Autorisierung
- gefaelschter Client kann keinen Sessionzustand veraendern
- legitimer Host bleibt reconnect-faehig

## AP-03 - Kanonisches Antwort- und Ergebnisfundament

### Ergebnis

`session_answers` ist die eindeutige Quelle fuer Antwort, Zeit, Korrektheit und Punkte je Spieler und Frage.

### Umsetzung

- persistente Spieler-ID beziehungsweise Player-Token als einzige Zuordnung verwenden
- Ergebnisaggregation aus gespeicherten Antworten ableiten
- `answered_questions` nur bei erster Abgabe erhoehen
- doppelte Abgabe idempotent behandeln
- Transaktionen fuer Antwort, Spielerstand und Ergebnis einsetzen
- Konsistenzpruefung und Reparaturfunktion fuer bestehende Testdaten vorsehen

### Gegentests

- doppelte und parallele Abgabe
- Reconnect vor und nach Abgabe
- Node-Neustart nach persistierter Antwort
- Vergleich Einzelantworten gegen Rankingaggregation

### Definition of Done

- `session_answers`, `session_players` und `session_results` stimmen ueberein
- Antwortzeit bleibt millisekundengenau
- keine doppelte Antwort- oder Fragenzaehlung

## AP-04 - Idempotente Freitextbewertung mit Teilpunkten

### Ergebnis

Freitext kann mit `0..points_max`, Kommentar und spaeterer Korrektur bewertet werden.

### Umsetzung

- Reviewstatus, Punkte, Kommentar, Bewerter und Zeitpunkt persistieren
- Richtig/Falsch als Schnellwahl fuer Maximum beziehungsweise Null
- Neubewertung ueber Punktedifferenz abrechnen
- Bewertung und Ranking in einer Transaktion aktualisieren
- persoenliche Spieler-Rueckmeldung und Broadcast an Host/Display
- automatische Treffer nur als unverbindlichen Vorschlag markieren

### Gegentests

- 0 Punkte, Teilpunkte, Maximalpunkte
- Unter- und Ueberschreitung
- identische Wiederholungsbewertung
- Korrektur hoch und herunter
- zwei parallele Review-Nachrichten
- Host-Reconnect mit bereits bewerteten Antworten

### Definition of Done

- wiederholte Aktion erzeugt keine Doppelwertung
- Ranking folgt jeder abgeschlossenen Bewertung sofort
- Review bleibt stabil einer persistenten Spielerantwort zugeordnet

## AP-05 - Fragetyp-Registry und Validierungsvertrag

### Ergebnis

Fragetypen werden zentral registriert und definieren Normalisierung, Validierung, Bewertung und sichere Payloads.

### Umsetzung

- Registry fuer `single_choice`, `multiple_choice`, `true_false`, `short_text`
- zentraler Vertrag fuer Editor-Metadaten, Antwortschema, Bewertung und Loesung
- Event-Router von typspezifischen Sonderfaellen entkoppeln
- unbekannte Typen kontrolliert ablehnen
- Referenztyp als Architekturtest implementieren, erst nach stabilen Basistypen produktiv freigeben

### Gegentests

- Vertragstest je Basistyp
- unbekannter Typ beim Speichern und Laden
- oeffentlicher Payload ohne Loesungsfelder
- Referenztyp ohne Aenderung am zentralen Router

### Definition of Done

- neuer Typ benoetigt keine neuen `if`-Ketten im WebSocket-Router
- alle Basistypen passieren dieselbe Vertragstest-Suite

## AP-06 - Admin-Editor fuer vier Basistypen

### Ergebnis

Alle Basistypen sind ohne Roh-JSON vollstaendig erstellbar, bearbeitbar, sortierbar und loeschbar.

### Umsetzung

- typabhaengige Formulare
- Optionsverwaltung und Korrektmarkierung
- akzeptierte Freitextantworten als Liste
- Frage duplizieren, loeschen und sortieren
- transaktionale serverseitige Validierung
- Feldfehler ohne Verlust der Eingaben

### Gegentests

- Create/Read/Update/Delete je Typ
- unvollstaendige und widerspruechliche Eingaben
- Sortierung mit stabiler Korrektzuordnung
- Loeschen ohne Auswirkung auf fremde Fragen

### Definition of Done

- ein komplettes Vier-Typen-Quiz kann ausschliesslich ueber die UI erstellt werden
- anschliessender Zwei-Spieler-Browserlauf ist gruen

## AP-07 - Fragebilder und Bildantworten

### Ergebnis

Fragen koennen ein Bild besitzen; Auswahlfragen koennen Text-, Bild- oder gemischte Antwortoptionen verwenden.

### Umsetzung

- `questions.image_url` durchgaengig pflegbar machen
- Antwortoption um Bildreferenz und Alternativtext erweitern
- sichere Uploadvalidierung und Medienverwaltung
- stabile responsive Bildkacheln in Player, Host und Display
- Vollbildvorschau im Editor
- Medien bei Duplizieren und Loeschen konsistent behandeln

### Gegentests

- Fragebild mit vier Textantworten
- vier reine Bildantworten
- gemischte Text-/Bildantworten bei Multiple Choice
- ungueltige Datei, zu grosse Datei und fehlender Alternativtext
- mobile und Beamer-Aufloesungen ohne Layoutverschiebung

### Definition of Done

- Medien erscheinen in jeder Phase und Rolle korrekt
- Korrektheitsinformation bleibt bis zur Loesungsphase geheim
- Bildoptionen bleiben nach Sortierung korrekt zugeordnet

## AP-08 - Persistenter Startzustand

### Ergebnis

`start` ist ein eigener, reconnect-faehiger Zustand zwischen Lobby und erster Frage.

### Umsetzung

- Zustandskante `lobby -> start -> question`
- eigene Darstellung in Player, Host und Display
- manueller Weiter-Button im Host
- Persistenz und Statusmapping
- optionaler Timer erst in AP-11

### Gegentests

- Reload jeder Rolle in `start`
- unerlaubte Antwort und unerlaubter Phasensprung
- Node-Neustart in `start`

### Definition of Done

- alle Rollen zeigen denselben Startzustand
- keine Frage oder Antwortoption wird zu frueh sichtbar

## AP-09 - Ergebnisregie und Beamersteuerung

### Ergebnis

Der Host steuert richtige Antwort, Top 10, Gesamtranking und Freitext-Diskussion auf dem Beamer.

### Umsetzung

- persistierte Ergebnisansicht pro Session
- Host-Steuerung und immer sichtbare Beenden-Aktion
- Display folgt Hostauswahl
- Spieler-Tabs fuer erlaubte Ergebnisansichten
- Freitext nur explizit freigegeben und standardmaessig anonym
- Frage- und Spielerstatistiken aus Einzelantworten

### Gegentests

- jeder Sichtwechsel mit allen Rollen
- Player-Tab veraendert den Beamer nicht
- Host-Reconnect erhaelt aktuelle Ergebnisansicht
- Sessionende aus jeder Phase

### Definition of Done

- alle Ergebnisansichten sind synchron und reconnect-faehig
- unveroeffentlichte Freitexte erscheinen nie auf dem Display

## AP-10 - Reconnect- und Neustart-Snapshots

### Ergebnis

Jede Rolle kann in jeder Phase reloaden; ein Node-Neustart rekonstruiert den gueltigen Zustand.

### Umsetzung

- rollenspezifische State-Snapshots
- Phase, Frage, Deadline, eigene Antwort, Review und Ergebnisansicht wiederherstellen
- absolute Deadlines persistieren
- Timer nach Neustart genau einmal planen
- abgelaufene Phasen deterministisch fortsetzen

### Gegentests

- Reload jeder Rolle in jeder Phase
- Node-Neustart in `answer` und `solution`
- Antwort vor und nach Deadline
- bereits abgegebene Antwort bleibt gesperrt

### Definition of Done

- Zustand nach Reconnect entspricht dem Zustand ohne Unterbrechung
- keine doppelte Transition und keine doppelte Wertung

## AP-11 - Konfigurierbare Automatik

### Ergebnis

Manueller und automatischer Modus verwenden dasselbe Zustandsmodell; jede automatische Phase kann uebersprungen werden.

### Umsetzung

- Modus und Dauer fuer `start`, `question`, `options`, `answer`, `solution`
- verstaendliche Admin-Konfiguration
- serverseitige absolute Zeitsteuerung
- manueller Skip ohne spaetere Doppeltransition

### Gegentests

- kompletter automatischer Lauf
- Skip in jeder Phase
- Reload und Node-Neustart mit laufendem Timer
- Grenzfall Antwort exakt an Deadline

### Definition of Done

- automatische und manuelle Laeufe liefern identische fachliche Ergebnisse
- keine Transition wird doppelt ausgefuehrt

## AP-11A - Live-Antworttracking und Beamerfreigabe

### Ergebnis

Der Host sieht Antworten sofort aggregiert. Eine explizit aktivierte Beameransicht zeigt den Abgabefortschritt und ab der konfigurierten Schwelle `n` auch anonyme Richtig-/Falschwerte.

### Umsetzung

- serverseitiges Aggregat `total`, `answered`, `correct`, `incorrect`, `pendingReview`
- Hostupdate bei jeder erstmalig persistierten Antwort
- persistente Beamerfreigabe und Schwelle je Quiz/Session
- Startwert `n = 1`, spaeterer Produktivstandard `n = 10`
- vor Erreichen der Schwelle keine Korrektheitszahlen auf dem Beamer
- Freitext bleibt bis zur Bewertung `pendingReview`
- keine Spieler-ID, Namen, Tokens oder Einzelantworten im Beamerpayload

### Gegentests

- erste sowie parallele Antworten aktualisieren genau einmal
- Schwellenwerte `1`, `10`, unterhalb und exakt an der Grenze
- Spieler/Display koennen Freigabe und Schwelle nicht manipulieren
- Host- und Display-Reconnect stellen Freigabe und Aggregate wieder her
- Freitext vor und nach Bewertung

### Definition of Done

- Hosttracking ist waehrend der Antwortphase live und kanonisch
- Beamerfreigabe bleibt ausschliesslich unter Hostkontrolle
- Korrektheitsaggregate erscheinen erst ab `n`

## AP-12 - Debian, Reverse Proxy und WSS

### Ergebnis

Quizzy ist auf Debian reproduzierbar als systemd-Dienst hinter Apache und HTTPS installierbar.

### Umsetzung

- versionierte Migrationen und Bootstrap-Anleitung
- systemd-Service
- Apache-Reverse-Proxy fuer `/ws`
- WebSocket-URL aus aktuellem Origin; unter HTTPS `wss://`
- Secrets ausschliesslich aus `.env`
- Healthcheck, Backup und Restore

### Gegentests

- frische Debian-Installation
- Neustart des Systems
- HTTPS ohne Mixed Content
- Datenbankbackup und Restore
- Node-Port nicht direkt aus externem Netz erreichbar

### Definition of Done

- Installation nach Dokumentation ohne Quellcodeanpassung
- Anwendung funktioniert ueber einen einzigen HTTPS-Origin

## AP-13 - UI-, Accessibility- und Regression-Abschluss

### Ergebnis

Alle Hauptsichten sind konsistent, bedienbar und in den Zielaufloesungen regressionsfrei.

### Umsetzung

- Design-Tokens und Komponenten konsolidieren
- Fokus, Tastatur, Labels, Live-Regionen und Kontrast
- Lade-, Leer-, Fehler- und Offline-Zustaende
- alte Debugpfade archivieren oder entfernen
- README und Betriebsdokumentation aktualisieren

### Gegentests

- Player bei 360, 390, 768 und 1440 Pixel
- Host bei 1200 und 1440 Pixel
- Display bei 1280x720, 1920x1080 und 4K
- kompletter Drei-Fragen-Lauf ohne Konsolenfehler

### Definition of Done

- keine Ueberlaeufe, Ueberdeckungen oder unbedienbaren Controls
- kompletter automatisierter und manueller Referenzlauf gruen
- Dokumentation entspricht dem realen Produktstand
