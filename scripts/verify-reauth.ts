import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

// Regression check for CR-01 / T-01-07: password change must require the current password.
//
// updateUser({ current_password }) only enforces reauthentication when the project flag
// `security_update_password_require_reauthentication` is ON. This probe proves it is ON
// WITHOUT mutating any credential: the new password always equals the current one, so no
// call can ever change the password.
//
// Two calls, both new==current:
//   A) wrong current_password
//   B) real  current_password
// Reauth ENFORCED  -> A is rejected at the current-password check (code != same_password),
//                     B reaches the "new must differ" check (code == same_password): codes differ.
// Reauth NO-OP     -> current_password ignored, both stop at same_password: codes identical -> FAIL.

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "USER1_EMAIL",
  "SEED_PASSWORD_1",
] as const;

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const url = process.env.SUPABASE_URL!;
const anon = process.env.SUPABASE_PUBLISHABLE_KEY!;
const email = process.env.USER1_EMAIL!;
const realPassword = process.env.SEED_PASSWORD_1!;
const wrongPassword = "definitely-not-the-real-password-000";

function newClient() {
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function probe(label: string, currentPassword: string) {
  const client = newClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: realPassword,
  });
  if (signInError) throw new Error(`${label}: sign-in failed: ${signInError.message}`);

  // new password == current password -> guaranteed no net change
  const { error } = await client.auth.updateUser({
    current_password: currentPassword,
    password: realPassword,
  });
  await client.auth.signOut();

  const code = error ? ((error as { code?: string }).code ?? "") : "";
  return { label, ok: !error, code, msg: error ? error.message : "(no error)" };
}

const a = await probe("A wrong-current-password", wrongPassword);
const b = await probe("B real-current-password", realPassword);

console.log(JSON.stringify(a));
console.log(JSON.stringify(b));

// Enforced iff the wrong current password is rejected at reauth (not the same_password check)
// and therefore produces a different outcome than the real current password.
const enforced = a.code !== "same_password" && a.code !== "" && (a.code !== b.code || a.ok !== b.ok);

// Safety: original password must still authenticate.
const check = newClient();
const { error: finalError } = await check.auth.signInWithPassword({ email, password: realPassword });
await check.auth.signOut();
if (finalError) {
  throw new Error(`SAFETY FAILURE: original password no longer authenticates: ${finalError.message}`);
}

if (enforced) {
  console.log("PASS: current-password reauthentication is enforced (wrong current password rejected).");
  process.exit(0);
} else {
  console.error(
    "FAIL: current-password reauthentication is NOT enforced — update('current_password') is a no-op. " +
      "Enable Supabase 'security_update_password_require_reauthentication' (secure password change).",
  );
  process.exit(1);
}
