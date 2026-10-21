![Team & roles](banner.svg)

# Team & roles

Friends and colleagues with their own sign-in for remote access – members only see and control what you share. Plus shared team setups from a shared folder.

[Deutsch](README.de.md) · An official [Hostwerk](https://github.com/Passimoritz/hostwerk-public) extension (SDK 2.7, native extension)

![Screenshot](docs/screenshot.png)

## What it does

- Members with their own sign-in (remote access)
- Share single services and areas: console, players, backups …
- Members only see their own part of the overview
- **Invite by link** instead of a password: the person chooses their own password; the link works once and expires after 1 hour to 7 days
- **Rights for a limited time** for helpers – after the end date neither sign-in nor access works
- **Activity:** what members changed (from Hostwerk's change log) and what they tried without permission
- The rights rules are an anchored route table; a test reads Hostwerk's routes and fails as soon as a new core route has no decision
- Team setups from a shared folder
- Sign-in and passkeys stay in Hostwerk itself

## Install

In Hostwerk: **Extensions → Discover** and click “Install”. If you already used this feature in Hostwerk 2.8, the update installs the extension by itself – with all your data.

Native extensions run as part of Hostwerk (own server and interface part). That is why Hostwerk only installs them from the official catalogue (with checksum) or in developer mode.

## Data

`settings.users, settings.team` – exactly where Hostwerk always kept it. Removing the extension deletes nothing.

## Develop

```bash
node --test tests/*.test.js          # tests (routes.test.js reads the routes from ../hostwerk or HOSTWERK_DIR)
node build-native.js .               # build the interface (sdk/build-native.js from hostwerk-public)
node check.js . --strict             # same check as the catalogue (sdk/check.js)
```

Interface source in `ui/src`, server part in `server/`. Texts in the code are English, German is in `locales/de.json`.

## License

MIT
