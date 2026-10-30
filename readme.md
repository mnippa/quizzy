\# Quizzy – Live Multiplayer Quiz (Stand Februar 2026)



\## Überblick



Quizzy ist ein Kahoot-ähnliches Live-Quiz-System mit einem Node.js-WebSocket-Server und einem klassischen PHP/MySQL-Frontend.  

Host, Spieler und (optional) Beamer-Ansicht kommunizieren in Echtzeit über WebSockets.



---



\## Architektur



\- \*\*Backend (Echtzeit)\*\*

&nbsp; - Node.js WebSocket-Server (`realtime-node/`)

&nbsp; - Aufteilung in mehrere Module:

&nbsp;   - `server.js` – Einstiegspunkt, Verbindungs-Handling, Routing der Messages

&nbsp;   - `lobby.js` – Beitritt zur Lobby, Spielerlisten, Lobby-Status

&nbsp;   - `quiz.js` – Quiz-Flow (Start, Antworten, Lösungen, nächste Frage, Quiz-Ende)

&nbsp;   - `ranking.js` – Ranking-Berechnung pro Runde und am Ende

&nbsp;   - `utils.js` – Broadcasts, Session-Helfer, Laden von Fragen (Demo + DB)

&nbsp;   - `db`/Hilfsfunktionen – MySQL-Verbindung, Laden von Fragen/Sessions

\- \*\*Frontend\*\*

&nbsp; - Klassisches PHP-Frontend

&nbsp;   - `public/host\_control.php` – Ansicht für den Quiz-Host (Starten/Steuern der Session)

&nbsp;   - `public/lobby.php` – Spieler-Ansicht (Lobby, Fragen, Ergebnisanzeige)

&nbsp;   - `public/index.php` – Einstieg / Auswahl

&nbsp; - JavaScript

&nbsp;   - `public/js/app.js` – WebSocket-Client, UI-Logik für Host und Spieler

\- \*\*Datenbank (MySQL/MariaDB)\*\*

&nbsp; - `quizzes` – Metadaten der Quizzes (`id`, `title`, `description`, …)

&nbsp; - `questions` – Fragen zu einem Quiz (Text, Position, `correct\_option\_index`)

&nbsp; - `question\_options` – Antwortoptionen (immer 4, Index 0–3)

&nbsp; - `sessions` – laufende Quiz-Sessions (PIN, `quiz\_id`, `state`, `current\_question\_index`)

&nbsp; - `responses` – Antworten der Spieler (optional für spätere Auswertungen)



---



\## Derzeit implementierte Features



\### Echtzeit-Flow



\- Host erzeugt eine neue Session mit zufälliger \*\*PIN\*\* über `quizzes.php`.

\- Spieler joinen das Quiz über `lobby.php?pin=XXXXXX\&nickname=NAME`.

\- WebSocket-Verbindung für Host und Spieler:

&nbsp; - Host: `role = 'host'`, steuert den Quiz-Ablauf.

&nbsp; - Spieler: `role = 'player'`, senden Antworten und empfangen Status.



\### Lobby



\- Spieler können mit PIN und Nickname der Lobby beitreten.

\- Server verwaltet pro Session:

&nbsp; - `players` mit `id`, `name`, `points`, `answered`.

&nbsp; - `hosts` (WebSocket-Referenzen).

\- Lobby-Updates:

&nbsp; - Spieleranzahl und Liste der Spieler werden an Host (und ggf. andere Clients) gesendet.

&nbsp; - `lobby\_joined` und `lobby\_update` Events werden ausgewertet.



\### Quiz-Start und Fragen



\- Host kann das Quiz starten (`host\_start\_quiz`):

&nbsp; - Session-State wechselt von `lobby` auf `question`.

&nbsp; - `current\_question\_index` wird gesetzt.

&nbsp; - Frage wird geladen:

&nbsp;   - aktuell per Demo-Fragen oder über DB anhand `quiz\_id` + `current\_question\_index`.

&nbsp; - `quiz\_started` Event wird an Host und alle Spieler gesendet.

\- Spieler sehen:

&nbsp; - Fragetext.

&nbsp; - 4 Antwortbuttons.

&nbsp; - Timer (Client-seitig, z. B. 15s).



\### Antworten \& Scoring



\- Spieler senden ihre Antwort mit `player\_answer\_single` und `answerIndex`.

\- Server prüft:

&nbsp; - Doppelantworten (pro Frage nur eine Antwort).

&nbsp; - Korrektheit über `correct\_option\_index`.

\- Zeitbasiertes Punkte-System (vereinfacht):

&nbsp; - Maximalpunkte werden schrittweise nach Antwortzeit reduziert.

&nbsp; - Punkte werden dem Spieler gutgeschrieben.

\- Broadcast, dass ein Spieler geantwortet hat (für Host-UI).



\### Rundenende, Lösung \& Ranking



\- Host beendet Antwortphase (`host\_end\_answer\_phase`):

&nbsp; - Server berechnet ein aktuelles Ranking (`ranking.js`).

&nbsp; - `show\_solution` Event mit:

&nbsp;   - `correctAnswer` (Index der richtigen Option).

&nbsp;   - `ranking` (Spieler sortiert nach Punkten).

\- Host-Ansicht:

&nbsp; - Zwischenstand nach jeder Runde.

\- Spieler-Ansicht:

&nbsp; - Markierung von richtigen/falschen Antworten (Farben, Häkchen).



\### Nächste Frage \& Quiz-Ende



\- Host kann zur nächsten Frage springen (`host\_next\_question`):

&nbsp; - `current\_question\_index` wird erhöht.

&nbsp; - Nächste Frage wird geladen (oder Quiz-Ende, wenn keine Fragen mehr vorhanden).

&nbsp; - `next\_question` Event an Host und Spieler.

&nbsp; - `answered`-Flags der Spieler werden zurückgesetzt.

\- Quiz-Ende:

&nbsp; - Entweder automatisch nach letzter Frage oder per `host\_end\_quiz`.

&nbsp; - `quiz\_finished` Event mit finalem Ranking.



---



\## Datenbank-Stand



\- Tabellenstruktur für:

&nbsp; - `quizzes`, `questions`, `question\_options`, `sessions`, `responses`.

\- Mindestens 10 Beispiel-Quizzes mit:

&nbsp; - Allgemeinwissen

&nbsp; - IT \& Computer

&nbsp; - Geografie

&nbsp; - Film \& Serien

&nbsp; - Sport

&nbsp; - Musik

&nbsp; - Geschichte

&nbsp; - Tiere

&nbsp; - Mathe \& Logik

&nbsp; - Deutschland-Quiz  

\- Jede Frage hat genau 4 Optionen, `correct\_option\_index` zeigt auf den richtigen Eintrag.



---



\## Bekannte Punkte / Technische Besonderheiten



\- Rollen-Handling im WebSocket:

&nbsp; - `role`, `sessionPin` und `nickname` werden aus der Nachricht übernommen und am `ws`-Objekt gesetzt.

\- Broadcast:

&nbsp; - `utils.broadcastToSession` verteilt Events an Host(s), Spieler (`ws`-Referenz im Player-Objekt) und ggf. Displays.

\- Kompatibilität:

&nbsp; - Es gab ältere Versionen mit anderen Spalten (`name` statt `title`, `emergency\_pin`), der aktuelle Stand verwendet das neue Schema.



---



\## Geplante / Noch offene Features



\- \*\*Volle DB-Anbindung für Fragen\*\*

&nbsp; - `loadNextQuestion` konsequent auf MySQL umstellen (kein Demo-Fallback mehr).

&nbsp; - Laden aller Fragen eines Quizzes zu Beginn in den Speicher (Caching), um DB-Last zu reduzieren.

\- \*\*Persistente Auswertung\*\*

&nbsp; - Schreiben der Spielerantworten in `responses`.

&nbsp; - Auswertung pro Session (z. B. Statistiken, richtige Antworten, Schnitt).

\- \*\*Benutzeroberfläche\*\*

&nbsp; - Optische Optimierung der Host-Ansicht (klare Buttons, Statusanzeigen, Live-Ranking).

&nbsp; - Optional eigene Beamer-/Display-Ansicht (Nur Frage + Ranking, kein UI).

\- \*\*Quiz-Management\*\*

&nbsp; - Admin-Bereich zum Anlegen/Bearbeiten von Quizzes und Fragen im Browser.

&nbsp; - Import/Export von Quizzes (z. B. als JSON/SQL).

\- \*\*Spielmodi\*\*

&nbsp; - Unterschiedliche Punktelogiken (z. B. mehr Gewichtung bei Geschwindigkeit).

&nbsp; - Optionale Zeitbegrenzung pro Frage variabel pro Quiz/Frage.

\- \*\*Stabilität \& Fehlerbehandlung\*\*

&nbsp; - Besseres Handling von Verbindungsabbrüchen (Rejoin mit gleicher PIN, Wiederherstellung des Zustands).

&nbsp; - Logging und Debug-Ansicht für den Host (z. B. Anzeige, wie viele Events gesendet wurden).



---



\## Start / Entwicklung



\- Voraussetzungen:

&nbsp; - Node.js

&nbsp; - PHP (z. B. XAMPP)

&nbsp; - MySQL/MariaDB

\- Datenbank importieren:

&nbsp; - `quizgame`-Schema und Dumps ausführen.

\- WebSocket-Server:

&nbsp; - Im Ordner `realtime-node/`:

&nbsp;   - `node server.js`

\- PHP-Frontend:

&nbsp; - Im Browser `host\_control.php` und `lobby.php` mit entsprechender PIN aufrufen.



Diese README beschreibt den aktuellen technischen Stand und die geplanten Erweiterungen, damit die weitere Entwicklung gezielt fortgesetzt werden kann.



