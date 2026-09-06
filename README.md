# Molten Metals ERP

Aluminium casting inventory, production and fettling management.

## Setting up a new machine

```bash
git clone git@github.com:Avdhoot0017/molten-metals-erp.git
cd molten-metals-erp
npm install

cp .env.example .env      # Windows: copy .env.example .env
                          # then fill in DATABASE_URL and JWT_SECRET

npm run setup             # migrate + generate + master data
npm run build
npm start
```

`npm run setup` creates the four role accounts with simple default passwords
(`admin@123`, `production@123`, `fettling@123`, `accounts@123`) and prints
them. **Change each one at first sign-in** — they are in the source, so anyone
who can reach the login page knows them. Set `<ROLE>_PASSWORD` in `.env` first
to skip the defaults; see `ACCOUNTS.md`.

It creates reference data only: accounts, fettling operations, furnaces and
empty stock lines. Your parts, suppliers, companies and employees are entered
through the app.

> `npm run db:seed` is a different thing — it wipes the operational tables and
> fills them with demo data. Local development only.

## Day-to-day use on the shop-floor machine (Windows)

Run once, after setting the machine up:

```bat
install-desktop-icon.bat
```

That puts a **Molten Metals ERP** icon on the Desktop. Double-clicking it
starts the ERP and opens it in the browser - no terminal, no VS Code.

The window it opens is the server log. **Closing that window stops the ERP.**

If the app is already running, the icon just opens the browser rather than
trying to start a second copy.

## Updating a running installation

**macOS / Linux**

```bash
./deploy.sh               # pull main, migrate, build, restart
./deploy.sh --help        # every flag
```

**Windows**

```bat
deploy                    :: pull, migrate, build, start
deploy --no-start         :: stop after the build
```

`deploy` fetches new code. `start.bat` (the desktop icon) does not - it only
runs what is already there, so a shift can start the ERP without pulling an
untested change onto the shop floor.

`deploy.sh` needs bash. On Windows `deploy.bat` runs `update.mjs` instead,
which does the same job in plain Node. Either way the build runs **before** the
app is restarted, so a broken commit or a failed migration leaves the current
server up. Neither one seeds - `npm run db:seed` is separate, and destructive.

## Development

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
