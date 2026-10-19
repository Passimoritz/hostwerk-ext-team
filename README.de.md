![Team & Rollen](banner.svg)

# Team & Rollen

Freunde und Kollegen mit eigener Anmeldung für den Fernzugriff – Mitglieder sehen und steuern nur, was du freigibst. Dazu gemeinsame Team-Einrichtungen aus einem geteilten Ordner.

[English](README.md) · Offizielle [Hostwerk](https://github.com/Passimoritz/hostwerk-public)-Erweiterung (SDK 2.7, native Erweiterung)

![Bildschirmfoto](docs/screenshot.de.png)

## Was sie kann

- Mitglieder mit eigener Anmeldung (Fernzugriff)
- Einzelne Dienste und Bereiche freigeben: Konsole, Spieler, Backups …
- Mitglieder sehen in der Übersicht nur ihren Teil
- Team-Einrichtungen aus einem geteilten Ordner
- Anmeldung und Passkeys bleiben in Hostwerk selbst

## Installieren

In Hostwerk unter **Erweiterungen → Entdecken** auf „Installieren“ klicken. Wer die Funktion schon in Hostwerk 2.8 benutzt hat, bekommt die Erweiterung beim Update automatisch – mit allen Daten.

Native Erweiterungen laufen als Teil von Hostwerk (eigener Server- und Oberflächen-Teil). Darum installiert Hostwerk sie nur aus dem offiziellen Katalog (mit Prüfsumme) oder im Entwickler-Modus.

## Daten

`settings.users, settings.team` – genau dort, wo Hostwerk sie schon immer abgelegt hat. Entfernen der Erweiterung löscht nichts.

## Entwickeln

```bash
node --test tests/*.test.js          # Tests
node build-native.js .               # Oberfläche bauen (sdk/build-native.js aus hostwerk-public)
node check.js . --strict             # Prüfung wie im Katalog (sdk/check.js)
```

Quelltext der Oberfläche in `ui/src`, Server-Teil in `server/`. Texte im Code sind Englisch, Deutsch steht in `locales/de.json`.

## Lizenz

MIT
