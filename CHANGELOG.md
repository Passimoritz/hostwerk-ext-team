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
