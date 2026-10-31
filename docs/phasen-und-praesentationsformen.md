# Quizzy – Detailliertes Phasen- und Praesentationsmodell

Dieses Dokument konsolidiert die ausfuehrlichen Vorgaben zu Phasen, Anzeigen und Steuerung aus der nachgereichten Vorlage und dient als operative Spezifikation fuer die Umsetzung.

## 1. Grundprinzip

- Quizzy ist ein synchron moderiertes Live-Quiz.
- Der Spielleiter steuert den Hauptablauf.
- Drei Sichten laufen parallel:
  - Spieler-Sicht
  - Praesentations-Sicht (Beamer)
  - Kontrollzentrum (Spielleiter)

## 2. Spielleiter-Einstieg und Dashboard

## 2.1 Einstieg

- Login als Spielleiter.
- Danach Dashboard mit allen Quizzen als Kacheln oder Liste.
- Filter nach Status.

## 2.2 Statusorientierte Aktionen pro Quiz

- Offen:
  - Betreten
  - Schliessen
- Geschlossen:
  - Oeffnen
  - Bearbeiten
  - Ergebnisse loeschen
  - Ergebnisse ansehen

Hinweis:

- Bearbeiten ist nur im geschlossenen Zustand erlaubt.

## 2.3 Ergebnis-Lebenszyklus

- Ergebnisse eines Quiz bleiben sichtbar bis zum naechsten Oeffnen dieses Quiz.
- Beim erneuten Oeffnen kann der Ergebnisstand zurueckgesetzt werden (Start einer neuen Runde).

## 3. Phasenmodell (fachlich)

- Offen:
  - Beitritt ueber PIN + Nickname moeglich.
  - Noch keine gestartete Quizfrage.
- Start:
  - Quizlauf ist gestartet.
  - Uebergangs-/Willkommensscreen.
- Fragetext/Bild (`question`):
  - Fragetext und optionales Fragenbild sichtbar.
  - Antwortoptionen noch nicht sichtbar.
- Antwortmoeglichkeiten (`options`):
  - Fragetext/Bild und Antwortoptionen sichtbar.
  - Antwortabgabe noch gesperrt.
- Antwortphase (`answer`):
  - Fragetext/Bild und Antwortoptionen sichtbar.
  - Antwortabgabe aktiv.
- Ergebnis/Idle:
  - Keine neue Antwortabgabe.
  - Ergebnis- und didaktische Nachbesprechungsphase.
- Endergebnis (optional eigener Zustand):
  - Abschluss inkl. Ranking/Siegerehrung.

## 4. Join- und Reconnect-Regeln

- Standard: Spaetbeitritt nach Quizstart nicht erlaubt.
- Falls konfiguriert, kann Spaetbeitritt freigegeben werden.
- Reconnect:
  - Bei gueltiger Session Rueckkehr direkt in den aktuellen Status.
  - Sonst erneute Identifikation ueber PIN + Nickname.

## 5. Automatisierung und Steuerung

- Erste Umsetzungs- und Teststufe: vollstaendig manuell und ohne automatische Phasendauer.
- Der Spielleiter schaltet jede Phase einzeln weiter:
  - Fragetext/Bild
  - Antwortmoeglichkeiten
  - Antwortphase
  - Ergebnis
- Eine Phase bleibt so lange aktiv, bis der Spielleiter weiterschaltet.
- Zusaetzlich spaeter vorgesehen:
  - halbautomatischer Modus mit Zeitsteuerung einzelner Phasen
  - automatischer Modus mit Zeitsteuerung aller Phasen
- Auch bei aktiver Zeitsteuerung kann der Spielleiter jede Phase jederzeit ueberspringen beziehungsweise vorzeitig weiterschalten.
- Sessionstatus und aktueller Fragenindex werden in der Datenbank persistiert. Phasendauern sollen spaeter im Backend konfigurierbar und ebenfalls persistent sein.

## 6. Sichten pro Phase

## 6.1 Lobby / Offen

### Spieler

- Quizname und ggf. Bild.
- Hinweis: Warten auf Start.
- Spieleranzahl immer sichtbar.
- Spielerliste optional konfigurierbar pro Quiz.

### Beamer

- Im Kern analog zur Lobby-Information.

### Spielleiter

- Quizname, optional Bild.
- Spielerliste, Anzahl.
- Kick-Funktion.
- Start-Knopf.

## 6.2 Start

- Uebergangssicht beim Start und zwischen Fragen.
- Vorbereitung auf naechste Interaktion.

## 6.3 Fragetext/Bild

- Fragetext und optionales Fragenbild sichtbar.
- Antwortmoeglichkeiten noch nicht sichtbar.
- Im ersten Schritt keine automatische Dauer; der Host schaltet manuell weiter.

## 6.4 Antwortmoeglichkeiten

- Frage plus Antwortoptionen gleichzeitig sichtbar.
- Vier Optionen sollen klar und dauerhaft sichtbar sein.
- Antwortoptionen sind gesperrt; eine Abgabe ist noch nicht moeglich.
- Im ersten Schritt keine automatische Dauer; der Host startet die Antwortphase manuell.

## 6.5 Antwortphase

- Frage plus Antwortoptionen bleiben sichtbar.
- Antwortabgabe ist aktiv.
- Im manuellen Testmodus beendet der Host die Antwortphase.
- Spaeter kann eine konfigurierbare Antwortzeit die Phase automatisch beenden; der Host kann sie weiterhin jederzeit vorzeitig beenden.

## 6.6 Ergebnis/Idle

### Spieler

- Richtige Antwort hervorgehoben.
- Eigene Bewertung sichtbar (z. B. richtig/falsch, Punkte, ggf. Minuspunkte).
- Weitere Ergebnis-Sichten innerhalb Ergebnis/Idle:
  - Top-10 plus eigenes Ergebnis hervorgehoben
  - Gesamtranking mit Scroll/Fokus auf eigenes Ergebnis
- Spieler duerfen in dieser Phase zwischen Ergebnis-Screens wechseln.

### Beamer

- Folgt der vom Spielleiter gewaehlt dargestellten Ergebnis-Sicht.

### Spielleiter

- Kontrollschirm mit Umschaltung der Ergebnis-Sichten fuer alle.
- Freitext-Sondermodus:
  - manuelle Korrektur eingegangener Antworten
  - didaktische Diskussion im Plenum
- Zusatzstatistiken moeglich:
  - Trefferquote je Frage
  - Detailansicht je Spieler ueber alle Fragen

## 6.7 Endergebnis

- Abschluss-Ranking.
- Optional mit Siegerehrung.
- Danach Rueckkehr in geschlossenen Zustand.

## 7. Punkte und Zeit

- Zeitbasierte Punktevergabe mit sichtbarer Entwicklung waehrend der Antwortphase.
- Anzeige kann leicht geglaettet sein; Abrechnung selbst soll zeitgenau erfolgen.

## 8. Backend- und Datenmodellhinweise aus der Vorlage

- Es gibt ein reiches Statusmodell (analog `StatusT`) fuer vereinfachte Phasensteuerung.
- Quiz- und Raumstatus koennen getrennt modelliert werden, sind aber aus Vereinfachung ggf. zusammengefuehrt.
- Asynchroner Einzelmodus ist aktuell nicht Ziel; Fokus bleibt synchroner Gruppenmodus.

## 9. Priorisierte Umsetzungsschritte

1. Dashboard finalisieren:
   - Statusfilter
   - Aktionsmatrix strikt nach Offen/Geschlossen
   - Ergebnis-Loesch- und Ergebnis-Lebenszyklus
2. Statusmodell im Runtime-Flow abschliessen:
   - Start/Frage/Antwort/Ergebnis/Endergebnis durchgaengig
3. Ergebnis/Idle als eigene Multi-Screen-Phase pro Rolle umsetzen
4. Freitext-Sondermodus mit manueller Korrektur und Sichtumschaltung abschliessen
5. Auto-/Halbauto-Modus fuer Zeitsteuerung ergaenzen
6. Erweiterte Statistiken je Frage und je Spieler integrieren

## 10. Akzeptanzkriterien fuer den naechsten Entwicklungsblock

- Spielleiter sieht nach Login ein klares Dashboard mit Filter und statusabhaengigen Aktionen.
- Offene Quizze koennen betreten oder geschlossen werden; Schliessen beendet live fuer alle.
- Geschlossene Quizze koennen bearbeitet, geoeffnet oder in Ergebnisansicht geprueft werden.
- Ergebnisse bleiben bis zum naechsten Oeffnen sichtbar und sind danach zuruecksetzbar.
