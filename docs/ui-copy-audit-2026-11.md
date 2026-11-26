# UI copy audit — November 2026

Owner, 2026-11-26: the web app carries many large explanatory text blocks that
nobody reads. Keep the essential line, easy to understand, and put the rest
behind an info button.

## Numbers

Measured on the DE locale (`frontend/src/i18n/resources/de`), forgejo/main
9a0f9936d against `feat/ui-copy-diet`:

| | before | after |
|---|---:|---:|
| Help keys (`*description/*hint/*help/*intro`, settings `s`) over 120 characters | 248 | 0 |
| Characters in those 248 strings | 49 354 | 18 214 |
| All DE strings over 140 characters | 1 140 | 954 |
| DE locale, all characters | 942 143 | 912 338 |
| Visible text on Settings → Daten (iPad, body text) | 15 689 | 13 422 |

Decisions over the 1 195 inventoried strings: 239 shortened, 15 moved behind an
ⓘ (short line plus a `…More` key), 0 deleted, 941 kept — 514 statistics
answers already behind "Wie gezählt", 180 warnings/errors/consents that stay
visible, 39 release notes, 20 already behind an ⓘ, 16 inside the exported
spreadsheet, and 172 longer state messages and legends left for a later pass
("keep (review later)").

## Why the text grew

- Our own rules were met with prose instead of UI. "A failure must reach the
  user as itself", "provenance visible", "say why instead of drawing a broken
  button" and "never guess" are good rules; each was satisfied by adding a
  sentence under the control, never by a badge, an icon or an inline status.
- Every review finding that said "the user cannot tell X" added a clause to
  the nearest string. Nothing ever took one away.
- Copy grew feature by feature, each author explaining their own feature in
  full. Nobody owned the page as a whole, so forty correct paragraphs added up
  to one wall nobody reads — and the sentence that mattered was lost in it.
- Internal facts leaked into copy: measurement runs, provider names, fallback
  chains, edge cases. True, but for the code comment, not the user.

## Guideline

- Show state with UI elements: badges, icons, inline status, a disabled
  control with its reason. Do not describe state in a paragraph.
- Explanations are one line (≤ ~90 characters, plain words, no internal
  terms) plus an ⓘ when more is truly needed: `InfoLine`
  (`components/ui/InfoLine.tsx`), `SettingRow.more`,
  `SectionTitle.descriptionMore`, `ImportTileShell.descriptionMore`. The
  detail lives in a sibling key ending in `More`.
- How-tos with steps go to the wiki where a page exists.
- Warnings, confirmations and error reasons stay visible (owner rule "Fehler
  immer sichtbar"): shorten them, never hide them.
- The guard: `frontend/src/i18n/__tests__/inlineHelpLength.test.ts` — help
  keys ≤ 120 characters, `…More` ≤ 400, exceptions only through
  `inlineHelpLength.baseline.json` with a reason (empty today).

## Inventory

Every DE string over 140 characters at 9a0f9936d, plus every help key over
120. Sorted by page, longest first.

| Page | Key | DE chars before | after | Decision |
|---|---|---:|---:|---|
| achievements | achievements:hiddenHint | 142 | 71 | shorten |
| Bahn | rail:stats.help.journeys.unit | 322 | 322 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.hours.time | 322 | 322 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.punctuality.coverage | 286 | 286 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.nights.coverage | 285 | 285 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.nightTrains.time | 274 | 274 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.nights.unit | 260 | 260 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.punctuality.exclusions | 257 | 257 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.hours.coverage | 251 | 251 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.delays.time | 243 | 243 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.transfers.coverage | 240 | 240 | keep (already behind „Wie gezählt“) |
| Bahn | rail:bookmarklet.touchHint | 235 | 90 | shorten |
| Bahn | rail:stats.help.rankings.source | 227 | 227 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.nights.exclusions | 223 | 223 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.punctuality.unit | 223 | 223 | keep (already behind „Wie gezählt“) |
| Bahn | rail:bookmarklet.description | 221 | 85 | shorten |
| Bahn | rail:stats.help.newConnections.time | 215 | 215 | keep (already behind „Wie gezählt“) |
| Bahn | rail:roadtripConversion.offer | 212 | 212 | keep (warning/error/consent stays visible) |
| Bahn | rail:stats.help.newConnections.exclusions | 211 | 211 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.nightTrains.unit | 210 | 210 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.rides.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.km.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.countries.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.highSpeed.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.crossBorder.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.operatorsCount.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.rankings.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.longest.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.journeys.source | 201 | 201 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.km.unit | 197 | 197 | keep (already behind „Wie gezählt“) |
| Bahn | rail:bahnHandoff.reason.empty | 193 | 193 | keep (warning/error/consent stays visible) |
| Bahn | rail:stats.help.transfers.time | 189 | 189 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.punctuality.source | 188 | 188 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.newConnections.source | 187 | 187 | keep (already behind „Wie gezählt“) |
| Bahn | rail:bookmarklet.privacy | 182 | 182 | keep (warning/error/consent stays visible) |
| Bahn | rail:stats.help.transfers.unit | 180 | 180 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.favourites.source | 179 | 179 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.km.source | 177 | 177 | keep (already behind „Wie gezählt“) |
| Bahn | rail:lookup.pastDay | 176 | 176 | keep (review later) |
| Bahn | rail:stats.help.delays.coverage | 174 | 174 | keep (already behind „Wie gezählt“) |
| Bahn | rail:form.distanceHint | 173 | 52 | shorten |
| Bahn | rail:stats.help.journeys.coverage | 172 | 172 | keep (already behind „Wie gezählt“) |
| Bahn | rail:shareLink.reason.blocked | 171 | 171 | keep (warning/error/consent stays visible) |
| Bahn | rail:lookup.none.unavailable | 169 | 169 | keep (warning/error/consent stays visible) |
| Bahn | rail:stats.help.journeys.exclusions | 169 | 169 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.km.coverage | 168 | 168 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.empty.noItinerary | 168 | 168 | keep (review later) |
| Bahn | rail:stats.help.newConnections.unit | 163 | 163 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.highSpeed.unit | 163 | 163 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.transfers.source | 160 | 160 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.rides.unit | 158 | 158 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.panelHint | 158 | 63 | shorten |
| Bahn | rail:stats.help.favourites.exclusions | 156 | 156 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.booking.appliesToAll | 156 | 156 | keep (review later) |
| Bahn | rail:stats.help.delays.unit | 153 | 153 | keep (already behind „Wie gezählt“) |
| Bahn | rail:bahnHandoff.reason.noVbid | 153 | 153 | keep (warning/error/consent stays visible) |
| Bahn | rail:import.possibleDuplicate | 152 | 152 | keep (review later) |
| Bahn | rail:lookup.changeNeeded | 151 | 151 | keep (review later) |
| Bahn | rail:import.reservation.intro | 151 | 81 | shorten |
| Bahn | rail:stats.help.rankings.unit | 150 | 150 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.mode.asLocalTransit | 150 | 150 | keep (review later) |
| Bahn | rail:import.empty.llmUnreachable | 149 | 149 | keep (review later) |
| Bahn | rail:stats.help.nights.time | 147 | 147 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.countries.exclusions | 144 | 144 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.positionFromBahnConflict | 144 | 144 | keep (review later) |
| Bahn | rail:shareLink.description | 144 | 78 | shorten |
| Bahn | rail:stats.help.crossBorder.exclusions | 143 | 143 | keep (already behind „Wie gezählt“) |
| Bahn | rail:stats.help.operatorsCount.unit | 143 | 143 | keep (already behind „Wie gezählt“) |
| Bahn | rail:import.mode.busDisabled | 143 | 143 | keep (review later) |
| Bahn | rail:form.errors.nonexistentTime | 142 | 142 | keep (warning/error/consent stays visible) |
| bulkEdit | bulkEdit:outcomeUnknown | 143 | 143 | keep (warning/error/consent stays visible) |
| bulkEdit | bulkEdit:intro | 134 | 89 | shorten |
| Bus | bus:stats.help.rankings.source | 329 | 329 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.terminals.unit | 319 | 319 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.night.exclusions | 290 | 290 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.longestReturn.coverage | 290 | 290 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.km.unit | 282 | 282 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.night.unit | 275 | 275 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.km.source | 271 | 271 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.transfers.coverage | 258 | 258 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.transfers.exclusions | 258 | 258 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.rides.time | 251 | 251 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.hours.coverage | 251 | 251 | keep (already behind „Wie gezählt“) |
| Bus | bus:import.hint | 250 | 86 | shorten |
| Bus | bus:stats.help.transfers.unit | 247 | 247 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.km.coverage | 235 | 235 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.longestReturn.unit | 224 | 224 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.newDestinations.time | 224 | 224 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.newDestinations.unit | 222 | 222 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.terminals.time | 219 | 219 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.hours.time | 196 | 196 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.favourites.unit | 195 | 195 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.longestReturn.time | 176 | 176 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.rides.coverage | 164 | 164 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.transfers.time | 161 | 161 | keep (already behind „Wie gezählt“) |
| Bus | bus:import.noTemplate | 158 | 158 | keep (warning/error/consent stays visible) |
| Bus | bus:stats.help.rides.source | 156 | 156 | keep (already behind „Wie gezählt“) |
| Bus | bus:import.nothingRead | 155 | 155 | keep (review later) |
| Bus | bus:stats.help.rides.unit | 153 | 153 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.terminals.source | 150 | 150 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.rankings.unit | 149 | 149 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.night.time | 148 | 148 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.delays.coverage | 144 | 144 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.delays.unit | 143 | 143 | keep (already behind „Wie gezählt“) |
| Bus | bus:stats.help.newDestinations.exclusions | 142 | 142 | keep (already behind „Wie gezählt“) |
| common | common:photoChoose.hint | 314 | 89 | shorten |
| common | common:saveErrors.timezoneUnresolved | 234 | 234 | keep (warning/error/consent stays visible) |
| common | common:diagnostic.includes.userEvents | 215 | 215 | keep (review later) |
| common | common:staleBundle.message | 195 | 195 | keep (warning/error/consent stays visible) |
| common | common:diagnostic.excludes | 193 | 193 | keep (review later) |
| common | common:saveErrors.timezoneUnavailable | 190 | 190 | keep (warning/error/consent stays visible) |
| common | common:settings.modules.desc | 172 | 172 | keep (review later) |
| common | common:diagnostic.includes.events | 163 | 163 | keep (review later) |
| common | common:diagnostic.includes.userCounts | 161 | 161 | keep (review later) |
| common | common:saveErrors.staleBundle | 157 | 157 | keep (warning/error/consent stays visible) |
| common | common:diagnostic.includes.settings | 150 | 150 | keep (review later) |
| common | common:entryPhotos.removeAllConfirmMessage | 141 | 141 | keep (warning/error/consent stays visible) |
| common | common:diagnostic.reportBugHint | 129 | 72 | shorten |
| common | common:photoChoose.album.hint | 126 | 60 | shorten |
| common | common:diagnostic.description | 125 | 59 | shorten |
| companions | companions:person.rule | 199 | 199 | keep (review later) |
| companions | companions:manage.description | 197 | 65 | shorten |
| companions | companions:manage.deleteUnused.body_other | 159 | 159 | keep (warning/error/consent stays visible) |
| companions | companions:manage.deleteUnused.body_one | 154 | 154 | keep (warning/error/consent stays visible) |
| comparison | comparison:friend.settings.removeBody | 157 | 157 | keep (review later) |
| comparison | comparison:counting.flightTime | 154 | 154 | keep (review later) |
| comparison | comparison:counting.daysAway | 147 | 147 | keep (review later) |
| comparison | comparison:counting.lodging | 146 | 146 | keep (review later) |
| comparison | comparison:error.FEDERATION_ADMISSION_KEY_MISMATCH | 143 | 143 | keep (warning/error/consent stays visible) |
| comparison | comparison:friends.linkHint | 127 | 66 | shorten |
| dashboard | dashboard:lodgingTab.currencyBreakdown.hint | 173 | 74 | shorten |
| dashboard | dashboard:cruiseTab.emptyBody | 142 | 142 | keep (review later) |
| dashboard | dashboard:documentNotFiled | 141 | 141 | keep (review later) |
| Dienste | externalServices:services.photoprism.setup | 277 | 277 | keep (review later) |
| Dienste | externalServices:services.aiSuggestionHelp.dataOut | 234 | 234 | keep (review later) |
| Dienste | externalServices:services.mapMatching.why | 231 | 231 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:intro | 216 | 69 | shorten |
| Dienste | externalServices:services.geocoder.alwaysOnWhy | 191 | 191 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:services.fx.alwaysOnWhy | 188 | 188 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:services.aiSuggestionHelp.why | 180 | 180 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:services.calendar.why | 167 | 167 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:account.intro | 160 | 77 | shorten |
| Dienste | externalServices:services.mailIntake.why | 156 | 156 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:banner.summary | 153 | 153 | keep (review later) |
| Dienste | externalServices:consent.account.intro | 152 | 91 | shorten |
| Dienste | externalServices:services.suggestionPlugins.why | 148 | 148 | keep (warning/error/consent stays visible) |
| Dienste | externalServices:services.mailIntake.dataOut | 145 | 145 | keep (review later) |
| Dienste | externalServices:connections.hint | 132 | 76 | shorten |
| Dienste | externalServices:consent.admin.intro | 127 | 72 | shorten |
| Dienste | externalServices:useConsent.intro | 123 | 72 | shorten |
| documents | documents:deleteCascadeNote_other | 167 | 167 | keep (warning/error/consent stays visible) |
| documents | documents:links.linkToHint | 160 | 74 | shorten |
| documents | documents:links.bulkHint | 158 | 87 | shorten |
| documents | documents:deleteCascadeNote_one | 149 | 149 | keep (warning/error/consent stays visible) |
| documents | documents:links.alsoLinkHint | 141 | 61 | shorten |
| Einstellungen | settings:import.timeline.description | 453 | 74 | move behind ⓘ |
| Einstellungen | settings:profileZone.body | 352 | 87 | move behind ⓘ |
| Einstellungen | settings:import.tile.appImport.description | 344 | 81 | move behind ⓘ |
| Einstellungen | settings:routingPersonal.description | 325 | 84 | shorten |
| Einstellungen | settings:accountArchive.stays | 322 | 322 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:apiKeys.bulkRefresh.description | 298 | 87 | shorten |
| Einstellungen | settings:routing.description | 288 | 80 | shorten |
| Einstellungen | settings:railRouting.reroute.hint | 281 | 73 | shorten |
| Einstellungen | settings:railRouting.test.modeProfiles.missing | 278 | 278 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:recoveryKey.show.why | 270 | 270 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:lifeBook.note | 265 | 265 | keep (review later) |
| Einstellungen | settings:unreachable.flightProvider | 263 | 263 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:railProviders.description | 260 | 77 | shorten |
| Einstellungen | settings:unreachable.aerodatabox | 252 | 252 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:apiKeys.description | 242 | 80 | shorten |
| Einstellungen | settings:import.tile.checkin.description | 235 | 71 | move behind ⓘ |
| Einstellungen | settings:lifeBook.help | 234 | 62 | shorten |
| Einstellungen | settings:unreachable.photoJourneyScan | 234 | 234 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:notifications.smtpDeleteConfirm.message | 230 | 230 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:calendarFeed.description | 224 | 79 | shorten |
| Einstellungen | settings:apiTokens.providerWarning | 221 | 221 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:import.tile.tracker.description | 209 | 64 | move behind ⓘ |
| Einstellungen | settings:unreachable.dawarich | 207 | 207 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:location.trackGap.help | 201 | 45 | shorten |
| Einstellungen | settings:webdavSync.whatIsUploaded | 199 | 199 | keep (review later) |
| Einstellungen | settings:homeAirport.unconfirmedBody | 198 | 198 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:domainColors.lowContrast | 190 | 190 | keep (review later) |
| Einstellungen | settings:homeAirport.residenceRow.help | 183 | 75 | shorten |
| Einstellungen | settings:about.licenseBody | 182 | 182 | keep (review later) |
| Einstellungen | settings:apiKeys.bulkRefresh.confirmBody | 178 | 178 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:features.description | 177 | 62 | shorten |
| Einstellungen | settings:railRouting.hint | 176 | 43 | shorten |
| Einstellungen | settings:import.parserErrors.commitPartial | 171 | 171 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:unreachable.routing | 169 | 169 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:errors.webPrefsRetrying | 165 | 165 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:accountArchive.partial | 162 | 162 | keep (review later) |
| Einstellungen | settings:tt.places.help | 162 | 82 | shorten |
| Einstellungen | settings:devices.noPublicUrl | 160 | 160 | keep (review later) |
| Einstellungen | settings:unreachable.openData | 158 | 158 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:unreachable.photoprism | 156 | 156 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:unreachable.immich | 156 | 156 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:apiKeys.bulkRefresh.needsKey_other | 155 | 155 | keep (review later) |
| Einstellungen | settings:unreachable.rail | 155 | 155 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:apiKeys.bulkRefresh.needsKey_one | 153 | 153 | keep (review later) |
| Einstellungen | settings:errors.webPrefsTooLarge | 152 | 152 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:apiKeys.bulkRefresh.confirmHistoricalNote | 152 | 152 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:railRouting.reroute.done | 152 | 152 | keep (review later) |
| Einstellungen | settings:recoveryKey.file.keep | 152 | 152 | keep (review later) |
| Einstellungen | settings:tt.zones.difference | 151 | 151 | keep (review later) |
| Einstellungen | settings:calendarFeed.notRecoverable | 149 | 149 | keep (review later) |
| Einstellungen | settings:domains.description | 148 | 48 | shorten |
| Einstellungen | settings:location.source.status.notConfigured | 148 | 148 | keep (review later) |
| Einstellungen | settings:routing.openrouteservice.description | 147 | 73 | shorten |
| Einstellungen | settings:routing.graphhopper.description | 146 | 72 | shorten |
| Einstellungen | settings:recoveryKey.file.restoreManual | 144 | 144 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:recoveryKey.restore.intro | 142 | 87 | shorten |
| Einstellungen | settings:recoveryKey.file.restore | 141 | 141 | keep (warning/error/consent stays visible) |
| Einstellungen | settings:location.source.help | 137 | 86 | shorten |
| Einstellungen | settings:about.buildVersionHint | 136 | 69 | shorten |
| Einstellungen | settings:import.description | 134 | 82 | shorten |
| Einstellungen | settings:privacy.encryptedGrants.description | 130 | 76 | shorten |
| Einstellungen | settings:import.tile.genericCsv.description | 130 | 47 | shorten |
| Einstellungen | settings:import.tile.fr24.description | 128 | 46 | shorten |
| Einstellungen | settings:location.tt.cities.help | 128 | 75 | shorten |
| Einstellungen | settings:devices.codeHint | 125 | 74 | shorten |
| Einstellungen | settings:parser.description | 124 | 72 | shorten |
| Einstellungen | settings:services.description | 123 | 55 | shorten |
| Einstellungen (Zeilen) | settingsRows:server.internet.h | 402 | 402 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:backups.notes.secrets.s | 227 | 95 | shorten |
| Einstellungen (Zeilen) | settingsRows:dialogs.restorekey.after | 223 | 223 | keep (warning/error/consent stays visible) |
| Einstellungen (Zeilen) | settingsRows:backups.restoreFailure.recoveryKeyEnvPinned | 202 | 202 | keep (warning/error/consent stays visible) |
| Einstellungen (Zeilen) | settingsRows:data.excelimp.h | 197 | 197 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:backups.notes.machine.s | 189 | 100 | shorten |
| Einstellungen (Zeilen) | settingsRows:server.userkeys.h | 172 | 172 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:server.oplogos.h | 171 | 171 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:server.updcheck.h | 164 | 164 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:server.beta.h | 163 | 163 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:services.ui.intro | 162 | 73 | shorten |
| Einstellungen (Zeilen) | settingsRows:maintenance.tzLegacy.when | 158 | 158 | keep (review later) |
| Einstellungen (Zeilen) | settingsRows:services.routing.pickS | 157 | 157 | keep (review later) |
| Einstellungen (Zeilen) | settingsRows:services.tpl.pause.h | 154 | 154 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:server.fxcdn.h | 152 | 152 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:backups.restoreFailure.keySwapUnresolved | 149 | 149 | keep (warning/error/consent stays visible) |
| Einstellungen (Zeilen) | settingsRows:services.rows.dawinsturl.h | 142 | 142 | keep (already behind ⓘ) |
| Einstellungen (Zeilen) | settingsRows:services.routing.selectedUnavailable | 142 | 142 | keep (warning/error/consent stays visible) |
| Einstellungen (Zeilen) | settingsRows:backups.restoreFailure.unknown | 142 | 142 | keep (warning/error/consent stays visible) |
| Einstellungen (Zeilen) | settingsRows:lodging.ratingcats.h | 142 | 142 | keep (already behind ⓘ) |
| Fähre | ferry:import.hint | 289 | 75 | shorten |
| Fähre | ferry:routeEditor.scope.failed | 178 | 178 | keep (warning/error/consent stays visible) |
| Fähre | ferry:stats.help.km.unit | 166 | 166 | keep (already behind „Wie gezählt“) |
| Fähre | ferry:routing.clearAllConfirm.message | 157 | 157 | keep (warning/error/consent stays visible) |
| Fehler | errors:backend.nonHistoricalNeedsTimes | 300 | 300 | keep (warning/error/consent stays visible) |
| Fehler | errors:lookupOutsideLiveWindow | 262 | 262 | keep (warning/error/consent stays visible) |
| Fehler | errors:logoutServerFailed | 206 | 206 | keep (warning/error/consent stays visible) |
| Fehler | errors:lookupNotConfigured | 172 | 172 | keep (warning/error/consent stays visible) |
| Fehler | errors:airportLookupUnavailable.blocked | 161 | 161 | keep (warning/error/consent stays visible) |
| Fehler | errors:noFlightDataApiGap | 158 | 158 | keep (warning/error/consent stays visible) |
| Fehler | errors:airportLookupUnavailable.network | 158 | 158 | keep (warning/error/consent stays visible) |
| Fehler | errors:airportLookupUnavailable.timeout | 156 | 156 | keep (warning/error/consent stays visible) |
| Fehler | errors:airportLookupUnavailable.unknown | 149 | 149 | keep (warning/error/consent stays visible) |
| Fehler | errors:airportLookupUnavailable.http_error | 148 | 148 | keep (warning/error/consent stays visible) |
| Flüge | flights:form.help.flightNumberExpanded | 375 | 375 | keep (already behind ⓘ) |
| Flüge | flights:form.email.regexWarning.body | 354 | 354 | keep (warning/error/consent stays visible) |
| Flüge | flights:bookingPrice.countedOnce | 342 | 61 | move behind ⓘ |
| Flüge | flights:bookingPrice.noTotal | 247 | 247 | keep (review later) |
| Flüge | flights:form.help.tagsExpanded | 240 | 240 | keep (already behind ⓘ) |
| Flüge | flights:form.help.flightNumber | 201 | 201 | keep (review later) |
| Flüge | flights:track.uploadIntro | 198 | 86 | shorten |
| Flüge | flights:review.unconfirmedTimeNotice | 191 | 191 | keep (warning/error/consent stays visible) |
| Flüge | flights:refresh.intro | 185 | 79 | shorten |
| Flüge | flights:form.surfaceRailOff_other | 174 | 174 | keep (review later) |
| Flüge | flights:form.surfaceRailOff_one | 172 | 172 | keep (review later) |
| Flüge | flights:review.cancellationNotice | 157 | 157 | keep (review later) |
| Flüge | flights:track.errors.csvColumns | 153 | 153 | keep (warning/error/consent stays visible) |
| Flüge | flights:bookingPrice.otherEntries_other | 153 | 153 | keep (review later) |
| Flüge | flights:bookingPrice.otherEntries_one | 146 | 146 | keep (review later) |
| Flüge | flights:form.llmUnreachable | 144 | 144 | keep (review later) |
| Flüge | flights:bulk.outcomeUnknown | 143 | 143 | keep (warning/error/consent stays visible) |
| Flüge | flights:bookingPrice.splitDisplayOnly | 142 | 142 | keep (review later) |
| Flüge | flights:table.description | 129 | 43 | shorten |
| Fotos | immich:visitPhotosAuto.hint | 263 | 78 | shorten |
| Fotos | immich:visitPhotosAuto.capHint | 253 | 78 | shorten |
| Fotos | immich:apiKeyScopes | 212 | 212 | keep (review later) |
| Fotos | immich:cover.intro | 210 | 82 | shorten |
| Fotos | immich:nightlyScan.what | 189 | 189 | keep (review later) |
| Fotos | immich:cover.crop.hint | 179 | 74 | shorten |
| Fotos | immich:nightlyScan.privacyHelpMore | 170 | 170 | keep (already behind ⓘ) |
| Fotos | immich:autoCover.hint | 168 | 71 | shorten |
| Fotos | immich:selfPerson.hint | 167 | 79 | shorten |
| Fotos | immich:nightlyScan.privacyHelp | 154 | 71 | move behind ⓘ |
| Fotos | immich:errors.keyRequired | 153 | 153 | keep (warning/error/consent stays visible) |
| import | import:package.model.offer | 247 | 247 | keep (warning/error/consent stays visible) |
| import | import:email.cloudNotConsented.body | 195 | 195 | keep (warning/error/consent stays visible) |
| import | import:trip.document.description | 165 | 80 | shorten |
| import | import:email.regexWarning.body | 159 | 159 | keep (warning/error/consent stays visible) |
| import | import:email.providerIncomplete.body | 159 | 159 | keep (review later) |
| import | import:email.llmDisabled.body | 154 | 154 | keep (review later) |
| import | import:package.model.intro | 132 | 78 | shorten |
| Kreuzfahrt | cruise:stats.money.noTotalNote | 392 | 61 | move behind ⓘ |
| Kreuzfahrt | cruise:reimport.intro | 295 | 91 | shorten |
| Kreuzfahrt | cruise:stats.help.mostPorts.coverage | 273 | 273 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:unresolved.incomplete_other | 265 | 265 | keep (review later) |
| Kreuzfahrt | cruise:unresolved.incomplete_one | 260 | 260 | keep (review later) |
| Kreuzfahrt | cruise:tracks.intro | 259 | 82 | shorten |
| Kreuzfahrt | cruise:tracks.removeConfirmMessage | 205 | 205 | keep (warning/error/consent stays visible) |
| Kreuzfahrt | cruise:stats.help.baseTotal.coverage | 193 | 193 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:import.unmatchedHint | 185 | 78 | shorten |
| Kreuzfahrt | cruise:stats.help.season.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.averageNights.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.longestShortest.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.first.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.mostPorts.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.highestDeck.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.onTrips.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.cabinsCompanions.source | 163 | 163 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.baseTotal.source | 162 | 162 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:picker.shipSearchError | 157 | 157 | keep (warning/error/consent stays visible) |
| Kreuzfahrt | cruise:picker.geocodeRateLimited | 155 | 155 | keep (review later) |
| Kreuzfahrt | cruise:stats.help.season.unit | 152 | 152 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:flightGap.hint | 151 | 66 | shorten |
| Kreuzfahrt | cruise:stats.help.longestShortest.unit | 147 | 147 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.byCurrency.unit | 147 | 147 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:stats.help.cabinsCompanions.coverage | 147 | 147 | keep (already behind „Wie gezählt“) |
| Kreuzfahrt | cruise:form.identityHint | 127 | 57 | shorten |
| loyalty | loyalty:suggestions.hint | 158 | 71 | shorten |
| Mail-Eingang | mailIntake:admin.help | 377 | 78 | move behind ⓘ |
| Mail-Eingang | mailIntake:privacy.senders.help | 355 | 89 | shorten |
| Mail-Eingang | mailIntake:privacy.intro | 271 | 83 | shorten |
| Mail-Eingang | mailIntake:intro | 265 | 87 | shorten |
| Mail-Eingang | mailIntake:forwarding.help | 239 | 94 | shorten |
| Mail-Eingang | mailIntake:scan.description | 192 | 80 | shorten |
| Mail-Eingang | mailIntake:folder.help | 179 | 72 | shorten |
| Mail-Eingang | mailIntake:privacy.keepUnreadHelp | 178 | 78 | shorten |
| Mail-Eingang | mailIntake:privacy.keywords.help | 164 | 81 | shorten |
| map | map:webgl2Missing | 247 | 247 | keep (warning/error/consent stays visible) |
| map | map:filters.help.airlinesExpanded | 158 | 158 | keep (already behind ⓘ) |
| map | map:filters.help.timePeriodExpanded | 150 | 150 | keep (already behind ⓘ) |
| map | map:globe.panel.cruiseColorMode.perCruise.hint | 148 | 85 | shorten |
| Mietwagen | rental:stats.help.days.exclusions | 394 | 394 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.km.source | 288 | 288 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.costPerDay.coverage | 281 | 281 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.km.coverage | 261 | 261 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:form.depositReturnedHint | 246 | 80 | shorten |
| Mietwagen | rental:stats.help.brokers.unit | 243 | 243 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.vehicles.unit | 231 | 231 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:form.distanceHint | 227 | 63 | shorten |
| Mietwagen | rental:stats.help.oneWay.source | 209 | 209 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.promisedVsDriven.unit | 207 | 207 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.vehicles.coverage | 207 | 207 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.records.time | 206 | 206 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.kmPerDay.unit | 205 | 205 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.kmPerDay.coverage | 205 | 205 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.costPerKm.source | 198 | 198 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.days.unit | 196 | 196 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.brokers.coverage | 195 | 195 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.promisedVsDriven.source | 195 | 195 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.costPerDay.exclusions | 190 | 190 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.days.time | 186 | 186 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.records.coverage | 186 | 186 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:invoiceReview.fees.none | 186 | 186 | keep (review later) |
| Mietwagen | rental:stats.bookedVsFinalNone | 179 | 179 | keep (review later) |
| Mietwagen | rental:stats.help.bookedVsFinal.unit | 175 | 175 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.byYear.time | 174 | 174 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.promisedVsDriven.coverage | 168 | 168 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.costPerKm.exclusions | 167 | 167 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.bookedVsFinal.coverage | 166 | 166 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:invoiceReview.fees.totalBesideDifference | 165 | 165 | keep (review later) |
| Mietwagen | rental:form.depositHint | 160 | 54 | shorten |
| Mietwagen | rental:stats.help.costPerKm.coverage | 160 | 160 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:stats.help.costPerKm.unit | 146 | 146 | keep (already behind „Wie gezählt“) |
| Mietwagen | rental:form.invoiceHint | 145 | 53 | shorten |
| Mietwagen | rental:stats.help.countries.exclusions | 141 | 141 | keep (already behind „Wie gezählt“) |
| Neuigkeiten | whatsNew:entries.v260.documents.body | 995 | 995 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.beta.body | 523 | 523 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.countries.body | 518 | 518 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.transport.body | 378 | 378 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.beta.body | 363 | 363 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.travtrack.body | 358 | 358 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.sharing.body | 349 | 349 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.lodging.body | 347 | 347 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.mail.body | 340 | 340 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.connections.body | 338 | 338 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.placesPhotos.body | 337 | 337 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.documents.body | 335 | 335 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.note.p3 | 334 | 334 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.settings.body | 325 | 325 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.data.body | 325 | 325 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.app.body | 325 | 325 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v250.flightForm.body | 316 | 316 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.transport.body | 312 | 312 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.lodging.body | 304 | 304 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.evidence.body | 303 | 303 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v250.immich.body | 302 | 302 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.design.body | 290 | 290 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v250.companions.body | 272 | 272 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.imports.body | 266 | 266 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.stats.body | 264 | 264 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v250.status.body | 259 | 259 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v250.flightsTable.body | 251 | 251 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v280.beta.body | 249 | 249 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v240.map.body | 235 | 235 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v260.security.body | 234 | 234 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v240.colorModes.body | 217 | 217 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.note.p4 | 216 | 216 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.note.p1 | 211 | 211 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v240.fixes.body | 202 | 202 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v240.polish.body | 191 | 191 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v240.airlines.body | 177 | 177 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v230.stats.body | 164 | 164 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:entries.v270.note.p2 | 162 | 162 | keep (release notes, read on demand) |
| Neuigkeiten | whatsNew:subtitle | 157 | 157 | keep (release notes, read on demand) |
| notes | notes:editor.shareableHint | 197 | 82 | shorten |
| notes | notes:editor.zoneHint | 161 | 55 | shorten |
| notes | notes:empty.description | 134 | 70 | shorten |
| openData | openData:settings.description | 196 | 78 | shorten |
| Orte | places:import.document.description | 251 | 81 | shorten |
| Orte | places:stats.insights.discoveries.help.coverage | 238 | 238 | keep (already behind „Wie gezählt“) |
| Orte | places:import.csv.description | 207 | 81 | shorten |
| Orte | places:import.document.fallback.noTemplate | 173 | 173 | keep (warning/error/consent stays visible) |
| Orte | places:import.takeout.noKey | 165 | 165 | keep (review later) |
| Orte | places:stats.insights.jump.help.coverage | 162 | 162 | keep (already behind „Wie gezählt“) |
| Orte | places:stats.help.busiestMonth.coverage | 158 | 158 | keep (already behind „Wie gezählt“) |
| Orte | places:merge.curated.sameList | 158 | 158 | keep (review later) |
| Orte | places:nearby.origin.deviceHint | 148 | 58 | shorten |
| Orte | places:form.countryTransitByCategory | 147 | 147 | keep (review later) |
| Orte | places:merge.curated.twoLists | 147 | 147 | keep (review later) |
| Orte | places:import.takeout.intro_other | 144 | 79 | shorten |
| Orte | places:smartList.autoAcceptHint | 143 | 65 | shorten |
| Orte | places:detail.dateHint | 142 | 76 | shorten |
| Orte | places:stats.help.visitedPlaces.time | 142 | 142 | keep (already behind „Wie gezählt“) |
| Orte | places:import.takeout.intro_one | 142 | 78 | shorten |
| Orte | places:import.preview.needsInputHint | 141 | 65 | shorten |
| Orte | places:merge.intro | 133 | 72 | shorten |
| Orte | places:form.statusHint | 129 | 68 | shorten |
| Orte | places:customCategories.manageHint | 121 | 62 | shorten |
| Parser | parser:workshop.domainHints.package | 265 | 265 | keep (review later) |
| Parser | parser:workshop.domainHints.ferry | 258 | 258 | keep (review later) |
| Parser | parser:workshop.domainHints.rail | 255 | 255 | keep (review later) |
| Parser | parser:communityExport.refused.TEMPLATE_EXPORT_SOURCE_MISSING | 248 | 248 | keep (warning/error/consent stays visible) |
| Parser | parser:workshop.domainHints.bus | 247 | 247 | keep (review later) |
| Parser | parser:communityExport.refused.TEMPLATE_EXPORT_PERSONAL_DATA | 220 | 220 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.railNeedsLegRow | 218 | 218 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.cruiseNeedsStopRow | 211 | 211 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.rentalEndsAmbiguous | 206 | 206 | keep (warning/error/consent stays visible) |
| Parser | parser:workshop.domainHints.rental | 203 | 203 | keep (review later) |
| Parser | parser:derivation.cannot.cruiseStopRowTooFarApart | 194 | 194 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.rideNeedsRow | 187 | 187 | keep (warning/error/consent stays visible) |
| Parser | parser:overview.uploadHelp | 182 | 79 | shorten |
| Parser | parser:workshop.domainHints.cruise | 180 | 180 | keep (review later) |
| Parser | parser:derivation.cannot.cruiseStopRowNotUnderstood | 178 | 178 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.railNeedsDate | 175 | 175 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.lodgingDateNotUnderstood | 172 | 172 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.lodgingNeedsNameAndDates | 171 | 171 | keep (warning/error/consent stays visible) |
| Parser | parser:workshop.domainHints.place | 168 | 168 | keep (review later) |
| Parser | parser:derivation.cannot.rentalNeedsBookingFields | 160 | 160 | keep (warning/error/consent stays visible) |
| Parser | parser:annotate.uploadErrors.TRAINING_IMAGE_NO_TEXT | 150 | 150 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.railRowNotUnderstood | 147 | 147 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.dateNotUnderstood | 144 | 144 | keep (warning/error/consent stays visible) |
| Parser | parser:derivation.cannot.noDistinguishingMarker | 143 | 143 | keep (warning/error/consent stays visible) |
| Parser | parser:communityTemplates.sync.indexUnreachable | 141 | 141 | keep (review later) |
| Parser | parser:overview.whatHelp | 141 | 77 | shorten |
| Parser | parser:annotate.description | 130 | 63 | shorten |
| Pass | passport:countries.groundTimeLegend | 356 | 60 | move behind ⓘ |
| Pass | passport:unconfirmed.explanationLocation | 260 | 260 | keep (warning/error/consent stays visible) |
| Pass | passport:provenance.trackNote | 242 | 242 | keep (review later) |
| Pass | passport:unconfirmed.explanation | 242 | 242 | keep (warning/error/consent stays visible) |
| Pass | passport:ground.unknownExplained | 224 | 224 | keep (warning/error/consent stays visible) |
| Pass | passport:countingRule | 223 | 223 | keep (review later) |
| Pass | passport:tiers.visitedExplained | 205 | 205 | keep (review later) |
| Pass | passport:countries.dashLegend | 200 | 47 | move behind ⓘ |
| Pass | passport:ground.measuredExplained | 186 | 186 | keep (review later) |
| Pass | passport:tiers.transitedExplained | 174 | 174 | keep (review later) |
| Pass | passport:value.noDatedDays | 174 | 174 | keep (review later) |
| Pass | passport:ground.notApplicableExplained | 163 | 163 | keep (review later) |
| Pass | passport:tiers.connectionExplained | 149 | 149 | keep (review later) |
| Pass | passport:value.daysPresentExplained | 144 | 144 | keep (review later) |
| Pass | passport:tiers.sleptExplained | 142 | 142 | keep (review later) |
| pendingUpdates | pendingUpdates:empty.description | 145 | 32 | shorten |
| Posteingang | dataQuality:flag.actions.convert.hint | 244 | 72 | shorten |
| Posteingang | dataQuality:inbox.photoJourneys.review.description | 239 | 86 | shorten |
| Posteingang | dataQuality:inbox.workspace.location.emptyDescription | 230 | 82 | shorten |
| Posteingang | dataQuality:unfiledDocuments.description | 220 | 85 | shorten |
| Posteingang | dataQuality:unfiledDocuments.empty.body | 220 | 220 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.journey.effect | 191 | 191 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.location.effect | 185 | 185 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.tripAway.effect | 177 | 177 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.tripAway.effectExtend | 177 | 177 | keep (review later) |
| Posteingang | dataQuality:kinds.home_residence_unconfirmed.body | 177 | 177 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:inbox.review.time.description | 176 | 79 | shorten |
| Posteingang | dataQuality:inbox.photoJourneys.review.alreadyVisited | 174 | 174 | keep (review later) |
| Posteingang | dataQuality:documentLinkSuggestions.description | 171 | 82 | shorten |
| Posteingang | dataQuality:inbox.workspace.journey.errors.entryMismatch | 166 | 166 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:inbox.workspace.location.evidence | 163 | 163 | keep (review later) |
| Posteingang | dataQuality:kinds.time_zone_unresolved.question | 163 | 163 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.recheckHint | 162 | 72 | shorten |
| Posteingang | dataQuality:inbox.tripSuggestions.home.missing | 160 | 160 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:kinds.surface_segment.question | 159 | 159 | keep (review later) |
| Posteingang | dataQuality:inbox.photoJourneys.review.creates.chosenPlace | 155 | 155 | keep (review later) |
| Posteingang | dataQuality:kinds.trip_entries_outside.question | 151 | 151 | keep (review later) |
| Posteingang | dataQuality:inbox.tripSuggestions.description | 148 | 68 | shorten |
| Posteingang | dataQuality:unfiledDocuments.create.hint | 147 | 78 | shorten |
| Posteingang | dataQuality:kinds.duplicate_candidate.safePath | 146 | 146 | keep (review later) |
| Posteingang | dataQuality:inbox.photoJourneys.creates.stayAnswerOnly | 144 | 144 | keep (review later) |
| Posteingang | dataQuality:inbox.workspace.location.errors.historyChanged | 143 | 143 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:inbox.photoJourneys.review.requestFailed | 141 | 141 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:inbox.tripSuggestions.errors.stale | 141 | 141 | keep (warning/error/consent stays visible) |
| Posteingang | dataQuality:placeCaptures.description | 138 | 78 | shorten |
| provenance | provenance:notices.description | 149 | 74 | shorten |
| purpose | purpose:field.hint | 310 | 81 | shorten |
| purpose | purpose:trip.rowCategory | 166 | 166 | keep (review later) |
| purpose | purpose:visibility.intro | 129 | 54 | shorten |
| pushRelay | pushRelay:explanation.stores | 267 | 267 | keep (review later) |
| pushRelay | pushRelay:explanation.receives | 245 | 245 | keep (review later) |
| pushRelay | pushRelay:explanation.operator | 191 | 191 | keep (review later) |
| pushRelay | pushRelay:defaultOff | 158 | 158 | keep (review later) |
| readiness | readiness:checks.adminKeySwapInterrupted.consequence | 462 | 462 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.adminRailRerouteMissed.consequence | 238 | 238 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userTravtrackDerivation.consequence | 213 | 213 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userTravtrackQuestionableDays.consequence | 211 | 211 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.adminRoutingKeyUnused.consequence | 200 | 200 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userZoneMismatch.consequence | 199 | 199 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userCompanionDuplicates.consequence | 188 | 188 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.adminRecoveryKey.consequence | 186 | 186 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userTravtrackSilent.consequence | 153 | 153 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.userVisitScanBacklog.consequence | 144 | 144 | keep (warning/error/consent stays visible) |
| readiness | readiness:checks.adminRailReroute.consequence | 143 | 143 | keep (warning/error/consent stays visible) |
| Reisen | trips:deleteTripConfirm | 484 | 484 | keep (warning/error/consent stays visible) |
| Reisen | trips:deleteTripConfirmKept | 446 | 446 | keep (warning/error/consent stays visible) |
| Reisen | trips:dawarichStays.areas.description | 394 | 74 | shorten |
| Reisen | trips:dawarichStays.description | 272 | 87 | shorten |
| Reisen | trips:dawarichStays.travtrack.description | 258 | 88 | shorten |
| Reisen | trips:tours.tracks.deleteConfirm.message_other | 250 | 250 | keep (warning/error/consent stays visible) |
| Reisen | trips:tours.tracks.deleteConfirm.message_one | 248 | 248 | keep (warning/error/consent stays visible) |
| Reisen | trips:cleanup.intro | 186 | 77 | shorten |
| Reisen | trips:bookingPackage.stale | 181 | 181 | keep (warning/error/consent stays visible) |
| Reisen | trips:tours.deleteConfirm.message_other | 179 | 179 | keep (warning/error/consent stays visible) |
| Reisen | trips:dawarichStays.evidenceUnverifiable | 178 | 178 | keep (review later) |
| Reisen | trips:tours.deleteConfirm.message_one | 177 | 177 | keep (warning/error/consent stays visible) |
| Reisen | trips:summary.cta | 163 | 163 | keep (review later) |
| Reisen | trips:packing.notice.staleReloadFailed | 157 | 157 | keep (warning/error/consent stays visible) |
| Reisen | trips:tours.tracks.truncatedReason | 154 | 154 | keep (warning/error/consent stays visible) |
| Reisen | trips:dawarichStays.uncertainty.sourceUnknown | 151 | 151 | keep (warning/error/consent stays visible) |
| Reisen | trips:tours.move.photosError | 148 | 148 | keep (warning/error/consent stays visible) |
| Reisen | trips:packing.notice.stale | 145 | 145 | keep (warning/error/consent stays visible) |
| Reisen | trips:tours.tracks.errors.doesNotCoverLeg | 144 | 144 | keep (warning/error/consent stays visible) |
| Reisen | trips:recording.deleteConfirmMessage | 143 | 143 | keep (warning/error/consent stays visible) |
| Reisen | trips:export.intro | 139 | 79 | shorten |
| Reisen | trips:merge.intro | 129 | 64 | shorten |
| Roadtrips | roadtrips:detail.distanceRule | 376 | 28 | move behind ⓘ |
| Roadtrips | roadtrips:trackArchive.importDescription | 280 | 87 | shorten |
| Roadtrips | roadtrips:stats.tours.activities.help.exclusions | 264 | 264 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:trackArchive.exportDescription | 237 | 49 | shorten |
| Roadtrips | roadtrips:draft.firstMessage | 213 | 213 | keep (review later) |
| Roadtrips | roadtrips:stats.insights.pace.help.coverage | 206 | 206 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.tours.links.help.coverage | 204 | 204 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:conflict.intro.live | 203 | 203 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:conflict.intro.restore | 195 | 195 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:stats.tours.links.help.time | 191 | 191 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.tours.activities.help.coverage | 190 | 190 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.insights.pace.help.unit | 189 | 189 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.insights.progress.help.time | 186 | 186 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.help.nights.exclusions | 184 | 184 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.tours.activities.help.time | 176 | 176 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.insights.progress.help.source | 175 | 175 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:odometerDialog.intro | 175 | 71 | shorten |
| Roadtrips | roadtrips:stats.help.count.time | 173 | 173 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:editor.discardConfirm.message | 168 | 168 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:strava.adminHelp | 167 | 93 | shorten |
| Roadtrips | roadtrips:costs.dialog.error.conflict | 167 | 167 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:startFrom.afterFailed | 167 | 167 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:conflict.readFailed | 158 | 158 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:editor.hint | 157 | 75 | shorten |
| Roadtrips | roadtrips:stats.tours.activities.row_other | 156 | 156 | keep (review later) |
| Roadtrips | roadtrips:stats.tours.activities.row_one | 154 | 154 | keep (review later) |
| Roadtrips | roadtrips:review.intro | 150 | 63 | shorten |
| Roadtrips | roadtrips:costs.deleteConfirm.message | 150 | 150 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:stats.insights.nightStyle.help.unit | 148 | 148 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.help.countries.exclusions | 148 | 148 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:editor.removedRestoresLine | 148 | 148 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:costs.fx.outcome.lookupFailed | 147 | 147 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:stats.insights.nightStyle.help.exclusions | 146 | 146 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:shift.intro | 146 | 72 | shorten |
| Roadtrips | roadtrips:komootHint | 145 | 52 | shorten |
| Roadtrips | roadtrips:stats.insights.progress.help.coverage | 144 | 144 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:stats.help.nights.unit | 144 | 144 | keep (already behind „Wie gezählt“) |
| Roadtrips | roadtrips:editor.mapAdd.failed | 144 | 144 | keep (warning/error/consent stays visible) |
| Roadtrips | roadtrips:costs.fx.noneUndated | 142 | 142 | keep (review later) |
| routing | routing:admin.hint | 321 | 83 | shorten |
| routing | routing:rail.hint | 315 | 85 | shorten |
| routing | routing:rail.readiness_other | 152 | 152 | keep (review later) |
| routing | routing:rail.readiness_one | 150 | 150 | keep (review later) |
| routing | routing:rail.modeAllHint | 123 | 79 | shorten |
| Server/Admin | admin:operatorLogos.description | 444 | 82 | shorten |
| Server/Admin | admin:federation.qrHint | 383 | 88 | move behind ⓘ |
| Server/Admin | admin:fxCdn.description | 341 | 80 | shorten |
| Server/Admin | admin:templateRepo.description | 338 | 52 | shorten |
| Server/Admin | admin:parserSettings.provider.description | 336 | 74 | shorten |
| Server/Admin | admin:federation.rotateConfirm.message | 322 | 322 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:instance.fields.betaFeatures.features.federatedTripSharing.what | 309 | 309 | keep (review later) |
| Server/Admin | admin:parserSettings.provider.chain.hint | 307 | 87 | shorten |
| Server/Admin | admin:parserSettings.provider.slots.custom.consent.warning | 297 | 297 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:parserSettings.order.hint | 288 | 81 | shorten |
| Server/Admin | admin:parserSettings.provider.slots.anthropic.consent.warning | 282 | 282 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:parserSettings.provider.slots.openai.consent.warning | 276 | 276 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:parserSettings.provider.slots.google.consent.warning | 276 | 276 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:timeModel.reResolve.description | 275 | 94 | shorten |
| Server/Admin | admin:aeroapi.description | 267 | 82 | shorten |
| Server/Admin | admin:federation.tripSharingSub | 253 | 253 | keep (review later) |
| Server/Admin | admin:travTrack.description | 248 | 77 | shorten |
| Server/Admin | admin:instance.fields.countryThreshold.help | 240 | 60 | shorten |
| Server/Admin | admin:parserSettings.ollama.description | 235 | 85 | shorten |
| Server/Admin | admin:airlineAircraftMasterData.airport.description | 232 | 106 | shorten |
| Server/Admin | admin:instance.passkeys.rpId.help | 225 | 73 | shorten |
| Server/Admin | admin:instance.fields.publicUrl.help | 223 | 72 | shorten |
| Server/Admin | admin:federation.error.COMPARISON_PEER_KEY_INVALID | 217 | 217 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:backup.description | 215 | 84 | shorten |
| Server/Admin | admin:lodgingChains.deleteInUse | 215 | 215 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:federation.importedReplaces | 213 | 213 | keep (review later) |
| Server/Admin | admin:backup.failure.BACKUP_TOOL_MISSING | 212 | 212 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:instance.fields.betaFeatures.features.travPlan.what | 206 | 206 | keep (review later) |
| Server/Admin | admin:importMode.description | 204 | 82 | shorten |
| Server/Admin | admin:federation.description | 203 | 100 | shorten |
| Server/Admin | admin:lodgingChains.mergeExplain | 203 | 203 | keep (review later) |
| Server/Admin | admin:federation.checklist.users | 189 | 189 | keep (review later) |
| Server/Admin | admin:instance.passkeys.origins.help | 188 | 60 | shorten |
| Server/Admin | admin:parserSettings.llmSwitch.hint | 188 | 88 | shorten |
| Server/Admin | admin:federation.admissions.tripSharingNote | 180 | 180 | keep (review later) |
| Server/Admin | admin:travPlan.description | 176 | 52 | shorten |
| Server/Admin | admin:federation.error.COMPARISON_CONNECTION_FILE_ORIGIN | 165 | 165 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:timeModel.reResolve.confirm.message_other | 162 | 162 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:timeModel.errors.outcomeUnknown | 159 | 159 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:airlineAircraftMasterData.aircraft.description | 157 | 75 | shorten |
| Server/Admin | admin:timeModel.report.statement.answered_other | 155 | 155 | keep (review later) |
| Server/Admin | admin:users.description | 154 | 72 | shorten |
| Server/Admin | admin:timeModel.errors.unreadable | 154 | 154 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:timeModel.report.statement.answered_one | 153 | 153 | keep (review later) |
| Server/Admin | admin:airlineAircraftMasterData.airline.description | 152 | 70 | shorten |
| Server/Admin | admin:federation.checklist.identity.invalidOrigin | 152 | 152 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:lodgingChains.renameNote | 152 | 152 | keep (review later) |
| Server/Admin | admin:cruiseMasterData.ship.description | 151 | 69 | shorten |
| Server/Admin | admin:logging.level.pinned | 151 | 151 | keep (review later) |
| Server/Admin | admin:timeModel.reResolve.confirm.message_one | 151 | 151 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:instance.fields.betaFeatures.help | 150 | 77 | shorten |
| Server/Admin | admin:backup.cloudList.description | 146 | 64 | shorten |
| Server/Admin | admin:timeModel.report.statement.open_other | 145 | 145 | keep (review later) |
| Server/Admin | admin:timeModel.report.statement.open_one | 143 | 143 | keep (review later) |
| Server/Admin | admin:federation.error.FEDERATION_ADMISSION_KEY_MISMATCH | 143 | 143 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:federation.error.COMPARISON_PEER_UNREACHABLE | 142 | 142 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:templateRepo.syncFailed_other | 142 | 142 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:federation.advancedHint | 141 | 72 | shorten |
| Server/Admin | admin:templateRepo.syncFailed_one | 141 | 141 | keep (warning/error/consent stays visible) |
| Server/Admin | admin:loginBackgrounds.hint | 138 | 60 | shorten |
| Server/Admin | admin:cruiseMasterData.port.description | 132 | 62 | shorten |
| Server/Admin | admin:parserSettings.provider.slots.custom.hint | 129 | 64 | shorten |
| Server/Admin | admin:backup.schedule.description | 128 | 44 | shorten |
| Server/Admin | admin:lodgingChains.description | 128 | 72 | shorten |
| Server/Admin | admin:federation.importHint | 125 | 67 | shorten |
| Server/Admin | admin:federation.checklist.peersHint | 125 | 61 | shorten |
| Server/Admin | admin:parserSettings.description | 123 | 84 | shorten |
| setup | setup:freeServices.description | 270 | 74 | shorten |
| setup | setup:freeServices.alreadyOn | 201 | 201 | keep (review later) |
| setup | setup:airportSeeding.modal.description | 162 | 66 | shorten |
| Statistik | stats:insights.help.cruisePorts.unit | 490 | 490 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseDays.unit | 489 | 489 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseEvents.source | 485 | 485 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.story.unit | 481 | 481 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseDays.exclusions | 424 | 424 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseExcursions.unit | 404 | 404 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseExcursions.source | 380 | 380 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.helpWithRailAndBus | 372 | 372 | keep (review later) |
| Statistik | stats:crossDomain.help.unit | 365 | 365 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseReunion.time | 363 | 363 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.helpWithRail | 359 | 359 | keep (review later) |
| Statistik | stats:travelAccount.helpWithBus | 359 | 359 | keep (review later) |
| Statistik | stats:cruiseSection.help.flags.unit | 351 | 351 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.help | 346 | 77 | shorten |
| Statistik | stats:domainRecords.help.unit | 345 | 345 | keep (already behind „Wie gezählt“) |
| Statistik | stats:yearFilter.help.time | 324 | 324 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.transfers.source | 322 | 322 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.countries.unit | 321 | 321 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseReunion.unit | 318 | 318 | keep (already behind „Wie gezählt“) |
| Statistik | stats:domainRecords.help.exclusions | 306 | 306 | keep (already behind „Wie gezählt“) |
| Statistik | stats:crossDomain.help.coverage | 300 | 300 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.reunions.unit | 289 | 289 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseItineraries.unit | 285 | 285 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseStays.coverage | 284 | 284 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.nights.time | 283 | 283 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.routes.unit | 282 | 282 | keep (already behind „Wie gezählt“) |
| Statistik | stats:domainRecords.help.coverage | 282 | 282 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.nights.coverage | 280 | 280 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.longestLeg.source | 277 | 277 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.maxPortsSingle.coverage | 275 | 275 | keep (already behind „Wie gezählt“) |
| Statistik | stats:carbon.help.perMode.source | 271 | 271 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.story.time | 269 | 269 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.story.coverage | 268 | 268 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseDays.coverage | 267 | 267 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.discovery.time | 261 | 261 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseMoney.coverage | 260 | 260 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.transfers.unit | 258 | 258 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.countries.coverage | 257 | 257 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseExcursions.coverage | 255 | 255 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.experiences.exclusions | 254 | 254 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseStays.unit | 245 | 245 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.transfers.coverageDetail | 237 | 237 | keep (review later) |
| Statistik | stats:insights.help.cruiseExcursions.exclusions | 237 | 237 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.experiences.unit | 231 | 231 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseEvents.coverage | 231 | 231 | keep (already behind „Wie gezählt“) |
| Statistik | stats:years.help | 231 | 76 | shorten |
| Statistik | stats:wrapped.help.travTrackDays.coverage | 230 | 230 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseEvents.unit | 229 | 229 | keep (already behind „Wie gezählt“) |
| Statistik | stats:scorecard.help.flights.time | 227 | 227 | keep (already behind „Wie gezählt“) |
| Statistik | stats:scorecard.help.distance.time | 227 | 227 | keep (already behind „Wie gezählt“) |
| Statistik | stats:scorecard.help.flightTime.time | 227 | 227 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.totalDistance.coverage | 226 | 226 | keep (already behind „Wie gezählt“) |
| Statistik | stats:crossDomain.help.exclusions | 226 | 226 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.discovery.unit | 223 | 223 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.airborne.unit | 220 | 220 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.tripsCovered.source | 216 | 216 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.totalDistance.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.ports.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.avgPortsPerCruise.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.maxPortsSingle.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.revisitRate.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.tags.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseEvents.time | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:crossDomain.help.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik | stats:crossDomain.help.time | 212 | 212 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.quarters.time | 209 | 209 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.discovery.coverage | 207 | 207 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.transfers.exclusions | 207 | 207 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.travTrackTopSpeed.coverage | 205 | 205 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.transfers.coverage | 205 | 205 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.overflown.coverage | 205 | 205 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.activeDays.coverage | 203 | 203 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruisePorts.time | 203 | 203 | keep (already behind „Wie gezählt“) |
| Statistik | stats:yearFilter.help.coverage | 202 | 202 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseDays.source | 202 | 202 | keep (already behind „Wie gezählt“) |
| Statistik | stats:domainRecords.help.time | 202 | 202 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.codeshare.unit | 201 | 201 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.codeshare.coverage | 201 | 201 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.rentals.exclusions | 200 | 200 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.quarters.unit | 196 | 196 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseStays.time | 194 | 194 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.stays.coverage | 189 | 189 | keep (already behind „Wie gezählt“) |
| Statistik | stats:domainRecords.help.source | 189 | 189 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.tripsCovered.unit | 188 | 188 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.cruise.stays.coverage | 185 | 185 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.revisitRate.coverage | 184 | 184 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.totalDistance.unit | 182 | 182 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseExcursions.time | 182 | 182 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruisePorts.coverage | 181 | 181 | keep (already behind „Wie gezählt“) |
| Statistik | stats:companionsTogether.help.days.time | 180 | 180 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.cruise.excursions.empty | 179 | 179 | keep (review later) |
| Statistik | stats:help.totalFlightTimeExpanded | 178 | 178 | keep (already behind ⓘ) |
| Statistik | stats:insights.help.reunions.coverage | 178 | 178 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseDays.time | 177 | 177 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseItineraries.time | 176 | 176 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.airborne.coverage | 176 | 176 | keep (already behind „Wie gezählt“) |
| Statistik | stats:companionsTogether.help.days.exclusions | 176 | 176 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseReunion.coverage | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseShips.exclusions | 169 | 169 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.roadtrips.exclusions | 165 | 165 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruisePorts.source | 165 | 165 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.ferry.coverage | 164 | 164 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.ports.coverage | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseReunion.exclusions | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseShips.coverage | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik | stats:carbon.help.perMode.unit | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.stays.exclusions | 160 | 160 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.bus.coverage | 160 | 160 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.nights.unit | 159 | 159 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.routes.time | 159 | 159 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.tours.exclusions | 158 | 158 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseStays.source | 158 | 158 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.help.ferry.exclusions | 157 | 157 | keep (already behind „Wie gezählt“) |
| Statistik | stats:carbon.help.perMode.exclusions | 156 | 156 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.flags.exclusions | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.transfers.empty | 154 | 154 | keep (review later) |
| Statistik | stats:wrapped.help.bus.exclusions | 153 | 153 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.intro | 153 | 58 | shorten |
| Statistik | stats:insights.cruise.money.coverage | 153 | 153 | keep (already behind „Wie gezählt“) |
| Statistik | stats:carbon.cruiseNote | 151 | 151 | keep (review later) |
| Statistik | stats:cruiseSection.help.countries.coverage | 150 | 150 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.cruiseItineraries.source | 150 | 150 | keep (already behind „Wie gezählt“) |
| Statistik | stats:wrapped.nothingYet | 148 | 148 | keep (review later) |
| Statistik | stats:wrapped.help.places.exclusions | 148 | 148 | keep (already behind „Wie gezählt“) |
| Statistik | stats:yearFilter.help.unit | 147 | 147 | keep (already behind „Wie gezählt“) |
| Statistik | stats:help.totalDistanceExpanded | 147 | 147 | keep (already behind ⓘ) |
| Statistik | stats:insights.help.cruiseItineraries.coverage | 147 | 147 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.tripsCovered.coverage | 146 | 146 | keep (already behind „Wie gezählt“) |
| Statistik | stats:travelAccount.counting.avgTripDays.unit | 146 | 146 | keep (already behind „Wie gezählt“) |
| Statistik | stats:scorecard.help.flightTime.source | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.totalDaysNoSea.unit | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.reunions.time | 144 | 144 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.reunions.exclusions | 144 | 144 | keep (already behind „Wie gezählt“) |
| Statistik | stats:cruiseSection.help.seaDaysStreak.coverage | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik | stats:overviewKpis.help.experiences.time | 142 | 142 | keep (already behind „Wie gezählt“) |
| Statistik | stats:insights.help.story.source | 141 | 141 | keep (already behind „Wie gezählt“) |
| Statistik | stats:companionsTogether.help.days.source | 141 | 141 | keep (already behind „Wie gezählt“) |
| Statistik | stats:seats.noDataHint | 125 | 59 | shorten |
| Statistik (Flüge) | flightStatsHelp:seats.position.coverage | 472 | 472 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.newThisYear.time | 348 | 348 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.countries.coverage | 331 | 331 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.flightTime.unit | 329 | 329 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.aircraft.coverage | 323 | 323 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.rarest.coverage | 300 | 300 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.cost.coverage | 280 | 280 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.eastWest.unit | 277 | 277 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.seasons.unit | 274 | 274 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.airlines.unit | 265 | 265 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.timeTravel.unit | 260 | 260 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.internationalDomestic.unit | 251 | 251 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerKm.coverage | 250 | 250 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.sameDay.time | 250 | 250 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.midnight.time | 250 | 250 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.longestLayover.exclusions | 247 | 247 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.continentDistribution.unit | 245 | 245 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.cost.unit | 244 | 244 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:charts.weekday.time | 241 | 241 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.position.exclusions | 239 | 239 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.co2.unit | 238 | 238 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.airlines.source | 236 | 236 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.airlines.unit | 235 | 235 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.busiestDay.coverage | 232 | 232 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.airlines.coverage | 232 | 232 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerHour.time | 226 | 226 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.travelChain.time | 225 | 225 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.fastestRoute.time | 224 | 224 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.shortestLayover.coverage | 221 | 221 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.farthestFromHome.exclusions | 220 | 220 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.longestLayover.time | 219 | 219 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.shortestLayover.time | 219 | 219 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.flightTime.unit | 218 | 218 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.shortestLayover.exclusions | 216 | 216 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.longestLayover.coverage | 215 | 215 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.longestFlight.unit | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.farthestFromHome.coverage | 214 | 214 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.hemisphere.unit | 213 | 213 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.travelChain.unit | 213 | 213 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.totalCost.unit | 212 | 212 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.loyalty.source | 209 | 209 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.avgDuration.time | 209 | 209 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.fastestDay.coverage | 207 | 207 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.flights.time | 205 | 205 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.shortestLayover.unit | 204 | 204 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.eastWest.exclusions | 203 | 203 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.longestLayover.unit | 203 | 203 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.farthestFromHome.time | 202 | 202 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.avgDuration.coverage | 201 | 201 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.continentCount.unit | 200 | 200 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.shortestFlight.exclusions | 199 | 199 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerHour.coverage | 198 | 198 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.airlines.coverage | 196 | 196 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.worstRoute.exclusions | 195 | 195 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.flightTime.exclusions | 194 | 194 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.weekend.exclusions | 193 | 193 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.zone.coverage | 193 | 193 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.flightTime.coverage | 192 | 192 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.airlines.unit | 192 | 192 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:charts.seasonal.time | 191 | 191 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.roundTrips.unit | 189 | 189 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.timeTravel.time | 188 | 188 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.airlines.exclusions | 188 | 188 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:distance.milestones.unit | 187 | 187 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.seasons.time | 187 | 187 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.equator.coverage | 186 | 186 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.earlyBird.exclusions | 185 | 185 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.afternoon.exclusions | 185 | 185 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.nightOwl.exclusions | 185 | 185 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerKm.unit | 184 | 184 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.continents.coverage | 182 | 182 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.avgDelay.unit | 181 | 181 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.airports.unit | 180 | 180 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.midnight.unit | 180 | 180 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.travelChain.coverage | 180 | 180 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.farthestFromHome.unit | 180 | 180 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.fastestDay.time | 177 | 177 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.co2.coverage | 177 | 177 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.cost.exclusions | 176 | 176 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.dateLine.coverage | 176 | 176 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.timezoneHopper.unit | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.timeTravel.exclusions | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.sameDay.exclusions | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.midnight.exclusions | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.countries.unit | 174 | 174 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.continents.source | 173 | 173 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.southernmost.unit | 173 | 173 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.continentCount.source | 173 | 173 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.continentDistribution.source | 173 | 173 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.airlines.unit | 172 | 172 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.internationalDomestic.coverage | 172 | 172 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.northernmost.unit | 172 | 172 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.arctic.unit | 171 | 171 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.ocean.unit | 171 | 171 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.flightTime.time | 170 | 170 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.zone.unit | 170 | 170 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.airports.coverage | 169 | 169 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.arctic.coverage | 169 | 169 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.farthestFromHome.source | 169 | 169 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.longestFlight.source | 168 | 168 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.shortestFlight.source | 168 | 168 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.earlyBird.time | 168 | 168 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.afternoon.time | 168 | 168 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.nightOwl.time | 168 | 168 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.biggestDelay.exclusions | 166 | 166 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.onTimeRate.unit | 166 | 166 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.highestAirport.coverage | 166 | 166 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:distance.total.unit | 165 | 165 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.mostCountriesInDay.time | 165 | 165 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.topAirports.coverage | 165 | 165 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerKm.time | 164 | 164 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerHour.exclusions | 164 | 164 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.ocean.coverage | 164 | 164 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.newThisYear.coverage | 164 | 164 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.airlines.exclusions | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.topCountries.unit | 163 | 163 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.longestAloft.exclusions | 162 | 162 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.roundTrips.exclusions | 161 | 161 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.fastestRoute.exclusions | 161 | 161 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.flightTime.source | 160 | 160 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.seatClasses.coverage | 160 | 160 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.highestAirport.source | 160 | 160 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.flightTime.coverage | 159 | 159 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.position.source | 159 | 159 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.avgDuration.exclusions | 158 | 158 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.busiestDay.unit | 158 | 158 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.airlines.coverage | 157 | 157 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.shortestFlight.coverage | 157 | 157 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.distance.unit | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.airlines.exclusions | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerKm.exclusions | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerHour.unit | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.continents.unit | 155 | 155 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.roundTrips.time | 154 | 154 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.northernmost.source | 154 | 154 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.southernmost.source | 154 | 154 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.fastestRoute.unit | 154 | 154 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.topAirports.unit | 154 | 154 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.cost.time | 152 | 152 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.costPerKm.source | 152 | 152 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.busiestMonth.unit | 151 | 151 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.roundTrips.coverage | 151 | 151 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.mostCountriesInDay.unit | 151 | 151 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.countryCount.source | 151 | 151 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.busiestMonth.time | 150 | 150 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.avgRow.coverage | 150 | 150 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.flightTime.time | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.longestFlight.source | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.mostCountriesInDay.coverage | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.zone.exclusions | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:seats.avgRow.exclusions | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.countries.exclusions | 149 | 149 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.avgDuration.source | 148 | 148 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.longestStreak.coverage | 148 | 148 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.fastestRoute.coverage | 148 | 148 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.distance.exclusions | 147 | 147 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:charts.seasonal.unit | 147 | 147 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.aircraft.unit | 147 | 147 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.timeTravel.coverage | 146 | 146 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:distance.total.exclusions | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:breakdown.aircraftTypes.coverage | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:fun.weekend.unit | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:business.seatClassShare.unit | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.timeTravel.source | 145 | 145 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:yearSummary.flightTime.exclusions | 144 | 144 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.airportCount.unit | 144 | 144 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:rankings.countries.source | 144 | 144 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.shortestFlight.unit | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:records.northernmost.source | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.mostCountriesInDay.source | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.longestLayover.source | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.shortestLayover.source | 143 | 143 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:overview.airlines.source | 142 | 142 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:punctuality.sample.exclusions | 142 | 142 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.sameDay.coverage | 142 | 142 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:unique.midnight.coverage | 142 | 142 | keep (already behind „Wie gezählt“) |
| Statistik (Flüge) | flightStatsHelp:airports.newThisYear.source | 141 | 141 | keep (already behind „Wie gezählt“) |
| suggestionSources | suggestionSources:plugins.help | 262 | 76 | shorten |
| suggestionSources | suggestionSources:calendar.privacy.sub | 238 | 238 | keep (warning/error/consent stays visible) |
| suggestionSources | suggestionSources:calendar.geocode.help | 232 | 79 | shorten |
| suggestionSources | suggestionSources:plugins.sent.sub | 226 | 226 | keep (review later) |
| suggestionSources | suggestionSources:calendar.help | 224 | 88 | shorten |
| suggestionSources | suggestionSources:plugins.maintenance.intro | 162 | 86 | shorten |
| suggestionSources | suggestionSources:calendar.failure.kind.auth | 150 | 150 | keep (warning/error/consent stays visible) |
| suggestionSources | suggestionSources:plugins.sent.help | 138 | 74 | shorten |
| suggestionSources | suggestionSources:calendar.form.icsHint | 129 | 76 | shorten |
| suggestionSources | suggestionSources:rules.help | 126 | 58 | shorten |
| Tabellen-Export | xlsx:hints.rail | 901 | 901 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.roadtripExpenses | 719 | 719 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.tours | 650 | 650 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.ferry | 613 | 613 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.roadtripStations | 593 | 593 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.bus | 569 | 569 | keep (inside the exported file) |
| Tabellen-Export | xlsx:export.description | 521 | 86 | shorten |
| Tabellen-Export | xlsx:hints.tourPoints | 425 | 425 | keep (inside the exported file) |
| Tabellen-Export | xlsx:import.description | 422 | 80 | shorten |
| Tabellen-Export | xlsx:hints.rental | 377 | 377 | keep (inside the exported file) |
| Tabellen-Export | xlsx:import.transferNote | 375 | 375 | keep (review later) |
| Tabellen-Export | xlsx:hints.roadtrips | 365 | 365 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.lodgingStays | 268 | 268 | keep (inside the exported file) |
| Tabellen-Export | xlsx:import.replaceWarning | 258 | 258 | keep (warning/error/consent stays visible) |
| Tabellen-Export | xlsx:hints.flights | 239 | 239 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.cruiseStops | 215 | 215 | keep (inside the exported file) |
| Tabellen-Export | xlsx:import.modes.merge.hint | 197 | 65 | shorten |
| Tabellen-Export | xlsx:hints.documents | 182 | 182 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.cruises | 169 | 169 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.lodging | 162 | 162 | keep (inside the exported file) |
| Tabellen-Export | xlsx:hints.bookings | 155 | 155 | keep (inside the exported file) |
| Teilen | sharing:shareDialog.copied | 275 | 275 | keep (review later) |
| Teilen | sharing:route.intro | 271 | 87 | shorten |
| Teilen | sharing:links.dialog.itineraryHint | 263 | 91 | shorten |
| Teilen | sharing:remote.connections.hint | 262 | 82 | shorten |
| Teilen | sharing:remote.description | 237 | 75 | shorten |
| Teilen | sharing:remote.connections.findable.sub | 237 | 237 | keep (review later) |
| Teilen | sharing:links.errors.tripEnded | 214 | 214 | keep (warning/error/consent stays visible) |
| Teilen | sharing:remote.trip.reconfirmHint | 199 | 67 | shorten |
| Teilen | sharing:shareDialog.add.title | 188 | 188 | keep (review later) |
| Teilen | sharing:remote.connections.request.sent | 184 | 184 | keep (review later) |
| Teilen | sharing:shareDialog.add.nameTaken | 182 | 182 | keep (review later) |
| Teilen | sharing:remote.trip.roster.hint | 180 | 55 | shorten |
| Teilen | sharing:remote.errors.personUnknown | 176 | 176 | keep (warning/error/consent stays visible) |
| Teilen | sharing:remote.trip.delivery.retryingLocal | 172 | 172 | keep (review later) |
| Teilen | sharing:remote.invites.hint | 171 | 58 | shorten |
| Teilen | sharing:remote.trip.person.serverNotConnected | 169 | 169 | keep (review later) |
| Teilen | sharing:remote.connections.waiting.reconfirm | 169 | 169 | keep (warning/error/consent stays visible) |
| Teilen | sharing:settings.description | 166 | 84 | shorten |
| Teilen | sharing:inbox.notices.joinedMoved | 163 | 163 | keep (review later) |
| Teilen | sharing:remote.people.withdrawConfirm | 162 | 162 | keep (warning/error/consent stays visible) |
| Teilen | sharing:remote.trip.delivery.retryingHeld | 159 | 159 | keep (review later) |
| Teilen | sharing:shareDialog.blocked.consentWithdrawn | 153 | 153 | keep (warning/error/consent stays visible) |
| Teilen | sharing:friends.empty | 152 | 152 | keep (review later) |
| Teilen | sharing:linkDialog.requestIntro | 151 | 81 | shorten |
| Teilen | sharing:links.dialog.disabled | 151 | 151 | keep (review later) |
| Teilen | sharing:inbox.requests.body | 148 | 148 | keep (review later) |
| Teilen | sharing:remote.trip.person.requested | 148 | 148 | keep (review later) |
| Teilen | sharing:link.intro | 148 | 61 | shorten |
| Teilen | sharing:errors.groupConsentRequired | 147 | 147 | keep (warning/error/consent stays visible) |
| Teilen | sharing:errors.notHomeLocal | 147 | 147 | keep (warning/error/consent stays visible) |
| Teilen | sharing:shareDialog.blocked.consentMissing | 147 | 147 | keep (warning/error/consent stays visible) |
| Teilen | sharing:links.dialog.warning | 147 | 147 | keep (warning/error/consent stays visible) |
| Teilen | sharing:shareDialog.nobody | 146 | 146 | keep (review later) |
| Teilen | sharing:tripShare.peopleHint | 146 | 57 | shorten |
| Teilen | sharing:remote.errors.leaderboardUnavailable | 145 | 145 | keep (warning/error/consent stays visible) |
| Teilen | sharing:remote.trip.addRequest.hint | 137 | 83 | shorten |
| Teilen | sharing:remote.trip.codeHint | 127 | 77 | shorten |
| Teilen | sharing:inbox.notices.addRequestHint | 125 | 54 | shorten |
| Teilen | sharing:friends.remote.hint | 125 | 67 | shorten |
| training | training:progress.phaseHelpExpanded | 226 | 226 | keep (already behind ⓘ) |
| training | training:actions.startTrainingHelpExpanded | 196 | 196 | keep (already behind ⓘ) |
| training | training:jobs.titleHelpExpanded | 192 | 192 | keep (already behind ⓘ) |
| TravPlan | travplan:remote.invite.intro | 257 | 76 | shorten |
| TravPlan | travplan:remote.exportHint | 231 | 73 | shorten |
| TravPlan | travplan:create.bookingsIntro | 221 | 77 | shorten |
| TravPlan | travplan:route.handover.intro | 209 | 75 | shorten |
| TravPlan | travplan:members.introOwner | 201 | 201 | keep (review later) |
| TravPlan | travplan:deletePlan.staysBody | 182 | 182 | keep (warning/error/consent stays visible) |
| TravPlan | travplan:planDocs.intro | 163 | 53 | shorten |
| TravPlan | travplan:members.introMember | 155 | 155 | keep (review later) |
| TravPlan | travplan:remote.invite.none | 149 | 149 | keep (review later) |
| TravPlan | travplan:errors.PLAN_USER_DISABLED | 146 | 146 | keep (warning/error/consent stays visible) |
| TravPlan | travplan:aiConsent | 145 | 145 | keep (warning/error/consent stays visible) |
| TravPlan | travplan:configHelp | 136 | 79 | shorten |
| TravPlan | travplan:actual.intro | 135 | 77 | shorten |
| TravTrack | track:imports.googleHint | 728 | 88 | move behind ⓘ |
| TravTrack | track:imports.intro | 574 | 84 | move behind ⓘ |
| TravTrack | track:dawarichCopy.intro | 443 | 84 | shorten |
| TravTrack | track:evidence.scale | 371 | 371 | keep (review later) |
| TravTrack | track:settings.diagnostics.evidence.stopPlan | 252 | 252 | keep (review later) |
| TravTrack | track:sources.intro | 236 | 88 | shorten |
| TravTrack | track:delete.intro | 211 | 71 | shorten |
| TravTrack | track:quality.intro | 190 | 84 | shorten |
| TravTrack | track:settings.diagnostics.cause.lostAfterUpload | 177 | 177 | keep (warning/error/consent stays visible) |
| TravTrack | track:sources.owntracks.howTo | 170 | 170 | keep (review later) |
| TravTrack | track:months.legend | 170 | 170 | keep (review later) |
| TravTrack | track:sources.privacy | 162 | 162 | keep (warning/error/consent stays visible) |
| TravTrack | track:imports.errors.unreadable | 158 | 158 | keep (warning/error/consent stays visible) |
| TravTrack | track:imports.errors.tooManyPoints | 158 | 158 | keep (warning/error/consent stays visible) |
| TravTrack | track:dawarichCopy.connection.shared | 158 | 158 | keep (review later) |
| TravTrack | track:importsTab.intro | 158 | 47 | shorten |
| TravTrack | track:export.intro | 157 | 59 | shorten |
| TravTrack | track:settings.tripsNoResidence | 153 | 153 | keep (review later) |
| TravTrack | track:map.route.alwaysCut | 150 | 150 | keep (review later) |
| TravTrack | track:map.rangeNoTimeline | 149 | 149 | keep (review later) |
| TravTrack | track:map.countries.note | 149 | 149 | keep (review later) |
| TravTrack | track:start.companion.body | 144 | 144 | keep (review later) |
| TravTrack | track:settings.diagnostics.evidence.autoPause | 141 | 141 | keep (review later) |
| TravTrack | track:gaps.intro | 127 | 52 | shorten |
| TravTrack | track:stays.intro | 124 | 52 | shorten |
| TravTrack | track:start.intro | 121 | 59 | shorten |
| Unterkünfte | lodging:repair.intro | 345 | 93 | shorten |
| Unterkünfte | lodging:stats.help.avgPerNight.exclusions | 335 | 335 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.medianPerNight.exclusions | 335 | 335 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.cheapestDearest.exclusions | 335 | 335 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.priceRankings.exclusions | 335 | 335 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.priceRankings.source | 308 | 308 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.avgPerNight.source | 301 | 301 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awardValue.exclusions | 272 | 272 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:fx.baseCurrencyExplainer | 266 | 266 | keep (review later) |
| Unterkünfte | lodging:stats.help.nightsAway.exclusions | 241 | 241 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.centre.unit | 228 | 228 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.medianPerNight.source | 227 | 227 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.cheapestDearest.source | 227 | 227 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.priceRankings.coverage | 227 | 227 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.avgPerNight.coverage | 223 | 223 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.medianPerNight.coverage | 223 | 223 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.cheapestDearest.coverage | 223 | 223 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awardValue.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.chainShare.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.topChain.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.topChainShare.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.concentration.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.chainRanking.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.topPlaces.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.nightsAway.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestStreak.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestGap.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.busiestMonth.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.weekdaySeason.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awayShare.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestStay.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.oneNighters.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.byHotel.time | 222 | 222 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestGap.unit | 219 | 219 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestStay.exclusions | 219 | 219 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awardValue.source | 214 | 214 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.insights.prices.help.exclusions | 213 | 213 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.cheapestDearest.unit | 204 | 204 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.programmeYears.exclusions | 204 | 204 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awardValue.coverage | 203 | 203 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awayShare.exclusions | 202 | 202 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:membership.leavesThisChain | 199 | 199 | keep (review later) |
| Unterkünfte | lodging:stats.help.priceRankings.time | 197 | 197 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.concentration.exclusions | 196 | 196 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awayShare.unit | 196 | 196 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:locationCheck.name_only | 196 | 196 | keep (review later) |
| Unterkünfte | lodging:import.maps.description | 195 | 86 | shorten |
| Unterkünfte | lodging:stats.help.programmeYears.time | 192 | 192 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.bestValue.exclusions | 190 | 190 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:import.csv.description | 189 | 70 | shorten |
| Unterkünfte | lodging:import.preview.unmappedRatings | 188 | 188 | keep (review later) |
| Unterkünfte | lodging:stats.help.centre.coverage | 188 | 188 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.priceRankings.unit | 187 | 187 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.programmeYears.source | 186 | 186 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:import.batches.confirmMessage | 185 | 185 | keep (warning/error/consent stays visible) |
| Unterkünfte | lodging:stats.help.avgPerNight.unit | 185 | 185 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingParts.coverage | 184 | 184 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.medianPerNight.unit | 183 | 183 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestGap.exclusions | 183 | 183 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingOverall.exclusions | 180 | 180 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingParts.exclusions | 177 | 177 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingRankings.unit | 177 | 177 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestStreak.exclusions | 177 | 177 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.nightsAway.coverage | 175 | 175 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:locationCheck.contradicted | 174 | 174 | keep (review later) |
| Unterkünfte | lodging:stats.help.ratingRankings.coverage | 172 | 172 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.programmeYears.unit | 164 | 164 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.northSouth.exclusions | 163 | 163 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.centre.exclusions | 163 | 163 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:detail.spendPerNightCalc_other | 158 | 158 | keep (review later) |
| Unterkünfte | lodging:stats.help.longestStay.source | 158 | 158 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:detail.spendPerNightCalc_one | 157 | 157 | keep (review later) |
| Unterkünfte | lodging:stats.insights.tripBases.help.exclusions | 157 | 157 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.awardValue.unit | 157 | 157 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:import.createAnywayHint | 156 | 52 | shorten |
| Unterkünfte | lodging:stats.insights.week.help.time | 155 | 155 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:fx.tooltipMarket | 154 | 154 | keep (review later) |
| Unterkünfte | lodging:conflict.rule | 151 | 151 | keep (warning/error/consent stays visible) |
| Unterkünfte | lodging:stats.help.perfectStays.exclusions | 150 | 150 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.concentration.unit | 149 | 149 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:restay.intro | 148 | 63 | shorten |
| Unterkünfte | lodging:fx.noRateHint | 147 | 95 | shorten |
| Unterkünfte | lodging:stayEditor.ratingCategoriesIntro | 147 | 66 | shorten |
| Unterkünfte | lodging:stayEditor.ratingRetiredHint | 147 | 72 | shorten |
| Unterkünfte | lodging:stats.insights.revisits.help.exclusions | 147 | 147 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.busiestMonth.exclusions | 147 | 147 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.weekdaySeason.exclusions | 147 | 147 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.longestGap.coverage | 146 | 146 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingParts.unit | 145 | 145 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.ratingRankings.source | 144 | 144 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:stats.help.oneNighters.exclusions | 143 | 143 | keep (already behind „Wie gezählt“) |
| Unterkünfte | lodging:list.status.unlocatedHint | 126 | 65 | shorten |
| usageStats | usageStats:consent.body | 413 | 413 | keep (warning/error/consent stays visible) |
| usageStats | usageStats:consent.revokeHint | 136 | 69 | shorten |
| Verschlüsselt teilen | encryptedShare:tripSelectionHelp | 291 | 82 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.deviceHelp | 264 | 85 | shorten |
| Verschlüsselt teilen | encryptedShare:disclosure | 253 | 253 | keep (warning/error/consent stays visible) |
| Verschlüsselt teilen | encryptedShare:circleConsent | 245 | 245 | keep (warning/error/consent stays visible) |
| Verschlüsselt teilen | encryptedShare:e2e.groupHelp | 243 | 62 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.verifyHelp | 220 | 95 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.freshness | 220 | 220 | keep (review later) |
| Verschlüsselt teilen | encryptedShare:circleHelp | 208 | 88 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.matrixHelp | 203 | 65 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.sharingHelp | 198 | 73 | shorten |
| Verschlüsselt teilen | encryptedShare:supported | 194 | 194 | keep (review later) |
| Verschlüsselt teilen | encryptedShare:verifyHelp | 168 | 85 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.backupHelp | 161 | 62 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.qrHelp | 145 | 53 | shorten |
| Verschlüsselt teilen | encryptedShare:e2e.mapHelp | 144 | 44 | shorten |
| Verschlüsselt teilen | encryptedShare:rosterDisclosure | 143 | 143 | keep (review later) |
| Verschlüsselt teilen | encryptedShare:e2e.restoreHelp | 136 | 88 | shorten |
