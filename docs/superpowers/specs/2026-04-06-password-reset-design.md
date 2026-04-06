# Password Reset — Design Spec

**Datum:** 2026-04-06
**Status:** Approved

---

## Überblick

Zwei unabhängige Reset-Wege:
1. **Email-Reset** — User fordert Link an (setzt SMTP voraus)
2. **Admin-Reset** — Admin setzt Passwort direkt im Admin-Panel (immer verfügbar)

Beide Wege unterstützen `mustChangePassword`: User muss Passwort beim nächsten Login zwingend ändern.

---

## Datenmodell

Drei neue Felder auf dem `User`-Model (Prisma-Migration):

```prisma
resetToken         String?   // gehashter Reset-Token (crypto.randomBytes(32))
resetTokenExpiry   DateTime? // 30 Min (Email-Flow) / 24h (Admin-generiert)
mustChangePassword Boolean   @default(false)
```

Token wird als Klartext-Hex generiert, mit `bcrypt.hash()` gespeichert, nach Verwendung auf `null` gesetzt.

---

## Backend API

**Neues Route-File:** `backend/src/routes/passwordReset.ts`
**Eingebunden in:** `backend/src/index.ts` unter `/api/v1/auth`

### Public Endpoints

#### `POST /api/v1/auth/forgot-password`
- Body: `{ username: string }`
- Immer HTTP 200 (verhindert User-Enumeration)
- Wenn SMTP nicht aktiv: nur 200, keine Email
- Wenn SMTP aktiv + User existiert: Reset-Token generieren, hashen, in DB speichern (Expiry: 30 Min), Email mit Link senden
- Link-Format: `{FRONTEND_URL}/reset-password?token={plainToken}`

#### `POST /api/v1/auth/reset-password`
- Body: `{ token: string, newPassword: string }` (Zod-validiert, min 8 Zeichen)
- Token gegen DB-Hash prüfen, Expiry prüfen
- Bei Erfolg: Passwort setzen, Token + Expiry auf null, `mustChangePassword: false`
- Rate-Limit: 5 Versuche / 15 Min (neuer `passwordResetLimiter`)

### Admin Endpoint

#### `POST /api/v1/admin/users/:id/reset-password`
- Auth: `requireAdmin`
- Body: `{ mode: "generate" | "set", password?: string, mustChangePassword?: boolean }`
- `mode: "generate"`: zufälliges 12-Zeichen Passwort generieren (Klartext einmalig zurückgeben), `mustChangePassword` default `true`
- `mode: "set"`: `password` aus Body nehmen (min 8 Zeichen), `mustChangePassword` default `false`
- Passwort hashen, in DB speichern, `resetToken`/`resetTokenExpiry` clearen

### Auth-Login Ergänzung (`auth.ts`)

Nach erfolgreichem Login prüfen:
```typescript
if (user.mustChangePassword) {
  return res.json({ requiresPasswordChange: true });
  // kein auth_token Cookie gesetzt — User kann App nicht nutzen
}
```

---

## Email-Template

Einfaches Plain-Text + HTML-Email via bestehendem `emailService.ts`:

```
Betreff: TravStats — Passwort zurücksetzen

Hallo {username},

Du hast eine Passwortzurücksetzung angefordert.
Link (gültig 30 Minuten): {resetUrl}

Falls du das nicht angefordert hast, kannst du diese Email ignorieren.
```

Neues Interface `sendPasswordResetEmail(to: string, resetUrl: string, username: string)` in `emailService.ts`.

---

## Frontend

### Login-Seite (`LoginPage.tsx`)

- Link "Passwort vergessen?" unter dem Login-Formular
- Klick öffnet Modal:
  - **SMTP konfiguriert**: Username-Eingabe + "Reset-Link senden"-Button → generische Erfolgsmeldung
  - **SMTP nicht konfiguriert**: Hinweis "Email nicht eingerichtet — bitte Admin kontaktieren" (kein Formular)
- SMTP-Status: neuer public Endpoint `GET /api/v1/auth/smtp-status` → `{ smtpEnabled: boolean }`

### Neue Route `/reset-password`

- Seite `ResetPasswordPage.tsx`
- Token aus URL-Parameter lesen
- Formular: "Neues Passwort" + "Passwort bestätigen"
- Bei Erfolg: Weiterleitung zu Login mit Erfolgsmeldung
- Bei ungültigem/abgelaufenem Token: Fehlermeldung + Link zurück zu "Passwort vergessen"

### Force-Change-Flow

Nach Login mit `requiresPasswordChange: true`:
- Kein Cookie gesetzt → User landet auf Login, aber mit Flag im State
- Weiterleitung zu `/change-password` (neue Seite `ForceChangePasswordPage.tsx`)
- Formular: nur "Neues Passwort" + "Bestätigen" (kein altes Passwort nötig)
- Sonderfall: User ist noch nicht eingeloggt → einmaliges Token für diese Aktion nötig

**Technische Lösung für Force-Change ohne Session:**
Login-Response bei `mustChangePassword: true` gibt temporäres `changeToken` zurück (separat von `auth_token`, kurze Gültigkeit 10 Min). `ForceChangePasswordPage` schickt dieses Token mit dem neuen Passwort an `POST /api/v1/auth/force-change-password`.

### Admin-Panel (`AdminPage` / User-Liste)

- "Reset"-Button in der User-Zeile öffnet Modal
- Modal mit zwei Tabs:
  - **"Generieren"**: Button "Temporäres Passwort generieren" → zeigt Passwort einmalig in einem kopierbaren Feld. Checkbox "Muss Passwort beim nächsten Login ändern" (default: an)
  - **"Manuell setzen"**: Passwort-Eingabefeld (min 8 Zeichen). Checkbox "Muss Passwort beim nächsten Login ändern" (default: aus)

---

## Neue Zod-Schemas (`backend/src/schemas/auth.ts`)

```typescript
export const forgotPasswordSchema = z.object({
  username: z.string().min(1),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const forceChangePasswordSchema = z.object({
  changeToken: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

export const adminResetPasswordSchema = z.object({
  mode: z.enum(['generate', 'set']),
  password: z.string().min(8).max(100).optional(),
  mustChangePassword: z.boolean().optional(),
});
```

---

## Rate-Limiting

Neuer `passwordResetLimiter` in `middleware/rateLimit.ts`:
- 5 Versuche / 15 Min / IP
- Gilt für: `POST /forgot-password`, `POST /reset-password`

Konstanten in `config/constants.ts`:
```typescript
PASSWORD_RESET_WINDOW_MS: 15 * 60 * 1000,
PASSWORD_RESET_MAX: 5,
```

---

## i18n

Neue Keys in `de` und `en`:
- `login.forgotPassword`, `login.forgotPasswordModal.*`
- `resetPassword.*`
- `forceChangePassword.*`
- `admin.users.resetPassword.*`

---

## Was nicht implementiert wird (YAGNI)

- Passwort-Stärke-Meter (min 8 Zeichen reicht)
- Mehrere aktive Reset-Tokens pro User
- SMS/andere Kanäle
- Audit-Log für Reset-Aktionen
