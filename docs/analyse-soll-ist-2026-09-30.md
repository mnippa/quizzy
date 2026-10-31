# Quizzy - Soll/Ist-Analyse und Uebergabe

Stand: 2026-09-30

## 1. Zweck

Dieses Dokument fasst den aktuellen Entwicklungsstand von Quizzy gegen das vorhandene Zielbild zusammen. Es dient als Uebergabe in eine andere VS-Code-Sitzung und als Grundlage fuer die anschliessende Festlegung der Umsetzungsreihenfolge.

Es wurden fuer diese Analyse keine Produktdateien oder Daten veraendert.

## 2. Analysierte Zielbilder

Massgeblich sind vor allem:

- `docs/anforderungen-quizzy.md`
- `docs/phasen-und-praesentationsformen.md`
- `docs/umsetzungsreihenfolge-phasen.md`
- `docs/ui-design-konzept.md`
- `docs/setup-und-quiz-flow.md`

Die README beschreibt einen aelteren Stand. Die Dokumente zum Phasenmodell und zur Umsetzungsreihenfolge sind fuer den aktuellen Soll-Zustand konkreter.

## 3. Wichtiger Hinweis zum Arbeitsstand

Der analysierte Arbeitsbaum ist umfangreich und uncommitted. Zum Analysezeitpunkt waren 32 Dateien geaendert oder neu; der Diff umfasste etwa 5.400 neue Zeilen. Einige Dateien wurden waehrend der Analyse parallel aktualisiert. Deshalb beziehen sich alle Aussagen auf den zuletzt lesbaren Dateistand und nicht auf den letzten Commit.

Vor einer Umsetzung sollte in der richtigen Sitzung zuerst der aktuelle Git-Status geprueft und ein stabiler Zwischenstand gesichert werden.

## 4. Gesamtstatus

| Bereich | Aktueller Stand |
|---|---|
| Dashboard und Quiz-Auswahl | weitgehend vorhanden |
| Lobby, Kick und Sperrliste | vorhanden, noch unzureichend getestet |
| Manuelle Phasensteuerung | technisch vorhanden |
| Persistierte Phasen | vorhanden |
| Automatikmodus | teilweise vorhanden |
| Spielleiter-Kontrollcenter | brauchbares Geruest, Ergebnissteuerung fehlt |
| Vier grundlegende Fragetypen | Runtime vorhanden |
| Admin-Pflege der Fragetypen | deutlich unvollstaendig |
| Freitext-Review | Prototyp vorhanden |
| Manuelle Punktevergabe | nicht umgesetzt |
| Reconnect und Persistenz | begonnen, nicht verlaesslich abgenommen |
| WebSocket-Sicherheit | kritisch offen |
| Tests | Kernfunktionen teilweise, Gesamtworkflow rot |

## 5. Spielleiter-Kontrollcenter

### 5.1 Bereits vorhanden

- Quiz starten
- Antwortmoeglichkeiten zeigen
- Antwortphase starten und beenden
- zur naechsten Frage wechseln
- Spieleruebersicht
- Fortschritt `beantwortet / gesamt`
- Spieler entfernen und gesperrte Spieler wieder freigeben
- Fragenvorschau
- Ranking und Ergebnisdaten
- Freitext-Review-Queue
- manuelle Phasenuebergaenge
- Grundlagen fuer automatische Phasenuebergaenge

Relevante Dateien:

- `public/host_control.php`
- `public/js/app.js`
- `realtime-node/server.js`
- `realtime-node/quiz.js`
- `realtime-node/lobby.js`

### 5.2 Offene Punkte

1. Der geforderte Zustand `Start` fehlt. Der Quizstart springt direkt in `question`.
2. Im Kontrollcenter fehlt eine immer sichtbare Aktion zum sofortigen Beenden der Session. Das Beenden ist derzeit hauptsaechlich ueber das Dashboard erreichbar.
3. Die Ergebnisphase besitzt keine vom Host steuerbaren Ansichten:
   - richtige Antwort
   - Top 10
   - Gesamtranking
   - Freitext-Diskussion
4. Die Beameransicht kann keiner vom Host ausgewaehlten Ergebnisansicht folgen.
5. Spieler besitzen keine eigenen Ergebnis-Tabs fuer richtige Antwort, Top 10 und Gesamtranking.
6. Statistiken pro Frage und pro Spieler fehlen.
7. Automatikmodus und Phasendauern existieren im Datenmodell, sind aber noch keine vollstaendige und verstaendliche Quizkonfiguration.
8. Host-Reconnect und Wiederherstellung des vollstaendigen Bedienzustands sind nicht abgenommen.

### 5.3 Bewertung

Das Kontrollcenter ist bereits ein brauchbares Ablaufpanel. Es ist aber noch nicht das im Zielbild beschriebene Live-Regiezentrum, da insbesondere die didaktische Ergebnisphase und deren Sichtsteuerung fehlen.

## 6. Phasenmodell

### 6.1 Soll

Das Zielmodell sieht vor:

1. `lobby`
2. `start`
3. `question`
4. `options`
5. `answer`
6. `solution` beziehungsweise Ergebnis/Idle
7. `endresult` oder `finished`

### 6.2 Ist

Im Backend sind `question`, `options`, `answer`, `solution` und Endzustaende vorhanden. Der Zustand `options` wird persistiert und sperrt die Antwortabgabe korrekt. Ein eigener persistierter Startzustand fehlt.

Automatische Uebergaenge sind technisch in `realtime-node/quiz.js` angelegt. In der ersten fachlichen Teststufe soll der Ablauf jedoch weiterhin vollstaendig manuell funktionieren.

## 7. Aufgabentypen

### 7.1 Vorhandene Runtime-Typen

- `single_choice`
- `multiple_choice`
- `true_false`
- `short_text`

Die Client- und Serverlogik fuer Antwortabgabe und grundsaetzliche Auswertung ist vorhanden. Die Demo-Daten enthalten je ein Beispiel aller vier Typen.

### 7.2 Luecken im Admin-Editor

Der Admin-Editor ist derzeit der groesste Engpass bei den Aufgabentypen:

- keine komfortable Pflege von `question_options`
- keine typabhaengigen Formulare
- `answer_payload` muss als rohes JSON eingegeben werden
- keine verlaessliche JSON- und Konsistenzvalidierung
- keine Listenoberflaeche fuer akzeptierte Freitextantworten
- keine geeignete Auswahloberflaeche fuer mehrere korrekte Antworten
- keine erkennbare Fragenloeschung
- keine komfortable Sortierung der Fragen
- Bildfelder existieren in Schema und Runtime, sind im Editor aber nicht vollstaendig pflegbar
- ungueltige Fragetypen werden serverseitig nicht ausreichend abgefangen

### 7.3 Empfehlung

Noch keine weiteren Fragetypen ergaenzen. Zuerst muessen die vier vorhandenen Typen vollstaendig erstellbar, bearbeitbar, validierbar und End-to-End getestet sein.

## 8. Freitext und manuelle Punktevergabe

### 8.1 Bereits vorhanden

- Freitextantworten werden gespeichert.
- Eine Review-Queue ordnet Antworten Spielern zu.
- Der Host kann `Richtig` oder `Falsch` waehlen.
- `short_text_reviews` speichert `reviewed` und `approved`.
- Antwortdaten werden zusaetzlich in `session_answers` persistiert.

### 8.2 Fachlich fehlend

- Eingabe frei waehlbarer Punkte
- Teilpunkte
- Begrenzung anhand von `points_max`
- Kommentar oder Bewertungsnotiz des Spielleiters
- Korrektur beziehungsweise Ruecknahme einer Bewertung
- Anzeige bereits bewerteter Antworten
- eindeutige Live-Rueckmeldung an den betroffenen Spieler
- sofort synchronisiertes Ranking nach einer Bewertung
- didaktische Freigabe ausgewaehlter Antworten fuer die Beameransicht

### 8.3 Konkrete Fehler der aktuellen Bewertung

1. Eine als richtig bewertete Antwort erhaelt fest 100 Punkte, unabhaengig von der Frage.
2. Wiederholtes Senden derselben Freigabe kann erneut Punkte addieren.
3. Freitext kann `answered_questions` bei Abgabe und beim Review nochmals erhoehen.
4. Die manuelle Bewertung aktualisiert den zugehoerigen Datensatz in `session_answers` nicht konsistent.
5. Ranking und Ergebnisansichten werden nach einer Bewertung nicht vollstaendig neu ausgesendet.
6. Die Review-Zuordnung verwendet teilweise die fluechtige WebSocket-Client-ID. Ein Reconnect kann die Zuordnung dadurch brechen.

### 8.4 Bewertung

Der Freitextbereich ist ein funktionaler Prototyp, aber noch keine belastbare manuelle Punktevergabe. Vor einem echten Einsatz muss die Bewertung transaktional, idempotent und an eine persistente Spieleridentitaet gebunden werden.

## 9. Session-, Join- und Reconnect-Verhalten

### 9.1 Vorhanden

- persistierte Sessionzustaende
- persistierter Fragenindex
- `session_players` mit `player_token`
- `session_answers` mit Antwortzeit in Millisekunden
- Join-Sperre nach Quizstart, sofern nicht konfiguriert
- Reconnect-Grundlagen

### 9.2 Kritischer aktueller Fehler

Eine unbekannte PIN wird nicht sauber abgelehnt. Stattdessen kann eine fluechtige Demo-Session entstehen. Diese Session besitzt keinen verlaesslichen Datenbankdatensatz.

Folgen:

- ungueltige PINs koennen scheinbar funktionieren
- Sessionzustand ist nicht verlaesslich persistent
- Workflowtests schlagen bereits beim Sessionnachweis fehl
- der Server kann Demo-Inhalte an nicht vorgesehene Sessions binden

Erwartetes Verhalten sollte eindeutig festgelegt werden:

- Spieler: unbekannte PIN immer ablehnen
- Host: Session nur ueber den authentifizierten PHP-/Admin-Flow erstellen
- keine automatische Demo-Session im normalen Produktivpfad

## 10. Sicherheit

Die PHP-Seiten besitzen eine einfache Session-Anmeldung fuer Admins. Der WebSocket-Kanal vertraut aber weiterhin den Angaben des Clients, insbesondere `role: "host"` und `sessionPin`.

Damit kann ein beliebiger WebSocket-Client theoretisch Host-Ereignisse senden, zum Beispiel:

- Quiz starten
- Phasen umschalten
- Spieler entfernen
- Freitext bewerten
- Quiz beenden

Das ist ein P0-Thema. Die PHP-Anmeldung schuetzt nur die Seite, nicht den Echtzeitkanal. Erforderlich ist mindestens ein serverseitig ausgegebenes, sessionspezifisches Host-Token, das beim WebSocket-Join und bei Host-Aktionen validiert wird.

## 11. Datenmodell

Relevante Tabellen sind vorhanden oder werden durch `realtime-node/db.js` angelegt:

- `sessions`
- `questions`
- `question_options`
- `session_players`
- `session_answers`
- `session_results`
- `short_text_reviews`

Positiv:

- Antworten koennen spaeter ausgewertet werden.
- Antwortzeiten werden millisekundengenau gespeichert.
- Spieler erhalten einen persistenten Token als Reconnect-Grundlage.

Offen:

- Freitext-Review sollte mit `session_answers` zu einem eindeutigen Bewertungsdatensatz verbunden werden.
- Manuell vergebene Punkte, Kommentar, Bewerter und Bewertungszeitpunkt fehlen.
- Ergebnisaggregation und Einzelantworten koennen derzeit auseinanderlaufen.

## 12. Testergebnisse

### 12.1 Erfolgreich

PHP-Syntaxcheck aller Seiten:

- alle geprueften PHP-Dateien syntaktisch fehlerfrei

Isolierte Node-Tests:

- 5 von 5 bestanden
- Punkteverfall ueber die Antwortzeit
- exakte Antwortzeitberechnung
- Ablehnung nach Deadline
- Loesungsfelder werden vor der Ergebnisphase nicht veroeffentlicht
- Laden einer Frage aus der Datenbank
- Persistenz von Antwort und Antwortzeit

### 12.2 Fehlgeschlagen

Konfigurierter Workflowtest:

- 1 von 3 Tests bestanden
- Join auf unbekannte PIN erzeugt keinen persistierten Sessiondatensatz
- kompletter Workflow scheitert deshalb bereits beim Sessionnachweis

Zusaetzlich zeigte der erste Testlauf ein Test-Harness-Problem unter Windows:

- Serverbindung an `localhost` kann IPv6 verwenden
- Tests verbinden sich fest mit `127.0.0.1`
- mit expliziter IPv4-Bindung war der Server erreichbar; danach wurde der eigentliche Sessionfehler sichtbar

### 12.3 Fehlende Tests

- Single Choice End-to-End
- Multiple Choice End-to-End
- Wahr/Falsch End-to-End
- Freitextabgabe und Review
- frei waehlbare manuelle Punkte
- idempotente Neubewertung
- Kick und Unban
- Spieler-Reconnect
- Host-Reconnect
- unbekannte PIN
- automatischer Modus
- Endergebnis
- Ergebnisansichten und Beamersteuerung

## 13. Vorlaeufige Arbeitsbloecke

Die Reihenfolge soll bewusst erst in der richtigen Sitzung festgelegt werden. Aus der Analyse ergeben sich aber klar getrennte Bloecke.

### Block A - Stabiler Ausgangspunkt

- aktuellen uncommitted Stand sichern
- Test-Host und Test-Port vereinheitlichen
- unbekannte PIN korrekt behandeln
- Workflowtest gruen bekommen

### Block B - Echtzeit-Autorisierung

- Host-Token erzeugen
- WebSocket-Join authentifizieren
- Host-Events serverseitig autorisieren
- Negativtests fuer gefaelschte Host-Nachrichten

### Block C - Freitext und manuelle Bewertung

- persistente Spieler- und Antwortzuordnung
- frei waehlbare Punkte von 0 bis `points_max`
- richtig/falsch optional als Schnellwahl
- idempotente Bewertung und Neubewertung
- Bewertungsverlauf oder mindestens letzter Bewertungsstand
- synchrone Aktualisierung von Spieler, Host, Beamer und Ranking

### Block D - Fragetypen produktionsreif machen

- typabhaengiger Editor
- Optionsverwaltung
- Multiple-Choice-Korrektwahl
- akzeptierte Freitextantworten
- Bildverwaltung
- Validierung, Loeschen und Sortierung
- End-to-End-Test je Typ

### Block E - Kontrollcenter zum Regiezentrum ausbauen

- eigener Startzustand
- Session direkt beenden
- Ergebnisansichten steuern
- Beamer folgt Hostauswahl
- Freitext-Diskussionsansicht
- Frage- und Spielerstatistiken

### Block F - Reconnect und Automatik

- vollstaendige Zustandssynchronisierung
- Host- und Spieler-Reconnect testen
- Automatikmodus konfigurierbar machen
- manuelles Ueberspringen jeder automatischen Phase

## 14. Offene Entscheidungen vor Umsetzung

1. Sollen Freitextaufgaben ausschliesslich manuell oder optional automatisch vorbewertet werden?
2. Sind Punkte ganzzahlig und immer im Bereich `0..points_max`?
3. Darf eine Bewertung nachtraeglich geaendert werden?
4. Soll eine Aenderung sofort das Ranking fuer alle aktualisieren?
5. Welche Freitextantworten duerfen anonym oder mit Namen auf dem Beamer erscheinen?
6. Soll der Host waehrend jeder Phase sofort zur naechsten Phase beziehungsweise zum Ende springen koennen?
7. Wird der Zustand `start` als eigener persistierter Zustand benoetigt oder nur als kurze Ansicht?
8. Werden vorhandene automatische Freitexttreffer als Vorschlag angezeigt oder direkt gewertet?

## 15. Kurzfazit

Quizzy ist deutlich weiter als ein einfacher Prototyp: Datenbankbasierte Fragen, Phasensteuerung, Antwortpersistenz, dynamische Punkte, Reconnect-Grundlagen und ein erstes Kontrollcenter sind vorhanden.

Die groessten Luecken liegen nicht im visuellen Grundgeruest, sondern in den fachlichen Garantien:

- sichere Session- und Hostidentitaet
- verlaesslicher kompletter Workflow
- korrekte und flexible Freitextbewertung
- vollstaendige Pflege der vorhandenen Fragetypen
- didaktische Ergebnissteuerung im Kontrollcenter

Diese Punkte sollten vor weiteren Fragetypen oder rein visuellen Erweiterungen geklaert werden.