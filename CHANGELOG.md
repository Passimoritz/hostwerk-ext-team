## 1.3.1

- Lives where it belongs: Go live → Protect → Users – no own sidebar entry any more (Hostwerk 3.0+); the full page stays under Extensions → Open and can be pinned in the sidebar settings. / Steckt jetzt dort, wo sie hingehört: Livebetrieb → Schützen → Benutzer – kein eigener Seitenleisten-Eintrag mehr (Hostwerk 3.0+); die ganze Seite bleibt unter Erweiterungen → Öffnen und lässt sich in den Seitenleisten-Einstellungen anheften.

## 1.3.0

- New user dialog in four steps – person, role, access, extras – with a jump bar and a plain-language summary before saving (“Paul may – until 30 Oct: Firefight test server: start and stop, console”). / Neuer Benutzer-Dialog in vier Schritten mit Sprungleiste und Zusammenfassung vor dem Speichern.
- Areas per service: a matrix “service × area” instead of one global list – e.g. start/stop for the Minecraft server but only logs for the web server. A dash marks areas that do nothing for a kind of service (from the rights table itself). Older members keep their global areas until you change them. / Bereiche je Dienst als Matrix; ältere Mitglieder behalten ihre globalen Bereiche.
- Templates: “Friend” (start Minecraft/game servers, manage players), “Helper” (only read logs), “Co-host” (everything for the shared services). / Vorlagen Freund, Helfer, Mit-Gastgeber.
- Role as two large choice cards with what it means; rights until a date with quick choices (1 day, 1 week, 1 month, unlimited, pick a date); invitation link or password chosen in the dialog. / Rolle als Auswahlkarten, Rechte-Ende per Kurzwahl, Einladung oder Passwort direkt im Dialog.
- After saving with an invitation the link appears right away – with copy, share and a QR code for the phone camera. / Nach dem Speichern erscheint der Einladungslink sofort, mit Kopieren, Teilen und QR-Code.
- Editing an expired member no longer silently removes the end date, and switching an expired member on or off works again. / Abgelaufene Mitglieder: Bearbeiten und Ein/Aus funktionieren wieder sauber.
- User list: initials, the shared services as small chips with the number of areas. / Benutzerliste mit Initialen und Dienst-Chips.
- For other extensions: `users.can()` follows the areas per service. / `users.can()` beachtet die Bereiche je Dienst.

## 1.2.0

- Discord ID per member: the Discord bot recognises the person and allows exactly what is shared here – no own roles needed. / Discord-ID je Mitglied: der Discord-Bot erkennt die Person und erlaubt genau das hier Freigegebene.
- For other extensions: `users.can(memberId, serviceId, area)` – “may this member do that?” with the same rules as remote access (also with `{ kind, id }` from `Hostwerk.services()`), `users.byDiscord(id)` and `users.serviceKey(kind, id)`. / Für andere Erweiterungen: `users.can(…)`, `users.byDiscord(…)`, `users.serviceKey(…)`.

## 1.1.0

- Rights rules as an anchored route table – loose prefixes let members reach "log out everyone" (/live/remote/logout-all) and the Discord bot settings; "kill", Minecraft logs, game console and game players now work as shared. / Rechte-Regeln verankert; Lücken bei logout-all und discord-bot geschlossen, kill/Logs/Spiele-Konsole funktionieren.
- New Hostwerk routes decided: members with the matching area see Minecraft log files, crash reports, TPS, datapacks and plugin forms, and web server statistics/health; changing datapacks, replacing worlds, copying servers, PHP cache and database major upgrades stay with admins. / Neue Kern-Routen eingeordnet.
- Route test: reads Hostwerk's route list and fails for every service route without a decision. / Test gegen alle Kern-Routen.
- Invitation link with an end instead of passing on a password. / Einladungslink mit Ablauf.
- Rights until a date for helpers. / Befristete Rechte.
- Activity log: changes by members and refused attempts. / Protokoll der Mitglieder.
- Error states with "Try again", dates in Hostwerk's language, sizes from the design scale, place in the sidebar (System), other extensions may add tabs. / Fehlerzustände, Datum in Hostwerks Sprache, Design-Skala.

## 1.0.0

- First release as its own extension (before: built into Hostwerk). Data stays where it was. / Erste Fassung als eigene Erweiterung (vorher fest in Hostwerk). Daten bleiben, wo sie waren.
