import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "USER1_EMAIL",
  "USER2_EMAIL",
  "SEED_PASSWORD_1",
  "SEED_PASSWORD_2",
] as const;

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const credentials = [
  { label: "USER1", email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
  { label: "USER2", email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
];

for (const credential of credentials) {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: credential.email,
    password: credential.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`${credential.label} authentication failed`);
  }
  console.log(`PASS: ${credential.label} authenticated with a non-null session`);
  await client.auth.signOut();
}

const publicClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_PUBLISHABLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const { error: signupError } = await publicClient.auth.signUp({
  email: "intruder-probe@example.com",
  password: "RejectedProbe-2026!",
});
if (!signupError) {
  throw new Error("Public signup unexpectedly succeeded");
}
console.log("PASS: third-party client account creation was rejected");
