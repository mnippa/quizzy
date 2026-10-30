# Quizzy

## Projektstatus (Stand: 2026-02-06)

Status: **MVP / Prototyp in aktiver Entwicklung**

Das Projekt besitzt einen funktionsfähigen Grundfluss für ein Live-Quiz (Lobby -> Fragen -> Punkte), ist aber noch nicht produktionsreif.

## Aktueller Umfang

- PHP-Frontend für:
  - Spieler-Beitritt (`public/index.php`, `public/lobby.php`)
  - Host-Steuerung (`public/host_control.php`)
  - Anzeige-Seite (`public/display.php`)
  - Quiz-Session-Start über Admin (`public/admin/quizzes.php`)
- Node.js WebSocket-Server (`realtime-node/server.js`) für Echtzeit-Events.
- Grundlegende Session- und Ranking-Logik in:
  - `realtime-node/lobby.js`
  - `realtime-node/quiz.js`
  - `realtime-node/ranking.js`
  - `realtime-node/utils.js`
- MySQL-Anbindung vorhanden, aktuell teils Demo-/Fallback-Logik.

## Was bereits funktioniert

- Host kann eine Session starten (PIN-basiert).
- Spieler können Lobby beitreten.
- Host kann Quiz starten.
- Frage wird an verbundene Clients gebroadcastet.
- Spieler können Antworten senden.
- Punkteberechnung und Ranking-Grundfunktion vorhanden.

## Bekannte Baustellen

- **Encoding-Probleme** (Umlaute/Zeichen) in mehreren Dateien sichtbar.
- **Konfiguration uneinheitlich**:
  - Teilweise aus `config/config.php`, teilweise `$_ENV`/hardcoded.
  - DB- und WS-Daten sind mehrfach/hardcoded hinterlegt.
- **Demo-Fragen hardcoded** in `realtime-node/utils.js` (noch kein sauberer DB-Fragenfluss).
- **`realtime-node/db.js` unvollständig** (z. B. fehlender `mysql`-Import).
- **Keine Tests** (Unit/Integration/E2E).
- **Sicherheits-/Betriebsaspekte offen**:
  - Secrets aktuell im Code.
  - Keine Authentifizierung für Host/Admin.
- `node_modules` liegt im Repo unter `realtime-node/node_modules`.

## Lokales Starten (Ist-Zustand)

1. XAMPP/Apache + MySQL starten.
2. Datenbank `quizgame` bereitstellen.
3. PHP-Konfiguration prüfen: `config/config.php`.
4. Node-Server starten:

```bash
cd realtime-node
npm start
```

5. Browser:
   - Admin/Sessionstart: `public/admin/quizzes.php`
   - Host: `public/host_control.php`
   - Spieler: `public/index.php`

## Priorisierte nächste Schritte

1. Einheitliche Konfiguration über `.env` + zentrale Loader in PHP/Node.
2. Zeichensatz konsequent auf UTF-8 korrigieren.
3. Fragen/Antworten vollständig aus DB laden (statt Demo-Array).
4. Fehlerbehandlung und Zustandsmaschine absichern (Edge Cases, Reconnect).
5. Tests einführen (mind. kritische Quiz-/Scoring-Logik).
6. `node_modules` aus Versionskontrolle entfernen und `.gitignore` pflegen.
