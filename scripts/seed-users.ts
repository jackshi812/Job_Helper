import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
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

const users = [
  { label: "user 1", email: process.env.USER1_EMAIL!, password: process.env.SEED_PASSWORD_1! },
  { label: "user 2", email: process.env.USER2_EMAIL!, password: process.env.SEED_PASSWORD_2! },
];

if (users[0].email.toLowerCase() === users[1].email.toLowerCase()) {
  throw new Error("USER1_EMAIL and USER2_EMAIL must be different");
}

for (const user of users) {
  if (user.password.length < 8) {
    throw new Error(`${user.label} seed password must contain at least 8 characters`);
  }
}

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

for (const user of users) {
  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (!error && data.user) {
    console.log(`created ${user.label} (${data.user.id})`);
    continue;
  }

  if (!error?.message.toLowerCase().includes("already")) {
    throw new Error(`Could not seed ${user.label}: ${error?.message ?? "unknown error"}`);
  }

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;

  const match = existing.users.find(
    (candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase(),
  );
  if (!match) throw new Error(`Could not locate existing ${user.label}`);
  console.log(`existing ${user.label} (${match.id})`);
}

const { data: finalUsers, error: finalListError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (finalListError) throw finalListError;

const expectedEmails = new Set(users.map((user) => user.email.toLowerCase()));
const unexpected = finalUsers.users.filter(
  (user) => !user.email || !expectedEmails.has(user.email.toLowerCase()),
);
if (finalUsers.users.length !== 2 || unexpected.length > 0) {
  throw new Error("Expected the hosted project to contain exactly the two configured users");
}

console.log("PASS: exactly two configured users are present");
