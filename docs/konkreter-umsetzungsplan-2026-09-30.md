# Quizzy - Konkreter Umsetzungsplan

Stand: 2026-09-30

Grundlage: `docs/analyse-soll-ist-2026-09-30.md` und die dort genannten Zielbilder.

## 1. Ziel und Arbeitsmodus

Ziel ist ein belastbarer, sicherer und auf Debian betreibbarer Live-Quiz-Stand. Die Entwicklung erfolgt blockweise. Jeder Block endet mit automatisierten Tests und einem Browser-Abnahmelauf mit Spielleiter, zwei Spielern und Praesentationsansicht.

Es gilt:

- keine neuen fachlichen Fragetypen, bevor die vier vorhandenen Typen produktionsreif sind; die Erweiterungsarchitektur wird dabei vorbereitet
- keine rein visuelle Erweiterung vor den P0-Garantien fuer Session und Autorisierung
- kleine, migrationsfaehige Aenderungen statt Big-Bang-Neuschreibung
- bestehende uncommitted Aenderungen werden nicht zurueckgesetzt
- Fehler werden am verursachenden Daten- oder Kontrollpfad behoben
- nach jedem Block bleibt der komplette bisherige Workflow gruen

## 2. Festgelegte Fachentscheidungen

Damit die Umsetzung ohne weitere Grundsatzblockaden beginnen kann, gelten zunaechst diese Regeln:

1. Unbekannte PINs werden fuer Spieler, Displays und Hosts abgelehnt. Sessions entstehen ausschliesslich im authentifizierten PHP-Admin-Flow.
2. `start` wird als eigener persistierter Zustand umgesetzt.
3. Freitextpunkte sind ganzzahlig und liegen im Bereich `0..points_max`.
4. Freitextbewertungen duerfen nachtraeglich geaendert werden. Es gilt immer der letzte persistierte Bewertungsstand; nur die Punktedifferenz wird verrechnet.
5. Jede Bewertung aktualisiert sofort Spieler, Host, Praesentation, Ergebnisdaten und Ranking.
6. Automatisch erkannte Freitexttreffer sind nur ein Vorschlag fuer den Host und vergeben nicht selbststaendig Punkte.
7. Freitextantworten erscheinen auf dem Beamer nur nach expliziter Freigabe durch den Host; Standard ist anonymisiert.
8. Der Host darf jede Phase manuell weiterschalten und die Session jederzeit beenden.
9. Manueller Modus bleibt die Referenz. Automatik ist eine optionale Konfiguration auf demselben Zustandsmodell.
10. `endresult` ist der sichtbare Abschluss; `finished` kennzeichnet eine geschlossene Session.
11. Der Host sieht waehrend der Antwortphase live `abgegeben/gesamt` sowie aggregiert `richtig`, `falsch` und `offen`.
12. Der Host kann eine Live-Fortschrittsansicht fuer den Beamer ein- und ausschalten. Der Beamer zeigt zunaechst nur `abgegeben/gesamt`; Richtig/Falsch wird erst ab einer konfigurierbaren Mindestzahl `n` abgegebener Antworten sichtbar.
13. Fuer die erste Einfuehrung gilt `n = 1`; der spaetere Produktivstandard ist `n = 10`. Bei `n = 1` besteht keine wirksame Anonymitaet, weil die erste Einzelantwort aus dem Aggregat ableitbar ist.
14. Live-Korrektheit wird ausschliesslich serverseitig aus `session_answers` aggregiert und nie einem Namen oder Player-Token zugeordnet ausgestrahlt. Noch nicht bewertete Freitextantworten zaehlen als `offen`.

## 3. Verbindliche Qualitaets-Gates

Jeder Arbeitsblock muss folgende Checks bestehen:

1. betroffene Node-Unit- und Integrationstests
2. gesamter Node-Testlauf
3. PHP-Syntaxcheck aller PHP-Dateien
4. VS-Code-Diagnostik ohne neue Fehler
5. Browserlauf fuer die geaenderte Funktion
6. Reconnect-Test in der betroffenen Phase
7. Negativtest fuer unerlaubte oder ungueltige Aktion
8. keine vorzeitige Offenlegung von Loesungsdaten

Der Browser-Referenzlauf verwendet mindestens:

- einen Host
- zwei Spieler mit getrennten Tokens
- eine Praesentationsansicht
- drei beantwortete Fragen
- mindestens eine richtige und eine falsche Antwort
- bei typbezogenen Arbeiten zusaetzlich den jeweils betroffenen Fragetyp

## 4. Block 0 - Ausgangspunkt und Test-Harness

Prioritaet: P0

### Umsetzung

- aktuellen Git-Status und vorhandene Aenderungen dokumentieren
- Testserver auf eine explizite, konfigurierbare IPv4-Adresse und einen festen Testport binden
- Serverstart in Tests ohne impliziten Modulstart ermoeglichen
- Testdaten pro Test gezielt anlegen und danach entfernen
- Tests von bestehenden Live-Sessions und Produktivdaten isolieren
- `npm test` auf alle Testdateien erweitern
- veraltete Annahme entfernen, dass ein Join eine Session erzeugt

### Primaere Dateien

- `realtime-node/server.js`
- `realtime-node/config.js`
- `realtime-node/package.json`
- `realtime-node/tests/workflow.test.js`
- neue Test-Utilities unter `realtime-node/tests/`

### Abnahme

- Tests funktionieren unabhaengig davon, ob `localhost` auf IPv4 oder IPv6 zeigt
- kein Port-Fallback im Testbetrieb
- Tests verwenden eindeutige sechsstellige PINs
- Testdaten beeinflussen keine bestehende Quizrunde
- wiederholtes `npm test` ist reproduzierbar gruen

## 5. Block 1 - Session-Integritaet und unbekannte PIN

Prioritaet: P0

### Umsetzung

- Demo-/Fallback-Session aus dem normalen Join-Pfad entfernen
- Session vor jeder Rollenregistrierung aus der Datenbank laden
- unbekannte, geschlossene und syntaktisch ungueltige PINs mit strukturiertem Fehler ablehnen
- Rollen nur nach erfolgreichem Join an der WebSocket-Verbindung setzen
- Player-Token nur innerhalb einer gueltigen Session akzeptieren
- PHP-Sessionerzeugung transaktional und mit Kollisionswiederholung fuer PINs absichern
- eindeutige Fehlertexte fuer Spieler, Host und Display anzeigen

### Primaere Dateien

- `realtime-node/lobby.js`
- `realtime-node/server.js`
- `realtime-node/utils.js`
- `public/admin/quizzes.php`
- `public/js/app.js`

### Automatisierte Tests

- unbekannte PIN wird fuer jede Rolle abgelehnt
- ein Join legt niemals eine Session an
- gueltige Lobby-Session wird geladen
- geschlossene Session akzeptiert keinen neuen Spieler
- PIN-Kollision erzeugt eine neue PIN statt eines SQL-Fehlers
- Join nach Start folgt `ALLOW_JOIN_AFTER_START`

### Abnahme

- der bisher rote Workflowtest ist fachlich korrigiert und gruen
- keine Session ohne Datenbankdatensatz kann im Arbeitsspeicher entstehen
- Browser zeigt bei unbekannter PIN einen stabilen Fehlerzustand ohne Reconnect-Schleife

## 6. Block 2 - WebSocket-Host-Autorisierung

Prioritaet: P0

### Umsetzung

- bei Sessionerzeugung ein kryptografisch zufaelliges Host-Token erzeugen
- nur einen Hash des Tokens in `sessions` persistieren
- Klartext-Token in der authentifizierten PHP-Session halten und an die Hostseite ausgeben
- Host-Join nur mit passendem Token akzeptieren
- serverseitige zentrale `requireHostAuthorization`-Pruefung vor jedem Host-Event
- `role: host` aus Clientdaten niemals als Autorisierung verwenden
- Host-Token bei neuer Runde rotieren und beim Schliessen ungueltig machen
- abgewiesene Aktionen strukturiert protokollieren, ohne Token zu loggen

### Primaere Dateien

- `realtime-node/db.js`
- `realtime-node/server.js`
- `realtime-node/lobby.js`
- `realtime-node/quiz.js`
- `public/admin/quizzes.php`
- `public/host_control.php`
- `public/js/app.js`

### Automatisierte Tests

- Host-Join mit gueltigem Token gelingt
- fehlendes, falsches und abgelaufenes Token wird abgelehnt
- Spieler kann mit gefaelschtem `role: host` keine Phase wechseln
- Display kann keine Spieler kicken oder Bewertungen senden
- Token einer anderen Session funktioniert nicht
- Logs und WebSocket-Fehlerpayloads enthalten kein Token

### Abnahme

- jede mutierende Host-Aktion besitzt genau eine zentrale Autorisierungspruefung
- manipulierter WebSocket-Client kann den Quizablauf nicht steuern
- legitimer Host kann nach Browser-Reload wieder in den aktuellen Zustand einsteigen

## 7. Block 3 - Persistentes Ergebnis- und Freitextmodell

Prioritaet: P0/P1

### Datenmodell

- `session_answers` wird die kanonische Quelle je Spieler und Frage
- Spielerzuordnung ausschliesslich ueber `player_token` beziehungsweise persistente `session_player_id`
- Review-Felder ergaenzen:
  - `review_status`
  - `manual_points`
  - `review_comment`
  - `reviewed_by`
  - `reviewed_at`
  - `published_to_display`
- `short_text_reviews` entweder sauber per `session_answer_id` anbinden oder nach Migration durch die Review-Felder in `session_answers` ersetzen
- Ergebnisaggregation aus Antworten ableiten und transaktional aktualisieren

### Logik

- Abgabe erhoeht `answered_questions` genau einmal
- Review veraendert keine Antwortanzahl
- erste Bewertung und Neubewertung verrechnen nur die Punktedifferenz
- Wiederholung derselben Bewertung ist idempotent
- Punkte werden serverseitig auf `0..points_max` begrenzt
- Richtig/Falsch sind Schnellaktionen fuer `points_max` beziehungsweise `0`
- Spieler erhaelt sofort eine persoenliche Bewertungsnachricht
- Ranking und Ergebnisdaten werden nach Commit neu geladen und ausgesendet

### Primaere Dateien

- `realtime-node/db.js`
- `realtime-node/quiz.js`
- `realtime-node/utils.js`
- `realtime-node/ranking.js`
- `public/host_control.php`
- `public/js/app.js`

### Automatisierte Tests

- Freitextabgabe wird genau einmal gespeichert
- 0, Teilpunkte und `points_max` funktionieren
- negative Punkte und Punkte ueber Maximum werden abgelehnt oder begrenzt
- identische Wiederholungsbewertung aendert den Gesamtstand nicht
- Neubewertung von 30 auf 70 addiert exakt 40 Punkte
- Neubewertung von 70 auf 0 zieht exakt 70 Punkte ab
- Reconnect aendert die Zuordnung nicht
- parallele doppelte Review-Nachrichten erzeugen keine Doppelwertung
- `session_answers`, `session_players` und `session_results` bleiben konsistent

### Browser-Abnahme

- zwei Freitextantworten bewerten, eine davon mit Teilpunkten
- Bewertung korrigieren und sofortige Ranglistenanpassung in allen Sichten pruefen
- Host neu laden und bereits bewertete Antworten weiter anzeigen
- eine Antwort explizit anonymisiert auf dem Beamer freigeben

## 8. Block 4 - Fragetypen und Medienvarianten produktionsreif

Prioritaet: P1

### Umsetzung

- typabhaengige Formulare statt rohem `answer_payload`
- Single Choice: genau eine korrekte Option
- True/False: feste, lokalisierte Optionen und genau eine korrekte Auswahl
- Multiple Choice: mindestens zwei Optionen und mindestens eine korrekte Auswahl
- Freitext: Liste akzeptierter Antworten, Normalisierungsoptionen und Review-Hinweis
- Fragenoptionen anlegen, bearbeiten, loeschen und sortieren
- Fragen anlegen, duplizieren, loeschen und sortieren
- vorhandenes `questions.image_url` als optionales Fragebild vollstaendig in Editor, Runtime und Ergebnisansicht unterstuetzen
- `question_options` um optionales Antwortbild und Alternativtext erweitern
- jede Auswahloption darf Text, Bild oder beides enthalten; mindestens ein Inhalt ist Pflicht
- Darstellungsvarianten `text`, `image` und `text_image` getrennt vom fachlichen Fragetyp behandeln
- Single Choice und Multiple Choice dadurch auch als vier oder mehr Bildantworten nutzbar machen
- responsive Bildkacheln mit stabilem Seitenverhaeltnis, Vollbildvorschau und klarer Auswahlmarkierung
- Upload mit Dateityp-, Groessen- und Bildvalidierung; keine ausfuehrbaren Formate
- Medien beim Duplizieren, Loeschen und Export konsistent behandeln
- serverseitige Whitelist fuer Fragetypen und transaktionale Konsistenzvalidierung
- verstaendliche Feldfehler ohne Verlust der Eingaben

### Erweiterungsvertrag fuer eigene Fragetypen

- Fragetypen erhalten eine zentrale Registry mit stabiler Typ-ID und Anzeigename
- jeder Typ definiert deklarativ:
  - Antwortschema und Editorfelder
  - Validierungsregeln
  - Spieler-Renderer
  - serverseitige Normalisierung und Bewertung
  - oeffentlichen Fragen-Payload ohne Loesungsdaten
  - Loesungs- und Ergebnisdarstellung
- gemeinsame Phasen-, Timing-, Persistenz- und Rankinglogik bleibt ausserhalb des Typs
- unbekannte Typ-IDs werden beim Speichern und Laden mit verstaendlichem Fehler abgewiesen
- eigene Typen werden als getestete Code-Erweiterung registriert; Admins koennen aus Sicherheitsgruenden keinen ausfuehrbaren Code hochladen
- als Referenz wird nach Stabilisierung der vier Basistypen ein kleiner zusaetzlicher Typ ueber die Registry umgesetzt, ohne Sonderfall im zentralen Event-Router

### Primaere Dateien

- `public/admin/quiz_edit.php`
- `public/css/style.css`
- `public/js/app.js`
- `realtime-node/quiz.js`
- `realtime-node/utils.js`
- `realtime-node/db.js`
- zentrale Fragetyp-Registry beziehungsweise Typdefinitionen
- bei Upload zusaetzlicher, eng begrenzter Medien-Endpunkt

### Automatisierte Tests

- Validierung und Roundtrip je Fragetyp
- ungueltiges JSON kann nicht mehr in normalen Formularen entstehen
- Multiple-Choice-Indizes bleiben nach Sortierung korrekt
- Fragebild wird gespeichert und in allen drei Sichten korrekt angezeigt
- Bildantworten funktionieren fuer Single und Multiple Choice
- gemischte Text-/Bildoptionen bleiben nach Sortierung korrekt zugeordnet
- Antwortpayload enthaelt Medien, aber vor der Loesungsphase keine Korrektheitsinformation
- fehlender Alternativtext und ungueltige beziehungsweise zu grosse Dateien werden abgewiesen
- geloeschte, noch referenzierte und gemeinsam genutzte Medien werden sicher behandelt
- Loeschen einer Frage entfernt Optionen, aber keine fremden Fragen
- ungueltiger Typ, leere Pflichtfelder und inkonsistente Optionen werden abgelehnt
- registrierter Referenztyp durchlaeuft Editor, Runtime, Persistenz und Ergebnis ueber den Erweiterungsvertrag
- unbekannter Fragetyp fuehrt weder zu Serverabsturz noch zu einer auswertbaren Session

### Browser-Abnahme

- neues Quiz ausschliesslich ueber die UI mit allen vier Basistypen erstellen
- eine Frage mit Fragebild und Textantworten spielen
- eine Frage mit vier reinen Bildantworten spielen
- eine Multiple-Choice-Frage mit gemischten Text-/Bildoptionen spielen
- Quiz komplett mit zwei Spielern durchspielen
- richtige Loesungen, Sperrphasen, Persistenz und Ranking je Typ pruefen

## 9. Block 5 - Persistenter Startzustand und Regiezentrum

Prioritaet: P1

### Umsetzung

- `lobby -> start -> question -> options -> answer -> solution -> endresult -> finished`
- Host startet zunaechst `start`; separate Aktion wechselt zur ersten Frage
- Startansicht in Spieler-, Host- und Praesentationssicht
- immer sichtbare Aktion zum Beenden mit Bestaetigung
- Ergebnisansichten als serverseitig persistierte Auswahl:
  - richtige Antwort
  - Top 10
  - Gesamtranking
  - Freitext-Diskussion
- Beamer folgt ausschliesslich der Hostauswahl
- Spieler darf lokal zwischen erlaubten Ergebnis-Tabs wechseln
- Frage- und Spielerstatistiken aus `session_answers` berechnen

### Primaere Dateien

- `realtime-node/db.js`
- `realtime-node/quiz.js`
- `realtime-node/lobby.js`
- `public/host_control.php`
- `public/lobby.php`
- `public/display.php`
- `public/js/app.js`
- `public/js/status-utils.js`

### Automatisierte Tests

- jede erlaubte Zustandskante funktioniert
- jede unerlaubte Zustandskante wird abgelehnt
- Ergebnisansicht wird persistiert und nach Reconnect rekonstruiert
- Display folgt dem Host, Spieler-Tabs veraendern das Display nicht
- Sessionende funktioniert aus jeder Phase
- Statistiken entsprechen den gespeicherten Einzelantworten

### Browser-Abnahme

- kompletter manueller Lauf aller Phasen
- Umschalten aller Ergebnisansichten
- Host-Reload in `start`, `answer` und `solution`
- Sessionende aus Lobby, Antwortphase und Ergebnisphase

## 10. Block 6 - Reconnect, Neustart und Automatik

Prioritaet: P1

### Umsetzung

- eine zentrale State-Snapshot-Struktur pro Rolle definieren
- laufende Phase, Frage, Restzeit, eigene Antwort, Reviewstatus und Ergebnisansicht wiederherstellen
- absolute serverseitige Deadlines persistieren
- Neustart rekonstruiert automatische Uebergaenge ohne doppelte Timer
- Modus pro Quiz: manuell oder automatisch
- Dauer fuer `start`, `question`, `options`, `answer` und `solution` konfigurierbar
- jede automatische Phase bleibt durch Hostaktion sofort ueberspringbar
- klare Behandlung abgelaufener Phase waehrend Serverausfall

### Automatisierte Tests

- Spieler-Reconnect vor und nach Antwort
- Host-Reconnect in jeder Phase
- Display-Reconnect bei jeder Ergebnisansicht
- Node-Neustart in `answer` und `solution`
- Antwort exakt vor und nach Deadline
- automatischer Lauf und manuelles Ueberspringen ohne Doppeltransition

### Browser-Abnahme

- Drei-Fragen-Lauf mit gezielten Reloads aller Rollen
- Node-Neustart waehrend der zweiten Antwortphase
- Fortsetzung mit korrekter Restzeit, Antwortsperre und Rangliste

## 11. Block 7 - Debian-Betrieb und WebSocket-Transport

Prioritaet: P1

### Umsetzung

- migrationsfaehiges Schema statt ausschliesslich dynamischer `ALTER TABLE`-Logik
- Setup fuer Apache, PHP, MariaDB und Node dokumentieren
- systemd-Service fuer Node bereitstellen
- Apache-Reverse-Proxy fuer `/ws` einrichten
- Browser baut WebSocket-URL aus aktuellem Protokoll und Host auf
- unter HTTPS ausschliesslich `wss://`
- direkte Freigabe des Node-Ports nach Reverse-Proxy nicht erforderlich
- Produktions-Secrets nur aus `.env`, keine produktiven Fallback-Passwoerter
- Healthcheck und strukturierte Startfehler
- Backup-/Restore-Anleitung fuer DB und Medien

### Abnahme

- Neuinstallation auf einem leeren Debian-System anhand der Dokumentation
- Dienst startet nach Reboot automatisch
- Anwendung funktioniert ueber einen einzigen HTTPS-Origin
- keine Mixed-Content- oder CORS-Probleme
- Restore eines Backups ergibt eine spielbare Sessionbasis

## 12. Block 8 - UI, Accessibility und Abschlussqualitaet

Prioritaet: P2

### Umsetzung

- bestehende Design-Tokens konsolidieren
- Host-Kontrollzentrum fuer Desktop optimieren
- Spieleransicht bei 360, 390, 768 und 1440 Pixel pruefen
- Beameransicht bei 1280x720, 1920x1080 und 4K pruefen
- Tastaturbedienung, Fokus, Labels, Live-Regionen und Kontrast pruefen
- Lade-, Leer-, Fehler- und Offline-Zustaende vereinheitlichen
- alte Debugseiten und `serverOLD.js` aus dem Produktivpfad entfernen oder klar archivieren
- README auf den realen Stand aktualisieren

### Abnahme

- keine Ueberlaeufe oder verdeckten Controls in den Zielaufloesungen
- kritische Aktionen sind per Tastatur erreichbar
- Statuswechsel werden fuer assistive Technologien verstaendlich angesagt
- keine Browser-Konsolenfehler im kompletten Referenzlauf

## 13. Testmatrix fuer den Gesamtabschluss

### Rollen und Rechte

- Spieler, Host und Display erhalten nur rollenbezogene Daten und Aktionen
- gefaelschte Rollen und fremde Tokens werden abgelehnt

### Session-Lifecycle

- Oeffnen, Join, Start, alle Fragenphasen, Endergebnis, Schliessen
- unbekannte PIN, geschlossene PIN, Spaetbeitritt, Kick und Unban

### Fragetypen

- Single Choice, Multiple Choice, True/False und Freitext
- korrekte, falsche, leere, doppelte und verspaetete Abgabe

### Persistenz

- Antworten, Millisekundenzeiten, Punkte, Reviews und Ranking
- Reload und Node-Neustart in jeder relevanten Phase

### Darstellung

- Spieler Mobile/Desktop, Host Desktop und Beamer
- Ergebnisansichten und Endranking

### Betrieb

- Windows/XAMPP als Entwicklungsumgebung
- Debian/Apache/MariaDB/systemd als Zielbetrieb

## 14. Konkreter Startpunkt

Die Umsetzung beginnt mit Block 0 und Block 1 in einem zusammenhaengenden Arbeitszug:

1. Test-Harness auf festen IPv4-Testhost und isolierte Testdaten umstellen.
2. Workflowtest fachlich auf vorhandene Sessions ausrichten.
3. Unbekannte PINs im Join-Pfad strikt ablehnen.
4. Sessionerzeugung ueber PHP gegen PIN-Kollisionen absichern.
5. automatisierte Negativtests ergaenzen.
6. Browser-Abnahme fuer gueltige und ungueltige PIN durchfuehren.

Erst wenn dieses Gate gruen ist, beginnt Block 2 mit der Host-Autorisierung.

## 15. Definition of Done fuer den Zielstand

Quizzy gilt fuer den vorgesehenen Live-Einsatz als belastbar, wenn:

- kein Client ohne gueltige Sessionidentitaet teilnehmen kann
- nur ein authentifizierter Host den Ablauf mutieren kann
- alle vier Fragetypen vollstaendig ueber die UI pflegbar und spielbar sind
- Freitextbewertung transaktional, idempotent und korrigierbar ist
- alle Rollen nach Reload oder Node-Neustart den korrekten Zustand erhalten
- manueller und automatischer Ablauf dasselbe persistierte Zustandsmodell verwenden
- der komplette Testlauf automatisiert gruen ist
- der Referenz-Browserlauf ohne Konsolen- oder Darstellungsfehler besteht
- eine frische Debian-Installation anhand der Dokumentation erfolgreich funktioniert