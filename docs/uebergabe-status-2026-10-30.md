# Quizzy - Uebergabe und Status quo

Stand: 2026-10-30

Diese Datei ist der Einstiegspunkt fuer einen neuen Chat. Sie trennt abgenommene Funktionen klar von den noch offenen Produktions- und Abschlussarbeiten.

## 1. Kurzstatus

- AP-00 bis AP-11A sowie AP-12-lite sind abgenommen.
- Simulator und Grossrundenansichten sind lokal umgesetzt und mit 100 Bots plus einem echten Spieler geprueft.
- Der Endstand wird fuer bisherige Spieler, autorisierte Hosts und Displays nach Reload und Node-Neustart wiederhergestellt.
- Neue Ergebnisphase: synchrone Aufloesung mit Punkten, Richtig/Falsch-Diagramm, Rundenplatz und vom Host freigegebenem Gesamtstand als animiertes Balkenranking (siehe 2d).
- Aktuelle vollstaendige Node-Test-Suite: 68 von 68 Tests bestanden.
- AP-11 wurde mit PHP-Syntax, Diagnosen, komplettem Automatikzyklus und echtem Node-Neustart im Browser abgenommen.
- AP-11A wurde mit Vertragstests, Browserlauf mit Host/zwei Spielern/Display sowie Display-Reload und Node-Neustart abgenommen.
- WSS-Client, DB-Pool und Debian-Vorlagen sind lokal geprueft.
- Debian-Abnahme ist zurueckgestellt; die Featureentwicklung kann auf dem lokal geprueften Grossrundenstand weitergehen.
- Der Git-Worktree ist umfangreich geaendert und nicht committed. Nichts ungeprueft zuruecksetzen.

## 2. Abgenommener Produktstand

Der belastbare Stand umfasst:

- authentifizierte Hosts mit sessionspezifischem Token und zentraler WebSocket-Autorisierung
- strikte Session-/PIN-Integritaet ohne Demo-Fallback
- persistente Phasen `lobby`, `start`, `question`, `options`, `answer`, `solution`, `endresult`
- manuelle und automatische Quizsteuerung
- konfigurierbare Automatikdauern fuer alle Phasen
- persistente absolute Deadlines und genau-einmal-Wiederanlauf nach Node-Neustart
- kanonische, atomare Antworten in `session_answers`
- idempotente Ergebnisse, Teilpunkte und Freitextreviews
- zentrale Registry fuer vier Fragetypen
- Admin-CRUD fuer Fragen und Optionen
- Fragebilder sowie Text-, Bild- und gemischte Antwortoptionen
- Hostregie fuer Loesung, Top 10, Gesamtranking und anonymen Freitext
- Reconnect von Host, Spieler und Display waehrend laufender Sessions und nach Quizende; nach Quizende duerfen nur bereits bekannte Spieler mit ihrem bisherigen Token zurueckkehren
- responsive Player-, Host- und Praesentationsansichten
- Grossrundenansichten mit Suche, begrenzten Listen, persoenlicher Platzierung und paginiertem Beamer

Details und Nachweise stehen in `docs/projektfortschritt.md`.

## 2a. AP-12-lite - lokal abgenommen

- HTTPS-Seiten verwenden `wss://<gleicher-host>/ws`; HTTP-Lokalbetrieb verwendet weiter `ws://WS_HOST:WS_PORT`.
- Der Realtime-Prozess teilt einen konfigurierbaren MySQL-Verbindungspool (`DB_CONNECTION_LIMIT`, Standard `20`).
- Apache- und systemd-Beispielvorlagen liegen in `deploy/`; Details und verbleibende Debian-Gates stehen in `docs/ap12-lite.md`.
- Damaliger Stand: Node-Tests 36/36; JavaScript- und PHP-Syntaxchecks bestanden; lokaler HTTP/WebSocket-Browseranschluss erfolgreich.
- Nicht abgenommen: Debian-Installation, WSS ueber Apache, versionierte Migrationen und Backup/Restore.

## 2b. Grossrunden und Simulator - lokal geprueft

- Der lokale Simulator erzeugt bis zu 100 Testspieler und kann bei allen vier Fragetypen Testantworten senden.
- Host und Spieler bieten Teilnehmersuche und begrenzte, scrollbar bedienbare Listen. Beitrittsmeldungen sind auf fuenf sichtbare Eintraege begrenzt.
- Die persoenliche Platzierung wird nur an den betreffenden Spieler gesendet. Das oeffentliche Ranking enthaelt auch Teilnehmende ohne Antwort; Gleichstaende bleiben ueber Reconnect und Node-Neustart stabil.
- Der Beamer zeigt maximal zehn Rankingzeilen pro Seite, mit Navigation und automatischem Seitenwechsel; Freitextantworten sind ebenfalls seitenweise begrenzt. Das Endergebnis beginnt mit den Top 10.
- Offene Freitextreviews werden bei Host-Reconnect erneut geladen. Bewertungen nach Quizende aktualisieren verbundene Ansichten; ungespeicherte Eingaben bleiben bei laufenden Queue-Updates, aber nicht bei einem Browser-Reload erhalten.
- Trennungsmeldungen enthalten fuer Spieler und Display keine Host-Vorschau mit Loesungsdaten.
- Lokaler Browserlauf: 100 Bots plus ein manueller Spieler, jeweils 100 akzeptierte Antworten in allen vier Fragetypen, Suche bis Listenindex 101, Beamerpaginierung, Node-Neustart und stabile persoenliche Platzierung. Eine nachtraegliche Freitextbewertung aktualisierte die Platzierung nach Quizende.
- Dies ist keine Performance-, Debian-/WSS-, Mehrgeraete- oder vollstaendige Accessibility-Abnahme.

## 2c. Endstand-Wiederherstellung - lokal geprueft

- Beendete Sessions in den Zustaenden `finished` und `endresult` liefern Host, Spieler und Display beim Reconnect das gespeicherte Gesamtranking. Die persoenliche Platzierung geht nur an den jeweiligen Spieler.
- Spieler muessen dasselbe Browser-Token `quizzy_player_token_<PIN>` besitzen. Nach Loeschen der Browserdaten oder auf einem anderen Geraet ist eine Wiederherstellung ohne diesen Token derzeit nicht moeglich; ein gleicher Name reicht nicht. Neue Spieler bleiben nach Quizende ausgeschlossen.
- Ein eingeloggter Admin kann die Hoststeuerung einer beendeten Session erneut oeffnen. Die Host-Token-Pruefung liest den aktuellen Hash aus der Datenbank und funktioniert auch nach einem Tokenwechsel; Teilnehmer koennen nach Quizende nicht mehr entfernt oder freigegeben werden.
- Vor dem Start aus der Lobby ausgeschiedene Spieler werden dauerhaft entfernt. Ein schneller Reconnect wartet auf eine noch laufende Entfernung.
- Bereits angenommene Antworten werden vor Loesung und Quizabschluss fertig gespeichert. Waehrend eines laufenden Phasenwechsels werden konkurrierende Steuerungsaktionen fuer Phasenwechsel und Quizende mit einer sichtbaren Aufforderung zum erneuten Versuch abgelehnt. Schreib- und Ladefehler beim Abschluss werden nicht als erfolgreicher Abschluss ausgegeben.
- Lokaler Browserlauf: 100 Bots und ein echter Spieler, 101/101 Antworten auf eine Frage. Nach Quizende, Reload und echtem Node-Stop/Start zeigten Host und Spieler 101 Rankingzeilen, der Beamer zehn Zeilen pro Seite bei elf Seiten; die persoenliche Platzierung blieb `26/101`.
- Elf Endstand-Integrationstests decken beide Abschlusszustaende, manuellen und natuerlichen Abschluss, Dashboard-Abschluss, alle Rollen, falsche und gewechselte Host-Tokens, Freitext-Nachbewertung, parallele Antworten und Reconnects sowie simulierte Datenbankfehler ab. Der Host-Tokenwechsel wurde zusaetzlich im Browser geprueft.

## 2d. Ergebnisphase - lokal geprueft

- Spieler erhalten bis zum Ende der Antwortphase (Zeitablauf oder manuelles Beenden) nur eine Eingangsbestaetigung, keine Korrektheitsinformation.
- Danach erscheinen synchron: Ergebniskarte (richtig/teilweise/falsch/in Pruefung/keine Antwort) mit hochzaehlenden Punkten, eigener Rundenplatz und ein Balkendiagramm, wie viele richtig, falsch oder gar nicht geantwortet haben (eigene Kategorie markiert). Gleichstaende teilen sich den Rang; Freitext gilt bis zur Bewertung als `in Pruefung`.
- Freigaberegel: Spieler sehen den Gesamtstand nur, wenn der Host `Top 10 zeigen` oder `Gesamtstand zeigen` waehlt, sowie nach Quizende. `Loesung & Runde` blendet ihn wieder aus. Bei Top 10 wird die eigene Zeile auch unterhalb von Platz 10 angehaengt.
- Beamer: Stimmbalken in den Antwortkacheln, Rundenuebersicht und schnellste Punktesammler; Ranking als animierte Balken mit Medaillen, Rundenzuwachs und Positionswechseln (▲/▼); Konfetti bei Top-3-Ansichten und im Finale.
- Host: kompakte Rundenuebersicht im Kontrollzentrum.
- Serverlogik in `realtime-node/round-results.js`, Darstellung in `public/js/result-visuals.js`. Rankingeintraege bleiben `{rank, name, points}`; Trenddaten kommen als separates, indexgleiches `rankingTrend`.
- Behobene Fehler: `playerResult` wurde bei Reconnect ohne Pruefung der Frage gesendet; Spieler sahen den Gesamtstand immer; helle Beamer-Ergebnisflaeche war unlesbar.
- Browserlauf mit 60 Bots und einem echten Spieler: richtige und falsche Antwort, Top 10, Gesamtstand mit Paging (7 Seiten), Rueckkehr zu `Loesung & Runde`, Reload in der Loesungsphase und Quizende. Beamer nur bei etwa 1000 px Breite visuell geprueft.

## 3. AP-11A - Fachlicher Vertrag

Gewuenscht ist Live-Tracking waehrend der Antwortphase:

- Der Host sieht immer live:
  - Gesamtzahl Spieler
  - abgegebene Antworten
  - richtige Antworten
  - falsche Antworten
  - offene Freitextbewertungen
- Der Host kann die Live-Anzeige auf dem Beamer explizit ein- und ausschalten.
- Der Beamer zeigt bei Freigabe sofort `abgegeben/gesamt`.
- Richtig/Falsch/Open wird erst angezeigt, wenn mindestens `n` Antworten vorliegen.
- `n` ist konfigurierbar.
- Einfuehrungswert: `n = 1`.
- Spaeterer Produktivstandard: `n = 10`.
- Bei `n = 1` gibt es keine wirksame Gruppenanonymitaet; dies ist fuer die Einfuehrung bewusst akzeptiert.
- Freitext zaehlt bis zur Hostbewertung als `offen`.
- Beamerpayloads duerfen keine Namen, Player-IDs, Tokens oder Einzelantworten enthalten.

Der Vertrag ist auch in folgenden Dateien dokumentiert:

- `docs/konkreter-umsetzungsplan-2026-09-30.md`
- `docs/arbeitspakete-autonome-umsetzung-2026-09-30.md`
- `docs/projektfortschritt.md`

## 4. Abgenommener AP-11A-Stand

Backend:

- `sessions.live_tracking_enabled`
- `sessions.live_tracking_threshold`
- idempotente Migration in `realtime-node/db.js`
- `utils.buildLiveAnswerStats(session)` aggregiert `total`, `answered`, `correct`, `incorrect`, `pendingReview`
- neues hostautorisiertes Event `host_configure_live_tracking`
- persistierte Freigabe und Schwelle
- `live_answer_stats` nach einer erstmalig persistierten Antwort
- Host erhaelt Aggregate immer
- Display erhaelt Abgabefortschritt nur bei Freigabe; Korrektheitswerte werden unterhalb der Schwelle auch aus dem Payload entfernt
- `correctnessVisible` wird fuer Displays erst bei `answered >= threshold` wahr
- Session-Snapshot enthaelt Live-Aggregate fuer Host und freigegebenes Display
- Freitextreviews senden aktualisierte Aggregate und senken `pendingReview`
- neuer Fragewechsel setzt die Live-Anzeige fuer Host und Display zurueck

Frontend:

- Hostschalter `Live-Antworten auf Beamer zeigen`
- numerisches Schwellenfeld `1..1000`, aktuell mit Wert `1`
- Hostanzeige fuer richtig/falsch/offen
- neues Displaypanel fuer Abgabefortschritt
- Display blendet Korrektheitswerte unterhalb der Schwelle aus
- Reconnect verarbeitet `liveAnswerStats`

Betroffene Dateien:

- `realtime-node/db.js`
- `realtime-node/utils.js`
- `realtime-node/server.js`
- `realtime-node/quiz.js`
- `realtime-node/lobby.js`
- `public/host_control.php`
- `public/display.php`
- `public/js/app.js`

## 5. Exakter Validierungsstand

- Aktuelle vollstaendige Node-Suite nach Ergebnisphase: 68/68 bestanden.
- Endstand-Browserlauf mit 101 lokalen Teilnehmern und echtem Node-Neustart; JavaScript- und PHP-Syntaxchecks fuer die betroffenen Dateien bestanden.
- Historischer AP-11A-Stand: 32/32 bestanden.
- Fokussierte Live-, Freitextreview-, Hostautorisierungs- und Restarttests bestanden.
- `node --check` fuer geaenderte JavaScript-Dateien erfolgreich.
- PHP-Lint fuer `host_control.php`, `lobby.php` und `display.php` erfolgreich.
- Browserlauf mit Host, zwei getrennten Spielern und Display:
  - Host sieht sofort `1/2` und `1 richtig`.
  - Display zeigt bei Schwelle `2` unterhalb der Grenze nur `1/2`.
  - Bei `2/2` erscheinen anonym `1 richtig / 1 falsch`.
  - Deaktivierung blendet das Panel aus und setzt Werte auf null.
  - Naechste Frage setzt beide Aggregate auf null.
  - Display-Reload stellt den freigegebenen Snapshot wieder her.
- Separater Node-Stop/Start-Test stellt Freigabe, Schwelle `10` und redigierte Displayaggregate wieder her.
- Responsive-Spotcheck im lokalen Browser ohne horizontalen Ueberlauf bei der getesteten Fensterbreite; die vollstaendige Zielaufloesungsmatrix bleibt AP-13.

## 6. Bekannte offene technische Punkte

- Produktivstandard fuer neue Sessions spaeter von `n = 1` auf `n = 10` umstellen; bestehende Sessions dabei nicht unerwartet aendern.
- AP-12 Debian/WSS ist noch nicht auf einer frischen Debian-Installation abgenommen.
- AP-13 muss die vollstaendige Responsive-, Accessibility- und Browserregression ausfuehren.
- Spieler koennen den Endstand derzeit nur im urspruenglichen Browserprofil mit vorhandenem Player-Token wiederherstellen; ein geraeteuebergreifendes Wiederherstellungsverfahren ist nicht umgesetzt.
- Ein im Dashboard gesetzter Abschluss wird vom Node-Prozess periodisch abgeglichen (Intervall etwa zwei Sekunden), nicht transaktional in Echtzeit uebernommen.
- 100 lokale Bots und ein echter Spieler ersetzen weder einen Test mit vielen realen Geraeten noch Last-, Langzeit- oder Netzwerkausfalltests.
- Die Host-Ergebnisdetails basieren auf gespeicherten Antworten und koennen daher weniger Eintraege als das vollstaendige Ranking mit Nichtantwortenden enthalten.

## 7. Empfohlene naechste Schritte

1. Featureentwicklung fortsetzen und bei betroffenen Ansichten den Simulator fuer grosse Gruppen erneut einsetzen. Ideen fuer die Ergebnisphase: Controlpanel-Option `Gesamtstand automatisch nach jeder/jeder n-ten Runde`, Podiums-Countdown im Finale, optionale Soundeffekte, Beamer-Abnahme bei 1920 px.
2. Den Unterschied zwischen Ergebnisdetails und Gesamtranking mit Nichtantwortenden fachlich bewerten und gegebenenfalls in der Oberflaeche verdeutlichen.
3. Vorbereitende AP-13-Pruefungen fuer Zielaufloesungen, echte Geraete und Accessibility lokal durchfuehren.
4. AP-12 Debian-Gates spaeter nachholen: versionierte Migrationen, systemd, Apache-Reverse-Proxy `/ws`, WSS, Healthcheck, Backup/Restore und Last-/Langzeittests.
5. AP-13 nach AP-12 mit Debugpfaden und kompletter Regression abschliessend abnehmen.

## 8. Startprompt fuer den neuen Chat

> Arbeite anhand von `docs/uebergabe-status-2026-10-30.md` autonom weiter. AP-00 bis AP-11A und AP-12-lite sind abgenommen; Simulator, Grossrundenansichten und Endstand-Wiederherstellung und Ergebnisphase sind lokal geprueft und die Node-Suite steht bei 68/68. Featureentwicklung mit dem Simulator fortsetzen. Debian-/WSS-, Mehrgeraete-, Last- und vollstaendige Accessibility-Abnahme spaeter nachholen. Bestehende Aenderungen erhalten; nicht committen und nichts zuruecksetzen.

## 9. Betriebsnotizen

- Entwicklungsumgebung: Windows/XAMPP
- PHP: `C:\xampp\php\php.exe`
- WebSocket-Port: `8082`
- Tests aus `realtime-node`:
  - `npm.cmd test`
  - alternativ direkt: `node --test --test-concurrency=1 --test-isolation=none tests/*.test.js`
- Simulator aus `realtime-node`, nachdem eine eigene Wegwerf-Session in der Lobby geoeffnet wurde:
  - `node scripts\simulate-players.js --pin 123456 --count 100 --interval-ms 40`
  - Fuer automatische Testantworten `--answer` ergaenzen; `123456` durch die tatsaechliche PIN der eigenen Test-Session ersetzen.
  - Optional `--url ws://localhost:8082` setzen; nur lokale WebSocket-Endpunkte sind erlaubt. Mit `Strg+C` beenden.
  - Simulator-Spieler und Antworten veraendern persistente Daten und werden nicht automatisch geloescht. Ausschliesslich eigene Test-Sessions verwenden. Der Zaehler gesendeter Antworten ist keine Serverbestaetigung; den Host-Fortschritt zur Kontrolle verwenden.
- PowerShell zeigt regelmaessig eine harmlose Execution-Policy-Warnung fuer das Benutzerprofil.
- Sync-Terminals liefern gelegentlich keine Ausgabe; dann eine frische Async-Sitzung verwenden.
