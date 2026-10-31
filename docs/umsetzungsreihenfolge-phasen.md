# Quizzy Umsetzungsreihenfolge (Phase fuer Phase, je Sicht)

Dieses Dokument fixiert die empfohlene Reihenfolge fuer die weitere Umsetzung.
Ziel: fachlich korrekt, testbar pro Block, visuell konsistent, ohne halbfertige Abzweigungen.

## Block A - Basisrahmen und Test-Harness

Ziel:
- Reproduzierbare Tests vor jeder Detailarbeit.

Scope:
- Event-Logging, Status-Transparenz, definierte Testfaelle pro Eventfolge.

Betroffene Dateien:
- public/js/app.js
- realtime-node/server.js
- realtime-node/quiz.js
- realtime-node/tests/workflow.test.js

Gate (Abnahme):
- Join, Start, Frage, Antwort, Ergebnis, Ende werden als Eventfolge korrekt protokolliert.

## Block B - Phase Offen/Lobby in allen Sichten

Ziel:
- Lobby fachlich komplett und robust (Spieler, Spielleiter, Beamer).

Scope:
- Join, Reconnect, Kick, Live-Updates, Join-Policy-Verhalten.

Betroffene Dateien:
- public/lobby.php
- public/host_control.php
- public/display.php
- realtime-node/lobby.js

Gate (Abnahme):
- Spieleranzahl und Liste stimmen in allen Sichten.
- Kick wird sofort in allen Sichten sichtbar.
- Reconnect landet korrekt in der Session.
- Join nach Start wird gemaess Regel erzwungen.

## Block C - Phase Start als echter Zustand

Ziel:
- Start ist explizit und nicht implizit mit Lobby/Frage vermischt.

Scope:
- Eigener Zustand und klare Darstellung pro Sicht.

Betroffene Dateien:
- realtime-node/quiz.js
- public/js/app.js
- public/js/status-utils.js
- public/host_control.php
- public/display.php

Gate (Abnahme):
- Start wird in allen Sichten korrekt angezeigt und sauber zu Frage uebergeleitet.

## Block D - Phase Fragetext/Bild

Ziel:
- Didaktische Anzeige von Fragetext und optionalem Bild ohne sichtbare Antwortmoeglichkeiten.

Scope:
- Fragetext/Bild sichtbar, Antwortmoeglichkeiten verborgen, kontrollierter manueller Uebergang.

Betroffene Dateien:
- public/lobby.php
- public/display.php
- public/js/app.js
- realtime-node/quiz.js

Gate (Abnahme):
- Fragetext und optionales Bild werden korrekt angezeigt.
- Antwortmoeglichkeiten sind noch nicht sichtbar oder abgebbar.
- Die Phase bleibt ohne Timer stehen, bis der Host weiterschaltet.

## Block E - Phase Antwortmoeglichkeiten (gesperrt)

Ziel:
- Antwortmoeglichkeiten vor der Freigabe lesbar anzeigen.

Scope:
- Eigener persistierter Zustand `options`.
- Fragetext/Bild und Optionen sichtbar, Eingaben vollstaendig gesperrt.

Gate (Abnahme):
- Alle Optionen werden in allen Sichten synchron angezeigt.
- Spieler koennen noch keine Antwort abgeben.
- Die Phase bleibt ohne Timer stehen, bis der Host die Antwortphase startet.

## Block F - Phase Antwort (Timer, Punkte, Typen)

Ziel:
- Produktionsstabile Antwortlogik fuer alle Fragetypen.

Scope:
- Single, Multiple, True/False, Freitext.
- Erste Stufe: manuell beendete Antwortphase ohne automatischen Ablauf.
- Spaetere Stufe: Timer, Delay/Decay, eindeutige Abgabe, Review-Queue.

Betroffene Dateien:
- realtime-node/quiz.js
- public/js/app.js
- public/lobby.php

Gate (Abnahme):
- Pro Spieler nur eine gueltige Abgabe.
- Freitext landet sicher im Review-Prozess.
- Host kann die Phase manuell beenden.
- Spaeter: Timer und Punkteberechnung stimmen; Host kann den Timer jederzeit ueberspringen.

## Block G - Phase Ergebnis/Idle (didaktische Kernphase)

Ziel:
- Ergebnisphase mit mehreren Ansichten und klarer Steuerung.

Scope:
- Richtige Antwort, Top10 plus eigenes Ergebnis, Gesamtranking.
- Beamer folgt Host-Steuerung.
- Spieler kann in Idle zwischen Ergebnis-Screens wechseln.

Betroffene Dateien:
- public/host_control.php
- public/display.php
- public/lobby.php
- public/js/app.js

Gate (Abnahme):
- Alle Ergebnis-Screens funktionieren konsistent.
- Sichtwechsel ist je Rolle korrekt.

## Block H - Endergebnis und Session-Lifecycle

Ziel:
- Sauberer Abschluss inkl. Ergebnis-Lebenszyklus.

Scope:
- Endergebnis als Zustand, sofortiger Close-Broadcast, Sichtbarkeit bis naechste Oeffnung.

Betroffene Dateien:
- realtime-node/quiz.js
- public/admin/quizzes.php
- public/host_control.php

Gate (Abnahme):
- Endzustand klar sichtbar.
- Schliessen beendet live fuer alle.
- Ergebnisdaten bleiben bis zum naechsten Oeffnen erhalten und werden dann zurueckgesetzt.

## Block I - Admin Pflege auf Produktivniveau

Ziel:
- Effiziente Stammdatenpflege statt rudimentaerer Eingabe.

Scope:
- Linkes Fragenverzeichnis, Frage-fuer-Frage Workflow, Registerstruktur pro Frage.

Betroffene Dateien:
- public/admin/quiz_edit.php
- public/css/style.css

Gate (Abnahme):
- Schnelles Navigieren und Bearbeiten grosser Quizze.
- Saubere visuelle Struktur ohne Stilbruch.

## Block J - Finaler Qualitaetsdurchlauf

Ziel:
- Stabilitaet, Konsistenz, Produktionsreife.

Scope:
- Cross-Device Checks, Reconnect-Stresstest, UI-Polish, Regression.

Betroffene Dateien:
- public/css/style.css
- public/js/app.js
- realtime-node/tests/workflow.test.js

Gate (Abnahme):
- Keine kritischen Regressionen.
- Einheitlicher Look ueber alle Hauptmasken.
- Phasenablauf in allen Sichten reproduzierbar korrekt.

## Standard Testprotokoll nach jedem Block

1. Funktionstest je Sicht (Spieler, Spielleiter, Beamer).
2. Zustandsfolge pruefen: Offen -> Start -> Frage -> Antwort -> Ergebnis -> Endergebnis.
3. Reconnect-Test mitten in einer aktiven Phase.
4. Negativtest: unerlaubte Aktionen werden sauber abgewiesen.
5. UI-Check: Lesbarkeit, Fokus, Statusfarben, Interaktionsflaechen.

## Startpunkt

Empfohlener naechster Schritt:
- Block B (Offen/Lobby) vollstaendig abschliessen und abnehmen.
