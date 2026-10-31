# Quizzy – Anforderungsbasis und Soll/Ist-Abgleich

## 1. Zielsetzung

Dieses Dokument dient als Grundlage für die weitere Entwicklung von Quizzy. Es fasst die wesentlichen Anforderungen zusammen und ermöglicht einen schnellen Soll-/Ist-Abgleich für die aktuelle Implementierung.

## 2. Projektziel

Quizzy soll ein webbasiertes Live-Quiz-System ermöglichen, bei dem:

- ein Host eine Quiz-Session starten kann,
- ein Host ein vorbereitetes Quiz aus einer Liste auswählt,
- Spieler über eine PIN-Lobby beitreten,
- Fragen verteilt werden,
- Antworten ausgewertet werden,
- nach jeder Frage ein nachvollziehbarer Zwischenstand möglich ist,
- ein Ranking sichtbar wird,
- Admins Quizinhalte pflegen können.

### 2.1 Einsatzkontext

Quizzy ist als Live-Quiz-System für Gruppen gedacht, zum Beispiel für:

- Schule und Unterricht
- Workshops
- Events
- kleine bis mittlere Gruppenformate mit gemeinsamer Moderation

Wichtige Leitidee:

- Der Ablauf muss in einer moderierten Live-Situation schnell verständlich, robust und ohne Seiten-Neuladen benutzbar sein.

## 3. Kernfunktionen

### 3.1 Host-Funktionen
- Quiz aus vorhandener Quizliste auswählen
- Session über PIN erzeugen
- Quiz starten
- Fragen an Spieler verteilen
- Antworten entgegennehmen
- Punkte und Ranking steuern
- Zwischenstände nach Fragen einsehen
- Quiz manuell beenden können

### 3.2 Spieler-Funktionen
- Lobby über PIN betreten
- Name angeben
- Fragen beantworten
- nach jeder Frage Rückmeldung zum eigenen Ergebnis sehen
- Ergebnis und Ranking sehen

### 3.3 Admin-Funktionen
- Quizfragen und Antworten pflegen
- Quiz-Session starten oder vorbereiten
- Inhalte verwalten

### 3.4 Ablauf-Grundregeln

- Sessions arbeiten mit einer 6-stelligen PIN.
- Eine Session gehört immer genau zu einem ausgewählten Quiz.
- Nach jeder Frage gibt es mindestens eine kurze Lösungs- oder Ergebnisphase.
- Am Ende gibt es ein Endranking mit Punkten.
- Der Echtzeit-Ablauf soll ohne Reload während des laufenden Spiels funktionieren.

## 4. Technische Anforderungen

### 4.1 Frontend
- PHP-basierte Seiten für Host, Spieler und Admin
- einfache, robuste Nutzeroberfläche
- klar getrennte Zustände für Lobby, Quizlauf und Ergebnisanzeige

### 4.2 Backend / Echtzeit
- Node.js-WebSocket-Server für Live-Events
- synchronisierte Zustandsübertragung zwischen Host und Spielern
- fehlertolerante Behandlung von Verbindungsabbrüchen

### 4.3 Datenhaltung
- MySQL-Anbindung für Quizdaten und Sessions
- zentrale und saubere Datenstruktur für Fragen, Antworten und Ergebnisse
- Antworten sollen so gespeichert werden können, dass spätere Auswertungen oder Review-Ansichten möglich bleiben

### 4.4 Qualität und Betrieb
- einheitliche Konfiguration
- UTF-8-konforme Verarbeitung
- Sicherheits- und Authentifizierungsmaßnahmen
- Testabdeckung für kritische Quiz- und Scoring-Funktionen

## 5. Soll/Ist-Abgleich (10–15 Punkte)

| Nr. | Soll-Anforderung | Ist-Status | Hinweis |
|---|---|---|---|
| 1 | Host kann eine Session mit PIN starten | Teilweise erfüllt | Grundfunktion vorhanden, aber weiter ausbauen |
| 2 | Spieler können einer Lobby beitreten | Erfüllt | Basis-Flow ist vorhanden |
| 3 | Host kann ein Quiz starten | Erfüllt | Grundfunktion ist implementiert |
| 4 | Fragen werden an verbundene Spieler gesendet | Erfüllt | Echtzeit-Weitergabe ist vorhanden |
| 5 | Spieler können Antworten senden | Erfüllt | Basis-Funktion ist vorhanden |
| 6 | Punkteberechnung und Ranking sind vorhanden | Teilweise erfüllt | Grundlogik vorhanden, aber nicht vollständig abgesichert |
| 7 | Admin kann Quizinhalte pflegen | Teilweise erfüllt | Einstieg vorhanden, aber noch nicht vollständig ausgereift |
| 8 | Fragen und Antworten werden aus konsistenter Datenbasis geladen | Nicht erfüllt | Teilweise Demo- oder Hardcoded-Logik vorhanden |
| 9 | Konfiguration ist zentral und einheitlich | Nicht erfüllt | PHP- und Node-Konfiguration sind noch uneinheitlich |
| 10 | Zeichensatz und Encoding sind konsistent auf UTF-8 gesetzt | Nicht erfüllt | In mehreren Bereichen noch Probleme erkennbar |
| 11 | Sicherheitsmechanismen wie Authentifizierung sind vorhanden | Nicht erfüllt | Noch offen |
| 12 | Tests für kritische Funktionen existieren | Nicht erfüllt | Noch keine Testabdeckung |
| 13 | Fehlerbehandlung und Reconnect-Handling sind robust | Teilweise erfüllt | Noch unvollständig |
| 14 | Betriebs- und Deployment-Aspekte sind sauber vorbereitet | Teilweise erfüllt | Weiterer Abstimmungsbedarf |

## 6. Wie wir jetzt weitergehen

Die Einordnung „teilweise erfüllt“ ist für die weitere Arbeit noch zu unscharf. Deshalb wird jeder offene oder teilweise abgedeckten Punkt in drei Bausteine zerlegt:

1. Funktion besteht
2. Funktion ist robust genug für den echten Einsatz
3. Funktion ist dokumentiert, geprüft und nachvollziehbar

### 6.1 Vorgehensweise pro Punkt

Für jeden Punkt wird im nächsten Schritt festgelegt:

- Was genau ist der Soll-Zustand?
- Was ist der aktuelle Ist-Zustand?
- Welche Lücke ist noch offen?
- Welche Umsetzung ist als Nächstes sinnvoll?

### 6.2 Priorisierung

Die Punkte werden in drei Stufen eingeordnet:

- P0: kritisch für den ersten nutzbaren Ablauf
- P1: wichtig für Qualität und Stabilität
- P2: später sinnvoll, aber nicht blockierend

### 6.3 Erste Prioritäten für Quizzy

Die ersten Arbeiten sollten sich auf diese Themen konzentrieren:

1. Konfiguration zentralisieren
2. Datenfluss für Fragen/Antworten sauber über die DB aufbauen
3. UTF-8 und Encoding konsistent absichern
4. Sicherheitsgrundlagen für Host/Admin vorbereiten
5. Tests für zentrale Quiz- und Scoring-Logik ergänzen

## 7. Konkrete Umsetzungsplanung

Die folgenden Aufgaben sind als erste Arbeitsbausteine definiert und sollten in dieser Reihenfolge angegangen werden.

| Priorität | Aufgabe | Ziel | Ergebnis |
|---|---|---|---|
| P0 | Konfiguration zentralisieren | Eine einheitliche Basis für PHP und Node schaffen | `.env`-basierte Konfiguration, zentrale Ladefunktion, keine verstreuten Hardcoded-Werte |
| P0 | Datenfluss für Fragen/Antworten über die DB sauber aufbauen | Demo-Logik durch echte Datenquelle ersetzen | Fragen werden aus der Datenbank geladen, Antworten sauber zugeordnet |
| P0 | UTF-8 und Encoding konsistent absichern | Umlaute und Sonderzeichen zuverlässig verarbeiten | Alle relevanten PHP- und Node-Dateien arbeiten konsistent mit UTF-8 |
| P1 | Sicherheitsgrundlagen für Host/Admin vorbereiten | Basis-Schutz für sensible Bereiche schaffen | einfache Authentifizierung/Schutzmechanismen für Admin- und Host-Bereiche |
| P1 | Kritische Quiz- und Scoring-Logik testen | Zuverlässigkeit erhöhen | erste Unit-/Integrationstests für zentrale Abläufe |
| P1 | Fehlerbehandlung für Reconnects und Zustandswechsel verbessern | Robustere Echtzeit-Interaktion | stabilere Behandlung von Verbindungsabbrüchen und Sessionwechseln |
| P2 | Dokumentation und Betriebsprozess erweitern | Projekt einfacher wartbar machen | kurze Setup-, Betriebs- und Troubleshooting-Dokumentation |

## 8. Nächste Schritte

Die nächsten Schritte sollten sich an den offenen Punkten orientieren:

1. Anforderungen konkretisieren und priorisieren
2. Datenmodell und DB-Fluss sauber ausbauen
3. Konfiguration vereinheitlichen
4. Sicherheits- und Testanforderungen umsetzen
5. Soll/Ist-Abgleich regelmäßig aktualisieren

## 9. Sicht- und Schrittmodell (Detailgerüst v1)

Dieses Kapitel dient als Arbeitsgrundlage für die detaillierten Vorgaben je Sicht.
Es ist absichtlich konkret strukturiert, aber noch offen für die von dir nachgereichten Feinregeln.

### 9.1 Gemeinsame Pflichtinformationen in jeder Sicht

- Geladenes Quiz (Titel)
- Session-PIN
- Aktueller Status (Lobby, Frage, Lösung, Beendet)
- Eindeutige Rückmeldung, in welcher Phase des Quiz sich die Sitzung befindet

### 9.2 Spieler-Sicht (Lobby und Spiel)

#### Schritt S1: Einstieg
- Eingaben: 6-stellige PIN, Nickname
- Ergebnis: Beitritt zur Session oder verständliche Fehlermeldung

#### Schritt S2: Lobby
- Muss anzeigen:
	- Quiztitel
	- Spielleitername
	- Anzahl beigetretener Spieler (ohne Spielleiter)
	- Teilnehmerliste
- Muss verhindern:
	- doppelte Antwortabgabe
	- Beitritt ohne PIN/Nickname

#### Schritt S3: Fragephase
- Muss anzeigen:
	- Fragetext
	- Fragetyp
	- Restzeit
	- klar erkennbare Antwortoptionen bzw. Eingabemodus
- Antwortmodus je Typ:
	- Single Choice
	- Multiple Choice
	- True/False
	- Freitext

#### Schritt S4: Lösungsphase
- Muss anzeigen:
	- korrekte Lösung(en)
	- Rückmeldung, ob die eigene Antwort richtig oder falsch war
	- bei Freitext: erwartete bzw. akzeptierte Antwortlogik
	- Zwischenranking

#### Schritt S5: Abschluss
- Muss anzeigen:
	- Endstatus
	- Endranking

### 9.3 Spielleiter-Sicht (Host)

#### Schritt H1: Einstieg
- Host meldet sich an, wählt ein Quiz aus und öffnet eine Session-PIN

#### Schritt H2: Lobby-Steuerung
- Muss anzeigen:
	- Quiztitel
	- Session-PIN
	- Spielleitername
	- Anzahl Spieler (ohne Spielleiter)
	- vollständige Spielerliste
- Muss ermöglichen:
	- Spieler kicken
	- Quiz starten
	- erkennbar machen, dass genau dieses Quiz für die Session geladen ist

#### Schritt H3: Fragephase-Steuerung
- Muss anzeigen:
	- aktuelle Frage
	- Antwortoptionen bzw. Antwortmodus der Frage
	- Anzahl bereits beantwortet / gesamt
- Muss ermöglichen:
	- Antwortphase beenden

#### Schritt H4: Lösungsphase-Steuerung
- Muss anzeigen:
	- korrekte Lösung
	- Zwischenranking
	- nachvollziehbaren Stand nach jeder Frage
- Muss ermöglichen:
	- nächste Frage
	- Quiz beenden

#### Schritt H5: Freitext-Review (Didaktik)
- Muss anzeigen:
	- alle eingegangenen Freitextantworten
	- Zuordnung Antwort zu Spieler
- Muss ermöglichen:
	- manuelle Bewertung richtig/falsch
	- Diskussion/Abgleich im Plenum (Detailregeln folgen)

### 9.4 Präsentations-Sicht (Display)

#### Schritt D1: Lobby
- Muss anzeigen:
	- Session-PIN
	- Anzahl Teilnehmer
	- Quiztitel
	- klaren Hinweis, dass das Spiel noch in der Lobby auf den Start wartet

#### Schritt D2: Frage
- Muss anzeigen:
	- Fragetext
	- Fragetyp
	- Timer

#### Schritt D3: Lösung
- Muss anzeigen:
	- richtige Lösung(en)
	- Zwischenstand / Ranking nach Bedarf des Hosts
	- bei Freitext: vom Host bewertete bzw. diskutierte Antworten (Detail folgt)

#### Schritt D4: Ende
- Muss anzeigen:
	- Endranking

### 9.5 Übergangsregeln zwischen Schritten

- Nur der Host steuert im manuellen Modus den Übergang zwischen Lobby, Quizstart, Fragetext/Bild, Antwortmöglichkeiten, Antwortphase, Ergebnis und Ende.
- Spieler-Sicht und Display-Sicht folgen ausschließlich dem Serverzustand.
- Bei Reconnect wird der letzte gültige Zustand synchron wiederhergestellt.
- Nach jeder Frage muss ein definierter Übergang in eine Lösungs- oder Ergebnisphase möglich sein.
- Das Endranking wird erst nach dem letzten regulären Schritt oder nach einem Host-Abbruch final angezeigt.
- Erste Umsetzungs- und Teststufe: Jede Phase hat keine automatische Dauer und bleibt aktiv, bis der Host weiterschaltet.
- Spätere Ausbaustufe: Jede Phase kann eine konfigurierbare automatische Dauer erhalten. Der Host kann eine laufende Phase jederzeit vorzeitig weiterschalten.
- Der aktuelle Status und der Index der aktuellen Frage müssen in der Datenbank persistiert werden, damit Backend-Steuerung und Reconnect denselben Zustand verwenden.

### 9.5.1 Verbindliches Phasenmodell (Status)

Das folgende Modell ist die fachliche Leitlinie für den Ablauf pro Quiz-Session.

- Offen:
	- Session ist geöffnet, aber es wurde noch keine Frage gestartet.
	- Beitritt ist möglich.
- Start:
	- Quizlauf wurde gestartet.
	- Willkommens- bzw. Übergangssicht vor der konkreten Frage.
	- Standardregel: nachträglicher Beitritt ist nicht vorgesehen; falls erlaubt, muss es explizit konfigurierbar sein.
- Fragetext/Bild (`question`):
	- Aktueller Fragetext und optionales Fragenbild werden angezeigt.
	- Antwortmöglichkeiten sind noch nicht sichtbar und Antworten können nicht abgegeben werden.
- Antwortmöglichkeiten (`options`):
	- Fragetext/Bild und Antwortmöglichkeiten werden angezeigt.
	- Die Antwortmöglichkeiten sind noch gesperrt; es können keine Antworten abgegeben werden.
- Antwortphase (`answer`):
	- Fragetext/Bild und Antwortmöglichkeiten bleiben sichtbar.
	- Antworten können abgegeben werden.
- Ergebnis:
	- Antwortabgabe ist gesperrt.
	- Ergebnis der Phase wird gezeigt.
	- Bei Freitext erfolgt hier die manuelle Korrektur (korrekt/falsch) je Antwort.
	- Host kann hier zwischen Ergebnis-Sichten umschalten (z. B. Antwortbild, Korrektur, Gesamtstand).
- Übergang danach:
	- Nächste Frage führt zu Fragetext/Bild der nächsten Frage.
	- Falls keine weitere Frage vorhanden: Quiz beendet.
- Optionaler Zusatzstatus:
	- Endergebnis als eigener Abschlussstatus kann eingeführt werden.

Hinweis:

- Quizstatus und Raumstatus könnten getrennt modelliert werden, sind in der aktuellen Vereinfachung jedoch zusammengeführt.
- Der aktuelle Prototyp bildet `question -> answer -> solution` bereits teilweise ab. Der eigene Zustand `options` und ein eigener persistierter Start-Zustand sind noch umzusetzen.

### 9.6 Fachliche Ergänzungen aus älterer Vorversion

Die frühere README hilft inhaltlich an mehreren Stellen, obwohl wir die dort beschriebene technische Lösung nicht übernehmen.

Nützlich daraus sind insbesondere diese Punkte:

- klares Live-Quiz-Verständnis im Stil einer moderierten Gruppensituation
- Quizauswahl vor Sessionstart
- 6-stellige PIN als verbindlicher Zugangsschlüssel
- Zwischenstand nach jeder Frage als eigenständige Anforderung
- Endranking mit Punkten als fester Abschlussbestandteil
- optionale spätere Antwortspeicherung für Auswertung und Review

### 9.7 Offene Detailpunkte für deine Nachschärfung

Die folgenden Punkte sind absichtlich noch offen und werden mit deinen Detailvorgaben konkretisiert:

- genaue Textbausteine je Statusmeldung
- exakte Reihenfolge und Dauer von Mikro-Schritten in der Lobby
- didaktische Regeln für Freitext-Diskussion und Bewertung
- Sichtbarkeit einzelner Ergebnisdetails pro Rolle
- Abbruch-/Wiedereinstiegsregeln in Sonderfällen
