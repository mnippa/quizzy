# Setup und Quiz-Flow

## 1. Konfiguration

Die wichtigsten Werte für PHP und Node liegen jetzt zentral in der Konfigurationsbasis.

### Wichtige Variablen
- DB_HOST
- DB_USER
- DB_PASS
- DB_NAME
- DB_CHARSET
- WS_HOST
- WS_PORT
- PORT

Die Standardwerte sind in [.env.example](../.env.example) hinterlegt.

## 2. Lokaler Start

1. XAMPP/Apache und MySQL starten
2. Datenbank anlegen und die Zugangsdaten in der lokalen Umgebung hinterlegen
3. PHP-Seiten über den lokalen Webserver aufrufen
4. Node-Server starten:

```bash
cd realtime-node
node server.js
```

## 3. Quiz-Flow

Der typische Ablauf ist:
1. Host startet eine Session
2. Spieler treten über die PIN der Lobby bei
3. Host startet das Quiz
4. Host zeigt Fragetext und optionales Bild
5. Host blendet die noch gesperrten Antwortmöglichkeiten ein
6. Host startet die Antwortphase
7. Host beendet die Antwortphase und zeigt das Ergebnis
8. Host wechselt zur nächsten Frage oder beendet das Quiz

### Status-Phasen (fachliches Modell)

- Offen: Session offen, noch keine gestartete Frage, Beitritt möglich
- Start: Quiz gestartet, Übergangssicht vor der Frage
- Fragetext/Bild (`question`): Frage und optionales Bild sichtbar, Antwortmöglichkeiten noch verborgen
- Antwortmöglichkeiten (`options`): Optionen sichtbar, Eingabe noch gesperrt
- Antwortphase (`answer`): Optionen sichtbar, Eingabe möglich
- Ergebnis: Eingabe gesperrt, Ergebnis-/Korrekturphase sichtbar
- Optional: Endergebnis als eigener Abschlussstatus

### Steuerungsmodus

- Zunächst wird der komplette Ablauf ohne automatische Zeiten getestet.
- Jede Phase bleibt bestehen, bis der Spielleiter manuell weiterschaltet.
- Später erhält jede Phase optional eine konfigurierbare Dauer.
- Automatische Phasen können jederzeit durch den Spielleiter übersprungen werden.
- Status und aktueller Fragenindex werden in der Datenbank gespeichert; die spätere Backend-Konfiguration der Phasendauern baut darauf auf.

Aktueller Umsetzungsstand:

- Der Prototyp unterstützt derzeit im Kern `question -> answer -> solution`.
- Die eigenständige Phase `options` und ein eigener persistierter Start-Zustand fehlen noch.

Hinweis zur Beitrittsregel:

- Standardmäßig ist ein später Beitritt nach Start nicht vorgesehen; falls benötigt, sollte das als explizite Option umgesetzt werden.

## 4. Wichtige Hinweise

- Wenn keine gültige Frage mehr verfügbar ist, endet der Ablauf sauber mit einer verständlichen Meldung.
- Bei Verbindungsabbrüchen versucht das Frontend eine erneute Verbindung.
- Die wichtigsten Quiz- und Session-Schritte sind in den Tests abgedeckt.
