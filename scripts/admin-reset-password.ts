import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "TARGET_EMAIL",
  "NEW_PASSWORD",
] as const;

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

if (process.env.NEW_PASSWORD!.length < 8) {
  throw new Error("NEW_PASSWORD must contain at least 8 characters");
}

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw new Error("Could not list project users");

const target = data.users.find(
  (user) => user.email?.toLowerCase() === process.env.TARGET_EMAIL!.toLowerCase(),
);
if (!target) throw new Error("No project user matches TARGET_EMAIL");

const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
  password: process.env.NEW_PASSWORD!,
});
if (updateError) throw new Error("Could not reset the target user's password");

console.log("PASS: target user password reset");
