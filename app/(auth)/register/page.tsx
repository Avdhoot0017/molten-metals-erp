import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, KeyRound, ShieldCheck, UserPlus } from "lucide-react";

export const metadata = {
  title: "Getting access | Molten Metals ERP",
};

/**
 * Where the login page's "Contact admin" and "Forgot password?" links land.
 *
 * Deliberately not a sign-up form. Accounts in this system are created by an
 * administrator in Settings > Users, because a role decides what someone can
 * reach - production, the fettling shop, purchase orders - and that is not a
 * choice a person should make for themselves on a registration form.
 *
 * So this page says who to ask and what to ask for, rather than collecting
 * details into a request queue nobody is watching.
 */
export default function GettingAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-lg space-y-8">
        <div className="flex justify-center">
          <Image
            src="/Molten.png"
            alt="Molten Metal Pvt Ltd"
            width={183}
            height={100}
            priority
            className="h-16 w-auto object-contain"
          />
        </div>

        <div className="text-center">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Getting access
          </h1>
          <p className="mt-2 text-[var(--muted-foreground)]">
            Accounts are set up for you — there is no sign-up form.
          </p>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-[var(--accent)] p-2.5">
                <UserPlus className="h-5 w-5 text-[var(--primary)]" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-[var(--foreground)]">
                  You need an account
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Ask your plant administrator to add you. They will need your
                  name, email, and which part of the plant you work in —
                  production, the fettling shop, or accounts. That choice sets
                  what you can see and change.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-[var(--accent)] p-2.5">
                <KeyRound className="h-5 w-5 text-[var(--primary)]" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-[var(--foreground)]">
                  You have forgotten your password
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Passwords are stored scrambled and cannot be looked up, so
                  nobody can read yours back to you. Your administrator can set
                  a new one for you from Settings &rsaquo; Users. Change it to
                  something of your own once you are signed in, under Profile.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-[var(--card)] p-2.5">
                <ShieldCheck className="h-5 w-5 text-[var(--muted-foreground)]" />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-[var(--foreground)]">
                  Already signed in somewhere?
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted-foreground)]">
                  Anyone with the Admin or Accounts role can add people and
                  reset passwords. If that is you, it is under Settings &rsaquo;
                  Users.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="flex justify-center">
          <Link
            href="/login"
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[var(--primary)] px-5 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
