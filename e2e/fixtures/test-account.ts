// Fixed account for the end-to-end tests only. These values are not a secret
// of any instance: they are committed on purpose and must never be used to
// configure a real one.
//
// The hash was printed by `npm run auth:hash-password` for the password below.

export const username = "test-admin";

export const password = "test-only-password-0123";

export const passwordHash =
  "argon2id:v=19:m=19456,t=2,p=1:YFmmDRlMqkIo-Vt5lSe-Xw:sy_Y3hTRjq8K6wqNeCFlZh5DZwq60v53DyCxFiercPw";
