# Quizzy - Projektfortschritt

Letzte Aktualisierung: 2026-10-30

Dieses Dokument ist das laufende Fortschrittsjournal. Es wird nach jedem abgeschlossenen oder blockierten Arbeitspaket aktualisiert.

Aktuelle Chat-Uebergabe: `docs/uebergabe-status-2026-10-30.md`

Detailgrundlagen:

- `docs/analyse-soll-ist-2026-09-30.md`
- `docs/konkreter-umsetzungsplan-2026-09-30.md`
- `docs/arbeitspakete-autonome-umsetzung-2026-09-30.md`

## 1. Gesamtstatus

Status: MVP mit belastbarem Kernablauf, vor Produktionsreife

Naechster Produktblock: Featureentwicklung auf Basis der lokal geprueften Grossrundenansichten; Debian-Abnahme bleibt zurueckgestellt

AP-11A ist abgenommen. Die lokale AP-12-lite-Vorbereitung ist abgeschlossen: WSS-URL, begrenzter MySQL-Verbindungspool und Debian-Vorlagen sind umgesetzt und lokal geprueft. Die reale Debian-Abnahme, versionierte Migrationen und Backup/Restore bleiben offen.

| Bereich | Status | Kurzstand |
|---|---|---|
| Live-Quiz-Grundablauf | erledigt | Lobby, Frage, gesperrte Optionen, Antwort, Loesung und Ende funktionieren |
| Single Choice | erledigt | Browserlauf mit zwei Spielern validiert |
| Exakte Antwortzeit | erledigt | serverseitige Millisekundenmessung und DB-Persistenz validiert |
| Loesungsgeheimnis | erledigt | keine Korrektheitsdaten vor `solution` |
| Automatischer Ablauf | erledigt | alle Phasen konfigurierbar; Skip, Reload, Neustart und Gesamtzyklus abgenommen |
| Live-Antworttracking | erledigt | Host sieht Live-Aggregate; Displayfreigabe ist hostgesteuert und zeigt Korrektheit erst ab Schwelle `n` |
| Reconnect/Persistenz | lokal geprueft | laufende Phasen und Endstand fuer bisherige Spieler, autorisierte Hosts und Displays nach Reload und Node-Neustart |
| Freitextbewertung | erledigt | Teilpunkte, Kommentare und idempotente Korrekturen abgenommen |
| Antwort-/Ergebnisfundament | erledigt | kanonische, atomare Antwortpersistenz und DB-abgeleitete Summen |
| Admin-Editor | erledigt | vier Typen ohne Roh-JSON inklusive CRUD und Sortierung pflegbar |
| Fragetyp-Registry | erledigt | vier Basistypen und Erweiterungsvertrag zentralisiert |
| Frage- und Bildantworten | erledigt | sichere Uploads, gemischte Bildoptionen und Rollenrendering abgenommen |
| WebSocket-Autorisierung | erledigt | Host-Token, zentraler Eventschutz und Reconnect abgenommen |
| Grossrunden | lokal geprueft | Simulator, begrenzte Listen und Beamerpaginierung mit 100 Bots und einem echten Spieler getestet |
| Ergebnisphase | lokal geprueft | synchrone Aufloesung, Richtig/Falsch-Diagramm, Rundenplatz, hostgesteuerte Gesamtstandsfreigabe, animiertes Balkenranking |
| Debian/WSS-Betrieb | teilweise vorbereitet | WSS-Client und Apache/systemd-Vorlagen vorhanden; frische Debian-Abnahme offen |
| Gesamttests | erledigt | vollstaendige Regression: 68/68 Node-Tests gruen |

## 2. Erledigte wichtige Schritte

### Session und Bedienfluss

- PHP-Hinweis durch fehlenden POST-Index beseitigt
- Spieler-Lobby nach Join ohne zweites Loginformular
- `Quiz oeffnen` und `Quiz starten` fachlich getrennt
- manuelle Phasen `question`, `options`, `answer`, `solution` umgesetzt
- Host kann Phasen manuell weiterschalten
- Session kann geschlossen werden und alle Rollen erhalten den Abschluss
- Kick- und Sperrlisten-Grundlagen vorhanden

### Automatik und Timing

- automatische Phasensteuerung implementiert
- absolute Browser-Countdowns statt driftender Dekrement-Timer
- explizite serverseitige Antwortdeadline
- Antwortzeit wird ausschliesslich serverseitig berechnet
- `answer_time_ms` wird millisekundengenau persistiert
- Host kann automatische Phasen weiterhin manuell ueberspringen

### Loesung und Fairness

- oeffentliche Fragenpayloads enthalten keine Loesungsfelder
- `player_answered` verraet keine Korrektheit
- eigene Korrektheit erscheint erst in der synchronen Loesungsphase
- ausgewaehlte Antwort ist vor Loesung nur als pending markiert
- falsche Auswahl wird in der Loesung rot, richtige Antwort gruen

### Persistenz und Reconnect

- Sessionstatus und Fragenindex werden gespeichert
- Spieler besitzen persistente Tokens
- Antworten, Zeiten, Korrektheit und Punkte werden gespeichert
- Fragen koennen nach Node-Neustart wieder geladen werden
- Reconnect fuer Spieler, Host und Display einschliesslich Endstand vorhanden; Spieler benoetigen ihr bisheriges Browser-Token

### Oberflaeche

- Player- und Praesentationssicht im Quizduell-/Quizshow-Kachelstil
- Desktop 2x2-Antwortlayout und mobile Einspaltenansicht
- nicht-modale WebSocket-Verbindungsrueckmeldung
- Praesentation zeigt in der Loesungsphase genau die richtige Antwort

### Dokumentation und Planung

- Soll-Ist-Analyse erstellt
- konkreter Umsetzungsplan erstellt
- Bildfragen, Bildantworten und Erweiterungsvertrag fuer eigene Fragetypen eingeplant
- autonome Arbeitspakete mit Gegentests definiert

## 3. Frueherer Browser-Abnahmenachweis

Session: `774488`

Rollen:

- ein Spielleiter
- zwei getrennte Spieler: Anna und Ben
- eine Praesentationsansicht

Abgeschlossene Fragen: 3

| Frage | Anna | Ben |
|---|---|---|
| 16 Bundeslaender | richtig, 81 Punkte, 6271 ms | falsch, 6751 ms |
| Hauptstadt Baden-Wuerttemberg | falsch, 12538 ms | richtig, 62 Punkte, 12816 ms |
| Fluss durch Koeln | richtig, 78 Punkte, 7447 ms | richtig, 58 Punkte, 14111 ms |

Endstand nach drei Fragen:

1. Anna: 159 Punkte
2. Ben: 120 Punkte

Validiert:

- zwei echte Spieleridentitaeten
- Fortschritt jeweils `2/2`
- keine vorzeitige Bewertung
- korrekte Farbzustaende in der Loesungsphase
- Praesentation synchron
- Zeitabhaengige Punkte plausibel
- sauberer Abschluss in allen Rollen
- keine Browserfehler im Abnahmelauf

## 3a. Grossrunden-Nachweis

- Lokaler Lauf mit 100 simulierten und einem echten Spieler; in jedem der vier Fragetypen 100 akzeptierte Antworten.
- Host zeigte bei der ersten Frage `100/101`, `25 richtig`, `75 falsch`; der nicht antwortende Spieler blieb im Ranking.
- Suche auf Host und Mobilgeraet fand den urspruenglichen Listenindex `101`. Es wurden gleichzeitig hoechstens fuenf Beitrittsmeldungen angezeigt.
- Das Beamer-Gesamtranking zeigte maximal zehn Zeilen mit Seitensteuerung; in den getesteten Fensterhoehen blieb die Rangliste im sichtbaren Bereich.
- Nach echtem Node-Neustart und Reload waren 101 Spieler und offene Freitextreviews wiederhergestellt. Die persoenliche Platzierung blieb bei erneutem Reconnect stabil.
- Eine Freitextbewertung nach Quizende aktualisierte die Platzierung des noch verbundenen Spielers sichtbar von `77/101` auf `78/101`.
- Spieler- und Display-Trennungsmeldungen enthalten keine Host-Vorschau mit Loesungsdaten; fuer Hosts bleibt die Vorschau erhalten.
- Der lokale Test belegt weder Performance unter realen Netzbedingungen noch Debian/WSS, 100 echte Endgeraete oder vollstaendige Barrierefreiheit.

## 3b. Endstand-Wiederherstellung

- Bisherige Spieler mit ihrem gespeicherten `quizzy_player_token_<PIN>`, autorisierte Hosts und Displays koennen beendete Sessions nach Browser-Reload und echtem Node-Neustart wieder oeffnen. Ein gleicher Name ohne das bisherige Token berechtigt nicht; neue Spieler bleiben ausgeschlossen.
- Ein Host-Reconnect prueft den aktuellen Token-Hash aus der Datenbank, auch wenn ein anderer Admin den Host-Token zwischenzeitlich erneuert hat. Der Tokenwechsel wurde automatisiert und im Browser geprueft.
- Das Endranking umfasst auch Nichtantwortende und bleibt bei Gleichstaenden stabil. Die persoenliche Platzierung wird nur dem jeweiligen Spieler gesendet. Host-Entfernen und Freigabe sind nach Quizende deaktiviert.
- Lobby-Abgaenge werden dauerhaft entfernt; Reconnects warten auf noch ausstehende Spielerloeschungen und eigene Antwortspeicherungen.
- Angenommene Antworten werden vor Loesung und Abschluss fertig verarbeitet. Konkurrierende Steuerungsaktionen fuer Phasenwechsel und Quizende werden waehrend eines Phasenwechsels sichtbar abgelehnt. Fehlschlaege beim Speichern des Abschlusszustands und beim Laden der Ergebnisse werden gemeldet; ein erneuter Abschlussversuch bleibt moeglich.
- Lokaler Browserlauf mit 100 Bots und einem echten Spieler: 101/101 Antworten auf eine Frage, 101 Rankingzeilen bei Host und Spieler, Beamer mit zehn Zeilen pro Seite und elf Seiten. Nach Node-Stop/Start und Reload blieb die persoenliche Platzierung `26/101` erhalten.
- Nachtraegliche Freitextbewertungen aktualisieren verbundene Endstandsansichten und werden beim spaeteren Reconnect geladen. Ein Wechsel des Geraets oder das Loeschen des Browser-Tokens verhindert derzeit die Spieler-Wiederherstellung.
- Keine Last-, Debian-/WSS-, Mehrgeraete- oder vollstaendige Accessibility-Abnahme.

## 3c. Ergebnisphase

- Korrektheit und Punkte erscheinen fuer Spieler erst synchron nach Zeitablauf oder manuellem Ende der Antwortphase.
- Spieler: Ergebniskarte mit hochzaehlenden Punkten, eigener Rundenplatz, Balkendiagramm Richtig/Falsch/Keine Antwort mit Markierung der eigenen Kategorie. Gesamtstand nur nach Hostfreigabe (`Top 10 zeigen`, `Gesamtstand zeigen`) und nach Quizende; `Loesung & Runde` blendet ihn wieder aus.
- Beamer: Stimmbalken in den Antwortkacheln, Rundenuebersicht, schnellste Punktesammler, animiertes Balkenranking mit Medaillen, Rundenzuwachs und Positionswechseln, Konfetti bei Top-3-Ansichten und im Finale. Host: Rundenuebersicht.
- Behoben: `playerResult` beim Reconnect ohne Fragepruefung, permanent sichtbarer Gesamtstand fuer Spieler, unlesbare helle Beamer-Ergebnisflaeche, fehlende eigene Zeile bei Top 10 unterhalb Platz 10, zu stark gekuerzte Namen auf schmalen Handys.
- Browserlauf mit 60 Bots plus einem echten Spieler ueber richtige und falsche Antwort, Top 10, Gesamtstand mit sieben Beamerseiten, Reload in der Loesungsphase und Quizende. Beamer nur bei etwa 1000 px Breite visuell geprueft.

## 4. Automatisierte Testnachweise

Aktueller Gesamtstand: 68 von 68 Node-Tests bestanden, darunter neue Tests fuer Rundenstatistik, Rundenplatz, Trend und Freigaberegel (`round-results.test.js`) sowie fuer die Darstellungsbausteine (`result-visuals.test.js`). Bisher enthalten sind elf Integrationstests fuer die Endstand-Wiederherstellung, beide Abschlusszustaende, alle Rollen, Host-Tokenwechsel, Reviews, konkurrierende Antworten und Phasenwechsel, Socket-Abbruch sowie simulierte Schreib- und Ladefehler. JavaScript- und PHP-Syntaxchecks der betroffenen Dateien bestanden; die eigenen Test-Fixtures wurden entfernt.

Frueherer fokussierter Nachweis:

- Antwort nach Deadline wird abgelehnt
- Antwortdauer als exakte ganzzahlige Millisekundendifferenz
- oeffentliche Frage enthaelt keine Loesungsfelder
- `4079 ms` bleibt beim MySQL-Roundtrip unveraendert
- Frage wird aus der Datenbank geladen

Ergebnis des fokussierten Laufs: 5 von 5 Tests bestanden.

AP-00-Nachweis:

- Serverimport startet keinen WebSocket-Server mehr implizit
- isolierter Server startet explizit auf `127.0.0.1` mit ephemerem Port
- Workflowtests verwenden persistierte sechsstellige Test-Sessions
- Test-Fixtures entfernen Antworten, Reviews, Ergebnisse, Spieler und Sessions
- zwei direkt aufeinanderfolgende Gesamtlaeufe: jeweils 8 von 8 Tests bestanden
- nach beiden Laeufen verbliebene Test-Sessions: 0
- keine `EADDRINUSE`-, `ECONNREFUSED`- oder offenen Handle-Fehler

AP-02-Nachweis:

- sessionspezifisches Host-Token; nur SHA-256-Hash in der Datenbank
- fehlendes, falsches und fremdes Token werden abgelehnt
- Spieler kann durch `role: host` keine Hostaktion ausloesen
- alle mutierenden Hostevents verwenden dieselbe Socket-Autorisierung
- Gesamt-Testlauf: 16 von 16 Node-Tests bestanden
- PHP-Syntaxchecks fuer Dashboard, Hoststeuerung und Logout bestanden
- Browserlauf: legitimer Host startet Quiz und stellt Phase nach Reload wieder her
- Token erscheint weder in der Host-URL noch in Serverlogs; Rohpayload-Logging entfernt und automatisiert geprueft

AP-03-Nachweis:

- `session_answers` ist die kanonische Quelle fuer Punkte und Zaehler
- parallele Doppelabgabe erzeugt genau eine Antwort und eine Wertung
- Spielerstand und `session_results` werden atomar aus Antworten aggregiert
- Reparaturfunktion rekonstruiert abweichende Summen aus den Einzelantworten
- aktuelle Antwort wird nach frischem Sessionladen vollstaendig wiederhergestellt
- Antwortzeit `4079 ms` bleibt bei Persistenz und Wiederherstellung exakt
- Gesamt-Testlauf: 17 von 17 Node-Tests bestanden
- fokussierter Transaktions- und Workflowlauf nach Identitaetstrennung: 4 von 4

AP-04-Nachweis:

- Reviewdaten speichern Punkte, Kommentar, Bewerter und Millisekunden-Zeitpunkt
- Ganzzahlige Punkte werden serverseitig auf `0..points_max` begrenzt
- Vollwertung, Teilwertung und Abwertung aktualisieren dieselbe kanonische Antwort
- identische und parallele Bewertungen erzeugen keine Doppelzaehlung
- Antwort, Spielerstand und Ergebnisaggregation werden in einer Transaktion aktualisiert
- Ranking und persoenliche Spielerbewertung werden unmittelbar synchronisiert
- Browsermaske mit Punktefeld, Kommentar und Schnellaktionen ohne horizontalen Ueberlauf
- Gesamt-Testlauf: 18 von 18 Node-Tests bestanden

AP-05-Nachweis:

- zentrale Registry fuer `single_choice`, `true_false`, `multiple_choice` und `short_text`
- ein Vertrag fuer Editor-Metadaten, Normalisierung, Validierung, Bewertung und Loesung
- oeffentliche Payloads werden typzentral von Loesungsfeldern bereinigt
- Reviewverhalten wird aus der Typdefinition statt aus Router-Sonderfaellen gelesen
- unbekannte Typen werden im Node-Lader und PHP-Editor kontrolliert abgelehnt
- Referenztyp wird ohne Aenderung am zentralen Router registriert und ausgewertet
- authentifizierter Browser-POST: HTTP 422, Fehlermeldung sichtbar, kein Datensatz angelegt
- Gesamt-Testlauf: 21 von 21 Node-Tests bestanden

AP-06-Nachweis:

- typspezifische Editorfelder ersetzen Index- und Roh-JSON-Eingaben
- Auswahloptionen und Korrektmarkierungen werden transaktional gespeichert
- Wahr/Falsch besitzt genau zwei feste Optionen; Freitext eine Antwortliste
- Create/Read/Delete-Roundtrip fuer alle vier Basistypen im Browser bestanden
- Update auf Multiple Choice, Duplizieren, Umbenennen und Sortieren bestanden
- ungueltige Eingabe liefert HTTP 422, behaelt Werte und erzeugt keinen Datensatz
- kompletter Browserlauf mit Host, Anna, Ben und Praesentation ueber alle vier Typen
- jeder Spieler mit vier Antworten; Freitextreview abgeschlossen; synchrones Endergebnis
- Endstand des Abnahmelaufs: Anna 259 Punkte, Ben 0 Punkte
- PHP-Syntax und Diagnosen sauber; Gesamt-Testlauf 21 von 21 bestanden

AP-07-Nachweis:

- Fragebilder sowie Text-, Bild- und gemischte Antwortoptionen werden persistent gepflegt
- JPEG, PNG, WebP und GIF bis 5 MB; falscher MIME-Typ und Uebergroesse liefern HTTP 422
- Bildantworten ohne Alternativtext werden abgelehnt und erzeugen keine Datenbankzeile
- Editor besitzt tastaturbedienbare Vollbildvorschau fuer Frage- und Optionsbilder
- Duplikate teilen Medien sicher; Dateien werden erst nach der letzten Referenz entfernt
- Sortierung behaelt Medien und Multiple-Choice-Indizes stabil zusammen
- Browserlauf mit Host, Spieler und Praesentation ueber alle drei Medienszenarien
- keine Korrektheitsmarkierung vor `solution`; Bildantwort-Loesungen verwenden Alttext
- Mobil `390x844` und Beamer `1920x1080` ohne horizontalen Ueberlauf
- Testfragen, Uploads und temporaere Dateien nach Abnahme vollstaendig entfernt
- PHP-Syntax und Diagnosen sauber; Gesamt-Testlauf 22 von 22 bestanden

AP-08-Nachweis:

- persistierte Zustandskante `lobby -> start -> question`; erst der neue Host-Weiter-Event laedt Frage 1
- eigene Startansicht fuer Player, Host und Display ohne Frage, Bild oder Antwortoptionen
- Antworten und spaetere Phasenaktionen koennen `start` nicht ueberspringen
- neues Hostevent verwendet dieselbe zentrale Socket-Autorisierung; Spielerfaelschung wird abgelehnt
- Node-Stop/Start verwirft den Arbeitsspeicher; alle drei Rollen stellen danach `start` mit `question: null` wieder her
- Browser-Reload jeder Rolle bleibt in `start`; manueller Weiter-Button gibt anschliessend synchron Frage 1 frei
- Mobil `390x844` und Beamer `1920x1080` ohne horizontalen Ueberlauf
- Testsitzung `521372` nach Abnahme geschlossen
- PHP-Syntax und Diagnosen sauber; Gesamt-Testlauf 22 von 22 bestanden

AP-09-Nachweis:

- Host steuert persistiert `solution`, `top10`, `ranking` und `free_text` auf dem Beamer
- Display-Reconnect stellt die aktuelle Beameransicht wieder her
- lokale Player-Tabs fuer Loesung, Top 10 und Ranking senden kein Beamerereignis
- Freitext wird nur nach expliziter Hostfreigabe und ausschliesslich als anonymer Antworttext uebertragen
- Fragenstatistik wird aus kanonischen Einzelantworten aggregiert: Antworten, Treffer, Durchschnittszeit und Punkte
- Host-Beenden ist immer sichtbar; Abschluss aus `lobby`, `start`, `question`, `options`, `answer` und `solution` getestet
- Teilnehmerupdates waehrend aktiver Phasen ersetzen weder Player- noch Displayansicht durch die Lobby
- Browserlauf mit Host, Player und Display: alle Sichtwechsel, Player-Unabhaengigkeit, Display-Reload und Abschluss bestanden
- Mobil `390x844` und Beamer `1920x1080` ohne horizontalen Ueberlauf
- Testsitzung `413634` durch Hostabschluss geschlossen
- PHP-/JS-Syntax und Diagnosen sauber; Gesamt-Testlauf 24 von 24 bestanden

AP-10-Nachweis:

- absolute Start- und Deadline-Zeitpunkte fuer zeitgesteuerte Phasen persistent gespeichert
- Restzeit wird nach Reload und Node-Neustart aus der urspruenglichen Deadline statt aus der vollen Phasendauer berechnet
- automatische `answer`- und `solution`-Transition wird nach Neustart genau einmal wiederhergestellt
- bereits abgegebene Antwort bleibt mit Auswahl, Zeit und Punkten erhalten und fuer erneute Abgabe gesperrt
- echter Server-Stop/Start im Workflow fuer `start`, `answer` und `solution` mit Reconnect von Host, Spieler und Display
- Browser-Reload aller drei Rollen in `lobby`, `start`, `question`, `options`, `answer` und `solution`
- persistierte Beameransicht `ranking` nach Reload; Spielerloesung wird nach Vollreload rekonstruiert
- Mobil `390x844` und Beamer `1920x1080` ohne horizontalen Ueberlauf oder Browserfehler
- Testsitzung `974535` nach Abnahme durch Hostabschluss geschlossen
- JavaScript-Syntax und Diagnosen sauber; Gesamt-Testlauf 26 von 26 bestanden

AP-11A-Nachweis:

- Host-Aggregate fuer Abgaben, richtig, falsch und offene Freitextbewertungen aktualisieren live
- Freitextreviews verschieben Antworten von `offen` nach `richtig` oder `falsch`; der Host erhaelt das Update sofort
- Displayfreigabe und Schwelle sind persistiert und hostautorisiert; Spieler koennen sie nicht manipulieren
- Displaypayloads blenden Korrektheitsaggregate unterhalb der Schwelle auch auf Protokollebene aus
- Schwellen `1` und `10`, unterhalb/exakt an der Grenze, Deaktivierung und Freitextreview durch Tests abgedeckt
- neuer Fragewechsel setzt Host- und Displayaggregate auf null
- Browserlauf mit Host, zwei getrennten Spielern und Display: bei `1/2` nur Fortschritt, bei `2/2` anonyme Werte; Abschalten blendet die Anzeige aus und leert die Werte
- Display-Reload stellt den freigegebenen Snapshot wieder her; Node-Stop/Start stellt Einstellung und schwellenreduzierte Aggregate fuer Host und Display wieder her
- Cache-Key von `public/js/app.js` fuer Host, Lobby und Display angehoben
- JavaScript- und PHP-Syntax sauber; vollstaendige Node-Suite 32 von 32 bestanden

## 5. Aktuelle Risiken

| Prioritaet | Risiko | Behandlung |
|---|---|---|
| erledigt | beliebiger Client konnte sich als Host ausgeben | durch AP-02 behoben |
| erledigt | unbekannte PIN konnte in Fallbackpfade geraten | durch AP-01 behoben |
| erledigt | Freitextreview konnte Punkte doppelt addieren | durch AP-04 behoben |
| erledigt | Reconnect und Node-Neustart nicht systematisch abgenommen | durch AP-10 behoben |
| erledigt | Admin-Editor erzeugte nicht alle Typen komfortabel | durch AP-06 behoben |
| erledigt | Bildantworten besassen kein Datenmodell | durch AP-07 behoben |
| P1 | produktiver HTTPS-/WSS-Betrieb nicht fertig | AP-12 |
| erledigt | Reconnect nach bereits beendetem Quiz nicht moeglich | Endstand lokal wiederherstellbar; Spieler benoetigen das urspruengliche Browser-Token |
| offen | Dashboard-Abschluss wird durch den Node-Monitor zeitversetzt uebernommen | periodischer Abgleich etwa alle zwei Sekunden, keine transaktionale Sofortuebernahme |
| offen | Grossrunden unter realen Geraete-, Netzwerk- und Lastbedingungen nicht abgenommen | AP-13 sowie spaetere Debian-/Lastpruefung |
| offen | Ergebnisdetails enthalten nur Spieler mit gespeicherten Antworten | von vollstaendigem Ranking unterscheiden |

## 6. Arbeitspaket-Tracking

| ID | Status | Begonnen | Abgeschlossen | Testnachweis | Bemerkung |
|---|---|---|---|---|---|
| AP-00 | abgenommen | 2026-09-30 | 2026-09-30 | 2 x 8/8 Node-Tests; 0 Fixture-Sessions | expliziter Server-Lifecycle und isolierte DB-Fixtures |
| AP-01 | abgenommen | 2026-09-30 | 2026-09-30 | 12/12 Node-Tests; alle PHP-Syntaxchecks; Browser positiv/negativ | keine Fallback-Session, kollisionssichere PIN, stabiler Abschluss-Broadcast |
| AP-02 | abgenommen | 2026-09-30 | 2026-09-30 | 16/16 Node-Tests; PHP-Syntax; Browser Hostaktion/Reload | Host-Token und zentrale Eventautorisierung |
| AP-03 | abgenommen | 2026-09-30 | 2026-09-30 | 17/17 Node-Tests; Parallelabgabe; Reparatur; Neustart | kanonische Antworten und Ergebnisse |
| AP-04 | abgenommen | 2026-09-30 | 2026-09-30 | 18/18 Node-Tests; Parallelreview; Browsermaske | Teilpunkte und differenzbasierte Neubewertung |
| AP-05 | abgenommen | 2026-09-30 | 2026-09-30 | 21/21 Node-Tests; PHP-Syntax; Browser 422 | zentrale Typvertraege und sichere Payloads |
| AP-06 | abgenommen | 2026-09-30 | 2026-09-30 | 21/21 Node-Tests; CRUD je Typ; Zwei-Spieler-Browserlauf | typspezifische Editorfelder und Optionspflege |
| AP-07 | abgenommen | 2026-09-30 | 2026-09-30 | 22/22 Node-Tests; Upload-Gegentests; Rollen-/Responsive-Browserlauf | Fragebilder, Bildoptionen und Medienvalidierung |
| AP-08 | abgenommen | 2026-09-30 | 2026-09-30 | 22/22 Node-Tests; Neustart/3-Rollen-Sync; Responsive-Browserlauf | persistenter Startzustand zwischen Lobby und Frage |
| AP-09 | abgenommen | 2026-09-30 | 2026-09-30 | 24/24 Node-Tests; Rollen-/Reconnect-/Responsive-Browserlauf | persistente Ergebnisregie und anonyme Freitextfreigabe |
| AP-10 | abgenommen | 2026-09-30 | 2026-09-30 | 26/26 Node-Tests; echter Stop/Start; Rollen-/Phasen-/Responsive-Browserlauf | persistente Deadlines und vollstaendige Wiederanlauf-Snapshots |
| AP-11 | abgenommen | 2026-09-30 | 2026-09-30 | 27/27 Node-Tests; PHP/Diagnosen; Browserzyklus und echter Node-Neustart | konfigurierbare Automatik und Skip-Matrix |
| AP-11A | abgenommen | 2026-09-30 | 2026-10-30 | 32/32 Node-Tests; PHP-/JS-Syntax; Browser Host/2 Spieler/Display; Display-Reload und Node-Neustart | Live-Aggregate, Reviewupdates, Schwellenredaktion und Fälschungsschutz |
| AP-12-lite | abgenommen | 2026-10-30 | 2026-10-30 | 36/36 Node-Tests; PHP-/JS-Syntax; lokale Browserverbindung ueber HTTP/WebSocket | WSS-Clientpfad, begrenzter DB-Pool sowie Apache/systemd-Vorlagen |
| Grossrunden lokal | abgenommen | 2026-10-30 | 2026-10-30 | 50/50 Node-Tests; Browserlauf 100 Bots plus ein Spieler; Neustart/Review | keine Last-, Mehrgeraete- oder Debian-Abnahme |
| Endstand-Wiederherstellung | lokal geprueft | 2026-10-30 | 2026-10-30 | 61/61 Node-Tests; Browserlauf mit 101 Spielern, Reload und Node-Neustart | Token an bisheriges Browserprofil gebunden |
| Ergebnisphase | lokal geprueft | 2026-10-31 | 2026-10-31 | 68/68 Node-Tests; Browserlauf 60 Bots plus ein Spieler, Reload, Quizende | Beamer 1920 px und echte Geraete noch nicht visuell abgenommen |
| AP-12 Debian | zurueckgestellt | - | - | - | Debian-Installation, WSS-Ende-zu-Ende, Migrationen und Backup/Restore ausstehend |
| AP-13 | geplant | - | - | - | Abschlussblock |

Statuswerte:

- `geplant`: Abhaengigkeiten noch nicht erfuellt
- `bereit`: kann ohne weitere Entscheidung gestartet werden
- `in Arbeit`: Umsetzung laeuft
- `blockiert`: konkreter externer oder fachlicher Blocker dokumentiert
- `zurueckgestellt`: bewusst auf ein spaeteres Zeitfenster verschoben
- `abgenommen`: Implementierung und alle Paket-Gates bestanden

## 7. Naechster konkreter Schritt

1. Featureentwicklung fortsetzen; bei betroffenen Aenderungen den Simulator und Grossrundenansichten erneut pruefen.
2. Unterschiedliche Anzahl in Antwortdetails und Gesamtranking mit Nichtantwortenden fachlich bewerten und gegebenenfalls verdeutlichen.
3. AP-13 lokal mit Geraetematrix und Accessibility vorbereiten.
4. Spaeter AP-12 Debian-Abnahme samt Migrationen, Backup/Restore sowie Last- und Langzeittests nachholen.
5. AP-13 danach mit kompletter Regression abschliessen.