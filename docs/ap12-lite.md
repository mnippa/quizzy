# AP-12-lite: Vorbereitung fuer HTTPS/WSS und Debian

## Bereits im Code vorbereitet

- Browser verwenden unter HTTPS automatisch `wss://<gleicher-host>/ws`; unter HTTP bleibt die lokale Verbindung zu `WS_HOST:WS_PORT` erhalten.
- Der Apache-Pfad ist ueber `WS_PATH` konfigurierbar und standardmaessig `/ws`.
- Der Node-Prozess bindet standardmaessig an `127.0.0.1`; damit ist der WebSocket-Port nicht fuer externe Clients bestimmt.
- Datenbankabfragen des Realtime-Prozesses verwenden einen gemeinsamen MySQL-Pool statt pro Abfrage eine neue Verbindung zu oeffnen. `DB_CONNECTION_LIMIT` konfiguriert die Obergrenze und ist standardmaessig `20`. Bei ausgelastetem Pool wartet der mysql2-Pool auf freie Verbindungen.
- `deploy/apache-quizzy-ws.conf.example` und `deploy/quizzy-realtime.service.example` enthalten Vorlagen fuer den Reverse Proxy und systemd.

## Lokale Konfiguration

Die Beispielvariablen stehen in `.env.example`. `WS_PATH` muss zum Apache-Proxy passen; fuer eine HTTPS-Installation ist `/ws` vorgesehen. Die Werte in einer echten Deployment-Umgebung muessen eigene Datenbank-Zugangsdaten verwenden. Den `PORT` darf Apache nicht direkt aus dem Internet erreichen.

## Auf einem spaeteren Debian-Testsystem noch abzunehmen

1. Vorlagen an Installationspfad, Service-Benutzer und vorhandenen HTTPS-VirtualHost anpassen.
2. Apache-Module aktivieren, Konfiguration testen und `/ws` im HTTPS-VirtualHost auf `127.0.0.1:8081` weiterleiten.
3. systemd-Service starten und Neustart/Logs/DB-Verbindung kontrollieren.
4. Browserverbindungen ueber WSS fuer Spieler, Host und Display testen.
5. Backup und Restore von MariaDB und `public/uploads` pruefen.

Diese Vorlagen sind noch keine vollstaendige Debian-Abnahme. Sie ersetzen weder eine frische Installation noch die spaetere Betriebs- und Wiederherstellungsprobe.
