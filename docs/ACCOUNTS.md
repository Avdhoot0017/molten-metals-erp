# Accounts and roles

Four accounts, one per role. They are created by `npm run setup` on a fresh
installation — you do not create them by hand.

## The four roles

| Role | Default email | What it reaches |
|---|---|---|
| **Admin** | `admin@moltenmetals.com` | Everything, including users and settings. The only role that can amend a completed production batch. |
| **Production Manager** | `production@moltenmetals.com` | Production, parts, purchase orders, suppliers, companies, analytics. Reads dashboard. |
| **Fettling Manager** | `fettling@moltenmetals.com` | Fettling shop, employees, inventory, production. Reads dashboard and parts. |
| **Accounts** | `accounts@moltenmetals.com` | Read-only across operations, but owns users and settings. |

The exact permission matrix lives in `lib/permissions.ts` — that file is the
authority, this table is a summary of it.

## Passwords on a real installation

`npm run setup` **generates a separate password for each account and prints
them once**:

```
────────────────────────────────────────────────────────────────
  SIGN-IN DETAILS - SHOWN ONCE, NOT RECOVERABLE LATER
────────────────────────────────────────────────────────────────
  ADMIN
      Everything, including users and settings
      Email:    admin@moltenmetals.com
      Password: TL2WKCw47u7HzMUX
  ...
```

They are stored hashed with bcrypt and **cannot be read back** — not from the
database, not by re-running setup. Write them down when they are printed.

To choose your own instead, set them in `.env` before running setup (see
`.env.example`):

```ini
ADMIN_EMAIL="boss@yourfoundry.com"
ADMIN_NAME="Plant Administrator"
ADMIN_PASSWORD="..."

PRODUCTION_EMAIL="production@yourfoundry.com"
FETTLING_EMAIL="fettling@yourfoundry.com"
ACCOUNTS_EMAIL="accounts@yourfoundry.com"
```

Supply some and let setup generate the rest — they are handled per account.
Delete the block from `.env` afterwards: it has no effect once the accounts
exist, and passwords do not belong in a file.

### Re-running setup

Safe. An account that already exists keeps its password — setup can never lock
someone out of a running installation. It only creates what is missing.

### Lost the admin password

There is no recovery by design. Either sign in as another admin and reset it in
Settings, or create a replacement admin directly:

```bash
node -e "console.log(require('bcryptjs').hashSync('YOUR-NEW-PASSWORD', 12))"
```

then `UPDATE users SET password = '<the hash>' WHERE email = 'admin@...';`

## Passwords on a demo installation

`npm run db:seed` is the **demo** seed — it clears the operational tables and
fills them with sample parts, batches and stock. On a database that has no
users yet, it creates the same four accounts with fixed, well-known passwords:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@moltenmetals.com` | `admin123` |
| Production Manager | `production@moltenmetals.com` | `production123` |
| Fettling Manager | `fettling@moltenmetals.com` | `fettling123` |
| Accounts | `accounts@moltenmetals.com` | `accounts123` |

These are for local development only. They are hard-coded in `prisma/seed.ts`,
which is public, so anyone who can reach the login page knows them.

**An account that already exists keeps the password it has.** The seed upserts
users with an empty update clause and never deletes them, so running it on a
database where `npm run setup` already generated passwords will *not* hand you
`admin123` — you still need the password that setup printed. This trips people
up: seeing "seeded" in the output does not mean the demo passwords now work.

> **Never run `npm run db:seed` on a real installation.** It deletes production
> records, inventory, purchase orders and fettling history. `npm run setup` is
> the one that is safe to run against real data.

## Adding more people

Settings → Users, signed in as Admin or Accounts. Setup exists to get the first
four accounts in place, not to manage the rest.

## Do not commit real passwords

This file documents the demo passwords only, because they are already in the
repository source. Passwords from a real installation belong in whatever your
team uses for secrets — not in git, and not in a note beside the code.
