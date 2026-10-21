![Team & Rollen](banner.svg)

# Team & Rollen

Freunde und Kollegen mit eigener Anmeldung für den Fernzugriff – Mitglieder sehen und steuern nur, was du freigibst. Dazu gemeinsame Team-Einrichtungen aus einem geteilten Ordner.

[English](README.md) · Offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public)-Erweiterung (SDK 2.7, native Erweiterung)

![Bildschirmfoto](docs/screenshot.de.png)

## Was sie kann

- Mitglieder mit eigener Anmeldung (Fernzugriff)
- Einzelne Dienste und Bereiche freigeben: Konsole, Spieler, Backups …
- Mitglieder sehen in der Übersicht nur ihren Teil
- **Einladung per Link** statt Passwort: die Person wählt ihr Passwort selbst; der Link gilt einmal und läuft nach 1 Stunde bis 7 Tagen ab
- **Befristete Rechte** für Helfer auf Zeit – nach dem Enddatum geht weder Anmeldung noch Zugriff
- **Protokoll:** was Mitglieder geändert haben (aus Hostwerks Änderungs-Protokoll) und was sie ohne Berechtigung versucht haben
- Die Rechte-Regeln sind eine verankerte Routen-Tabelle; ein Test liest Hostwerks Routen und schlägt fehl, sobald eine neue Kern-Route keine Entscheidung hat
- Team-Einrichtungen aus einem geteilten Ordner
- Anmeldung und Passkeys bleiben in Hostwerk selbst

## Installieren

In Hostwerk unter **Erweiterungen → Entdecken** auf „Installieren“ klicken. Wer die Funktion schon in Hostwerk 2.8 benutzt hat, bekommt die Erweiterung beim Update automatisch – mit allen Daten.

Native Erweiterungen laufen als Teil von Hostwerk (eigener Server- und Oberflächen-Teil). Darum installiert Hostwerk sie nur aus dem offiziellen Katalog (mit Prüfsumme) oder im Entwickler-Modus.

## Daten

`settings.users, settings.team` – genau dort, wo Hostwerk sie schon immer abgelegt hat (Einladungen nur als Prüfsumme). Abgelehnte Versuche in `data/team/denied.json` (die letzten 200). Entfernen der Erweiterung löscht nichts.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests (routes.test.js liest die Routen aus ../hostwerk oder HOSTWERK_DIR)
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # Prüfung wie im Katalog (sdk/check.js)
```

Quelltext der Oberfläche in `ui/src`, Server-Teil in `server/`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
