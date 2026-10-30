# Quizzy Smoke Test

## Ziel
Schneller End-to-End-Test fuer den aktuellen Stand:
- Session-Join nur mit gueltiger DB-PIN
- Quizlauf mit DB-Fragen
- Abschluss nach letzter Frage

## Voraussetzungen
- XAMPP/PHP laeuft
- MySQL/MariaDB laeuft
- DB `quizgame` ist befuellt (`quizzes`, `questions`, `question_options`, `sessions`)
- In `config/config.php` sind DB und WS korrekt gesetzt

## 1. WebSocket-Server starten
```powershell
cd c:\xampp\htdocs\quizzy\realtime-node
node server.js
```
Erwartung:
- Keine Startfehler im Terminal
- Meldung, dass der Server auf Port 8080 laeuft

## 2. Negativtest: ungueltige PIN
Aufrufen:
`http://localhost/quizzy/public/lobby.php?pin=999999&nickname=Test`

Erwartung:
- In der Spieleransicht erscheint:
`Session mit PIN 999999 nicht gefunden`

## 3. Session erzeugen (gueltige PIN)
Aufrufen:
`http://localhost/quizzy/public/admin/quizzes.php`

Aktion:
- Ein Quiz auswaehlen
- `Session starten` klicken

Erwartung:
- Redirect auf `host_control.php?pin=XXXXXX`
- Die PIN notieren

## 4. Lobby mit Host + 2 Spielern
Host:
`http://localhost/quizzy/public/host_control.php?pin=DEINE_PIN`

Spieler 1:
`http://localhost/quizzy/public/lobby.php?pin=DEINE_PIN&nickname=Alice`

Spieler 2:
`http://localhost/quizzy/public/lobby.php?pin=DEINE_PIN&nickname=Bob`

Erwartung:
- Host sieht `Antworten: 0/2` (bzw. korrekte Spieleranzahl)
- Spieler sehen Lobby/Fragewechsel ohne Fehler

## 5. Quizablauf
Aktionen am Host:
1. `Quiz starten`
2. Warten bis Spieler antworten
3. `Antwortphase beenden`
4. `Naechste Frage`
5. Schritte 2-4 wiederholen bis Ende

Erwartung:
- Spieler sehen pro Frage Text + 4 Antwortbuttons + Timer
- Host sieht Antwortzaehler steigen
- Nach `Antwortphase beenden` wird Ranking gezeigt
- Nach letzter DB-Frage kommt `quiz_finished`

## 6. Abnahmekriterien
- Ungueltige PIN wird abgewiesen (sichtbare Fehlermeldung)
- Gueltige PIN startet Session stabil
- Keine harte Begrenzung auf 2 Fragen
- Quiz endet erst nach letzter Frage aus der DB

## Optional: Schnellchecks bei Problemen
- Browser-Konsole auf JS-Fehler pruefen
- Terminal-Logs von `server.js` pruefen
- DB-Inhalte pruefen:
  - `sessions.quiz_id` gesetzt?
  - Existieren Fragen fuer dieses `quiz_id`?
  - Hat jede Frage genau 4 Eintraege in `question_options`?
