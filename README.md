# Build Tracker

Tracks every job, from new houses to one-off repairs, and keeps a searchable permanent record of each: budgets, POs, sub bills, lien waivers, change orders, lender draws, schedules, site logs, colors and selections, drawings and files, who did each step, and a sub portal.

## Try it

```bash
npm install
npm run dev     # http://localhost:5173
```

`npm run demo` runs **demo mode** at http://localhost:5184: sample data, saved only in that browser, with "Viewing as" in the top bar to switch people.

## Run the real system on this computer

```bash
npm run local:start   # starts the database, logins, and file storage
npm run dev           # the app, at http://127.0.0.1:5183
npm run local:stop    # when you're done. Your data stays.
```

Login emails don't go out. They land in the mailbox at http://127.0.0.1:54324. `npx supabase db reset` erases all local data.

## Test it

```bash
npm test                 # money rules + the real database migration in Postgres, logged in as each role
npm run build && npx vite preview --port 4173    # then, in another terminal:
node scripts/e2e.mjs <folder-for-screenshots>    # clicks through demo mode in real Chrome
npx supabase db reset && node scripts/e2e-live.mjs <folder>   # every feature on the real local system, writes docs/TEST-REPORT.md
```

## Rules the database enforces

- A bill can't be paid unless the sub's insurance is current on the paid date **and** a lien waiver for that bill is in. Only an admin can override, a reason is required, and it stays on the bill.
- Approving a bill requests a conditional waiver. Paying requests the unconditional one.
- Paid bills are locked. Only an admin can undo a payment.
- Crew see only open jobs where they have a task: what it needs, the schedule, materials without cost, colors, and plans. They can update their own tasks and mark materials arrived. They never see money, subs' records, or contracts.
- Contractor phone numbers, emails, and addresses are visible to admins only. Staff, crew, and subs can't read them, so keep admin to the people who should have them.
- Crew can ask for materials on jobs they have tasks on. The request lands on the owner's list until someone orders it.
- Contractor photos start as waiting for review. Staff or admins approve or disapprove them, and disapproving needs a reason the contractor sees. Only approved photos reach the job record.
- Moving a task's dates or changing its sub clears the confirmation, so that sub goes back on the call list.
- Subs see only their own work orders, tasks, bills, waivers, photos, and file folder. They can't read budgets, prices, loans, change orders, draws, or other subs.
- A login with no invite gets no access.

## Going live

1. Create a Supabase project. In the SQL editor, run each file in `supabase/migrations/` in order.
2. Authentication > Providers > Email: leave **on**, or nobody can log in. Authentication > Sign In: turn **off** "Allow new users to sign up".
3. Authentication > URL Configuration: set the Site URL to the deployed address.
4. Copy `.env.example` to `.env` and fill in both values. Add the same two to Vercel.
5. Deploy on Vercel: framework Vite.
6. Deploy the functions: `npx supabase functions deploy invite-user`, and `auto-texts` when you want automatic texts. Set up email sending under Authentication > SMTP, since the built-in sender only allows a few emails an hour.
7. Before anyone signs in, in the SQL editor: `insert into public.team_invites (email, role) values ('you@example.com', 'admin');` (one row per admin)
8. Authentication > Users > Add user > Create new user, with that email and Auto Confirm on. Sign in on the app's login page. Invite everyone else from the app.

To add a sub: Subs > Portal access sends the invite. Anyone invited can get a fresh link from the login page at any time.

## Backups

`node scripts/backup.mjs <settings-file>` copies the database, every login, and every uploaded file into a dated folder. Unchanged files are linked to the previous backup instead of copied again. It keeps the newest backup of each of the last 30 days and of each of the last 12 months, and only clears old ones after a new one finishes. `LAST-RUN.txt` in the backup folder says OK or FAILED with the reason.

Settings file (keep it private, `chmod 600`):

```
BT_DB_URL=postgresql://...        # Supabase > Project Settings > Database > connection string
BT_SUPABASE_URL=https://....supabase.co
BT_SERVICE_KEY=...                # Supabase > Project Settings > API > service_role key
BT_BACKUP_DIR=/Users/<you>/build-tracker-backups
```

Needs Node and `brew install libpq`. To put a backup back: `node scripts/restore.mjs <backup-folder> <settings-file> --yes-replace=<host>`. That **replaces everything** on that system.

Tested on the local system: backed up, erased every record and file, restored, and every count, the bill contents, all files byte for byte, and logins came back. Not yet tested against a hosted Supabase project.

## Not built

- Nothing sends texts or emails on its own. Message buttons open your own texts or email with the words filled in, and you hit send. The app logs that you opened it, not that it went out.
- Costs on the Materials tab are for reference. The budget still counts bills.
- No live QuickBooks sync. The Bills tab downloads paid bills as CSV; test its columns against your QuickBooks import.
- No client portal, selections, or estimating.
- Payments are recorded, not sent.
- The app stores signed lien waivers but doesn't supply the form. Get yours from your attorney.
- Schedule delays count weekends as working days.
- Search reads file names, titles, and notes, not the text inside a drawing or PDF. Add notes to a file to make its contents findable.
- Past jobs are entered by hand. There is no bulk import yet.
- Subs can't open drawings or see colors from the portal. Crew can, on jobs they have tasks on.

## Where things live

| Path | What |
|---|---|
| `src/domain/` | Budget math, payment gate, schedule pushes, starter templates. No screen code. |
| `src/data/` | Store interface with Supabase and demo backends, plus sample data. |
| `src/pages/` | Today, all jobs search, job tabs, subs, team, sub portal, lender draw sheet. |
| `supabase/migrations/` | Tables, permissions, payment gate. |
| `tests/` | Rule tests and database permission tests. |
